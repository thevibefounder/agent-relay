#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, chmodSync, constants, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import {
  AGENT_NAMES,
  ID_PATTERN,
  SESSION_ID_PATTERN,
  assertStableWorkingDirectory,
  canonicalFuturePath,
  describeProjects,
  loadConfig,
  resolveDelegation
} from "./config.mjs";
import { runProcess, terminateActiveRuns } from "./process-runner.mjs";
import { assertSessionBinding, recordSessionBinding } from "./session-store.mjs";
import { createJobs, lockCheckout } from "./jobs.mjs";

const VERSION = "0.3.0";
const DEFAULT_TIMEOUT_SECONDS = 50;
const MAX_TIMEOUT_SECONDS = 55;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_PROMPT_CHARS = 100_000;
const ROUTER_DEPTH = Number.parseInt(
  process.env.AGENT_RELAY_DEPTH ?? process.env.AGENT_ROUTER_DEPTH ?? "0",
  10
) || 0;
const CONFIG_PATH = canonicalFuturePath(resolve(
  process.env.AGENT_RELAY_CONFIG ?? join(homedir(), ".agent-relay", "config.json")
));
const HAS_RELAY_ANCESTOR = detectRelayAncestor();

const selection = readSelection(process.argv.slice(2));
const jobs = createJobs(runJob);
const jobId = z.uuid();

const toolInput = z.object({
  project_id: z.string().regex(ID_PATTERN)
    .describe("Configured project identity. Agent Relay resolves its root; callers cannot provide an absolute working directory."),
  agent_id: z.string().regex(ID_PATTERN)
    .describe("Configured agent identity within the project. Its provider, role, and write policy are immutable for this call."),
  prompt: z.string().min(1).max(MAX_PROMPT_CHARS)
    .describe("The complete task and context for the delegated coding agent."),
  subdir: z.string().min(1).max(500).optional()
    .describe("Optional relative directory inside the configured project root. Absolute paths and traversal are rejected."),
  session_id: z.string().regex(SESSION_ID_PATTERN).optional()
    .describe("Resume or continue a prior delegated session when the target supports it."),
  allow_edits: z.boolean().default(false)
  .describe("Request edits inside the working directory. Requires local opt-in. The legacy Claude tool is read-only."),
  timeout_seconds: z.number().int().min(15).max(MAX_TIMEOUT_SECONDS).default(DEFAULT_TIMEOUT_SECONDS)
    .describe(`Hard timeout for the delegated run, from 15 to ${MAX_TIMEOUT_SECONDS} seconds.`)
}).strict();

process.stdin.once("close", () => terminateActiveRuns("Agent Relay input closed."));
for (const [signal, exitCode] of [["SIGTERM", 143], ["SIGINT", 130]]) {
  process.once(signal, () => {
    terminateActiveRuns(`Agent Relay received ${signal}.`, true);
    setTimeout(() => process.exit(exitCode), 100).unref?.();
  });
}

const agentDefinitions = {
  claude: {
    title: "Claude Code",
    description: "Ask the local Claude Code CLI to inspect, review, or plan in a trusted workspace. Claude is hard-locked to read-only mode.",
    readOnlyMode: "plan",
    writeMode: "disabled",
    supportsResume: true,
    run: runClaude
  },
  codex: {
    title: "Codex",
    description: "Ask the local Codex CLI to inspect, review, plan, or edit a trusted workspace.",
    readOnlyMode: "read-only",
    writeMode: "workspace-write",
    supportsResume: true,
    run: runCodex
  },
  grok: {
    title: "Grok Bot",
    description: "Ask the local Grok CLI to inspect, review, plan, or edit a trusted workspace.",
    readOnlyMode: "plan",
    writeMode: "acceptEdits",
    supportsResume: true,
    run: runGrok
  },
  muse: {
    title: "Muse Code",
    description: "Ask the local Muse CLI to inspect, review, plan, or edit a trusted workspace.",
    readOnlyMode: "no-shell/no-write",
    writeMode: "sandboxed workspace",
    supportsResume: true,
    run: runMuse
  }
};

serveStdio(() => {
  const server = new McpServer(
    { name: selection.serverName, version: VERSION },
    { capabilities: { tools: {} } }
  );

  server.registerTool(
    "list_available_agents",
    {
      title: "List Available Agents",
      description: "List the local agents exposed by this router, including availability, safe modes, and session support. This tool never launches a model.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
    },
    async () => {
      const loaded = loadConfiguration();
      const agents = selection.targets.map((name) => describeAgent(name, loaded));
      const configuration = describeConfiguration(loaded);
      const projects = loaded ? describeProjects(loaded, selection.targets)
        .filter(({ id }) => !selection.projectId || id === selection.projectId) : [];
      const output = { host: selection.host, configuration, projects, agents };
      return {
        content: [{ type: "text", text: formatAgentList(output) }],
        structuredContent: output
      };
    }
  );

  if (selection.projectId) {
    registerJobTools(server);
    return server;
  }

  for (const target of selection.targets) {
    const definition = agentDefinitions[target];
    server.registerTool(
      `delegate_to_${target}`,
      {
        title: `Delegate to ${definition.title}`,
        description: definition.writeMode === "disabled"
          ? `${definition.description} allow_edits must remain false. Returns the answer and a session ID when the target provides one.`
          : `${definition.description} Read-only by default. Edits require both allow_edits=true and explicit local configuration. Returns the answer and a session ID when the target provides one.`,
        inputSchema: toolInput,
        annotations: {
          readOnlyHint: definition.writeMode === "disabled",
          destructiveHint: definition.writeMode !== "disabled",
          openWorldHint: false
        }
      },
      async (input, context) => {
        let release;
        try {
          if (input.allow_edits) release = lockCheckout(prepareDelegation(target, input).root, "legacy");
          return toolResult(await definition.run(input, context.mcpReq.signal));
        } catch (error) {
          return toolError(target, error, input);
        } finally {
          release?.();
        }
      }
    );
  }

  return server;
});

function registerJobTools(server) {
  const tools = [
    ["ask_agent", "Start a task in the connected project. Use edit mode only when the user requests edits. Use get_result with the returned job ID until the job finishes.",
      z.object({
        agent: z.enum(selection.targets),
        task: z.string().trim().min(1).max(MAX_PROMPT_CHARS),
        mode: z.enum(["review", "edit"]).default("review"),
        continue_from: jobId.optional()
      }).strict(),
      (input) => {
        guardAgainstLoops();
        const loaded = loadConfig(CONFIG_PATH);
        const project = loaded.config.projects.find(({ id }) => id === selection.projectId);
        if (!project) throw new Error(`Unknown connected project: ${selection.projectId}`);
        const matches = project.agents.filter(({ target }) => target === input.agent);
        if (matches.length !== 1) throw new Error(`Configure exactly one ${input.agent} identity for this project.`);
        const identity = resolveDelegation(loaded, input.agent, { project_id: project.id, agent_id: matches[0].id });
        if (input.mode === "edit" && !identity.canWrite) throw new Error("Edits are disabled for this project and agent.");
        agentExecutable(input.agent, loaded.config);
        return jobs.start({ identity, mode: input.mode, task: input.task, previousId: input.continue_from });
      }],
    ["get_result", "Get the status or result of a job. Use wait_seconds to wait up to 30 seconds. Polling does not start a new task.",
      z.object({ job_id: jobId, wait_seconds: z.number().int().min(0).max(30).default(0) }).strict(),
      (input, signal) => jobs.result(input.job_id, input.wait_seconds, signal)],
    ["cancel", "Stop a job. An edit job may have already changed files.",
      z.object({ job_id: jobId }).strict(), (input) => jobs.cancel(input.job_id)]
  ];
  for (const [name, description, inputSchema, handle] of tools) {
    server.registerTool(name, { description, inputSchema }, async (input, context) => {
      try {
        const receipt = await handle(input, context.mcpReq.signal);
        return { content: [{ type: "text", text: JSON.stringify(receipt) }], structuredContent: receipt };
      } catch (error) {
        return toolError(input.agent, error, input);
      }
    });
  }
}

async function runJob(identity, mode, task, session, signal) {
  if (session) assertSessionBinding(identity.sessionsDirectory, session, identity);
  const input = {
    project_id: identity.projectId, agent_id: identity.agentId, prompt: task,
    allow_edits: mode === "edit", timeout_seconds: 30 * 60, session_id: session, job: true
  };
  return agentDefinitions[identity.target].run(input, signal, identity);
}

function readSelection(args) {
  const hostIndex = args.indexOf("--host");
  const targetIndex = args.indexOf("--target");
  const targetsIndex = args.indexOf("--targets");
  const supplied = [hostIndex, targetIndex, targetsIndex].filter((index) => index >= 0);
  if (supplied.length !== 1) usageAndExit();

  if (hostIndex >= 0) {
    const host = args[hostIndex + 1];
    if (!AGENT_NAMES.includes(host)) usageAndExit();
    const projectIndex = args.indexOf("--project");
    const projectId = projectIndex === -1 ? undefined : args[projectIndex + 1];
    if (projectIndex !== -1 && !ID_PATTERN.test(projectId ?? "")) usageAndExit();
    const providers = projectId ? ["claude", "codex", ...(args.includes("--with-grok") ? ["grok"] : [])] : AGENT_NAMES;
    return {
      host,
      projectId,
      targets: providers.filter((name) => name !== host),
      serverName: `agent-relay-${host}`
    };
  }

  if (targetIndex >= 0) {
    const target = args[targetIndex + 1];
    if (!AGENT_NAMES.includes(target)) usageAndExit();
    return { host: undefined, targets: [target], serverName: `agent-relay-${target}` };
  }

  const targets = (args[targetsIndex + 1] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (targets.length === 0 || targets.some((target) => !AGENT_NAMES.includes(target))) {
    usageAndExit();
  }
  return { host: undefined, targets: [...new Set(targets)], serverName: "agent-relay-custom" };
}

function usageAndExit() {
  process.stderr.write(
    "Usage: server.mjs --host claude|codex|grok|muse [--project ID [--with-grok]]\n" +
    "   or: server.mjs --target claude|codex|grok|muse\n" +
    "   or: server.mjs --targets claude,codex,grok,muse\n"
  );
  process.exit(2);
}

function resolveExecutable(envName, candidates) {
  const requested = process.env[envName];
  for (const candidate of [requested, ...candidates].filter(Boolean)) {
    if (!isAbsolute(candidate) && !candidate.includes("/") && !candidate.includes("\\")) {
      const found = findOnPath(candidate);
      if (found) return found;
      continue;
    }
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next known location.
    }
  }
  throw new Error(`No executable found for ${envName}`);
}

function findOnPath(command) {
  const suffixes = process.platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
  for (const directory of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    for (const suffix of suffixes) {
      const candidate = join(directory, `${command}${suffix}`);
      try {
        accessSync(candidate, constants.X_OK);
        return candidate;
      } catch {
        // Continue searching PATH.
      }
    }
  }
  return undefined;
}

function agentExecutable(name, config = {}) {
  const configured = config.cli_paths?.[name];
  if (selection.projectId && configured) {
    accessSync(configured, constants.X_OK);
    return configured;
  }
  if (name === "claude") {
    return resolveExecutable("CLAUDE_CLI_PATH", [configured, "claude"]);
  }
  if (name === "codex") {
    return resolveExecutable("CODEX_CLI_PATH", [configured, "codex"]);
  }
  if (name === "grok") {
    return resolveExecutable("GROK_CLI_PATH", [configured, "grok"]);
  }
  return resolveExecutable("MUSE_CLI_PATH", [configured, "muse"]);
}

function describeAgent(name, loaded) {
  const definition = agentDefinitions[name];
  let available = true;
  let error;
  try {
    agentExecutable(name, loaded?.config);
  } catch (caught) {
    available = false;
    error = errorMessage(caught);
  }
  return {
    name,
    title: definition.title,
    available,
    read_only_mode: definition.readOnlyMode,
    write_mode: definition.writeMode,
    configured_identities: loaded
      ? loaded.config.projects.flatMap((project) => project.agents)
        .filter((agent) => agent.target === name).length
      : 0,
    supports_resume: definition.supportsResume,
    error
  };
}

function formatAgentList({ host, configuration, projects, agents }) {
  const heading = host ? `Agent Relay host: ${host}` : "Agent Relay";
  const setup = configuration.configured
    ? `Configuration: ready; projects=${configuration.project_count}`
    : `Configuration: required; run setup (${configuration.error ?? configuration.config_path})`;
  const lines = agents.map((agent) =>
    `- ${agent.name}: ${agent.available ? "available" : "unavailable"}; read-only=${agent.read_only_mode}; configured identities=${agent.configured_identities}; resume=${agent.supports_resume ? "yes" : "no"}`
  );
  const identities = projects.flatMap((project) => project.agents.map((agent) =>
    `- ${project.id}/${agent.id}: target=${agent.target}; role=${agent.role}; writes=${agent.can_write ? "enabled" : "disabled"}`
  ));
  return [heading, setup, ...lines, ...(identities.length ? ["Project identities:", ...identities] : [])].join("\n");
}

async function runCodex(input, signal, jobIdentity) {
  const identity = jobIdentity ?? prepareDelegation("codex", input);
  const cwd = identity.cwd;
  const binary = agentExecutable("codex", identity.config);
  const sandbox = input.allow_edits ? "workspace-write" : "read-only";
  const startedAt = Date.now();
  const args = [
    "--sandbox", sandbox,
    "--cd", cwd,
    "exec",
    ...(jobIdentity
      ? ["--disable", "plugins", "--disable", "hooks", "-c", 'approval_policy="never"',
        "-c", "mcp_servers.agent-relay.enabled=false"]
      : ["--ignore-user-config", "--ignore-rules"]),
    "-c", 'plugins."agent-relay@agent-relay-marketplace".enabled=false'
  ];

  if (input.session_id) {
    args.push("resume", "--json");
    if (!input.allow_edits) args.push("--skip-git-repo-check");
    args.push(input.session_id, "-");
  } else {
    args.push("--json");
    if (!input.allow_edits) args.push("--skip-git-repo-check");
    args.push("-");
  }

  assertStableWorkingDirectory(identity);
  const execution = await runProcess(binary, args, cwd, processOptions(input, signal, delegatedPrompt(identity, input)));
  const parsed = parseCodexJsonl(execution.stdout);
  return buildResult({
    identity, execution, parsed, mode: sandbox, startedAt, input,
    emptyMessage: "Codex returned no final message."
  });
}

async function runClaude(input, signal, jobIdentity) {
  const identity = jobIdentity ?? prepareDelegation("claude", input);
  const cwd = identity.cwd;
  const binary = agentExecutable("claude", identity.config);
  const mode = input.allow_edits ? "acceptEdits" : "plan";
  const startedAt = Date.now();
  const args = [
    "-p",
    "--output-format", "json",
    "--permission-prompts", "none",
    "--permission-mode", mode,
    "--strict-mcp-config",
    "--safe-mode",
    "--setting-sources", "user",
    input.allow_edits ? "--tools=Read,Glob,Grep,Edit,Write,Bash" : "--tools=Read,Glob,Grep"
  ];
  if (input.allow_edits) {
    args.push("--settings", JSON.stringify({
      permissions: { blockWritesOutsideWorkingDirectories: true },
      sandbox: { enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false, autoAllowBashIfSandboxed: false }
    }));
  }

  if (input.session_id) args.push("--resume", input.session_id);

  assertStableWorkingDirectory(identity);
  const execution = await runProcess(binary, args, cwd, processOptions(input, signal, delegatedPrompt(identity, input)));
  const parsed = parseClaudeJson(execution.stdout);
  return buildResult({
    identity, execution, parsed, mode, startedAt, input,
    emptyMessage: "Claude returned no final message."
  });
}

async function runGrok(input, signal, jobIdentity) {
  const identity = jobIdentity ?? prepareDelegation("grok", input);
  const cwd = identity.cwd;
  const binary = agentExecutable("grok", identity.config);
  const mode = input.allow_edits ? "acceptEdits" : "plan";
  const startedAt = Date.now();
  const execution = await withPromptFile(delegatedPrompt(identity, input), async (promptFile) => {
    const args = [
      "--prompt-file", promptFile,
      "--output-format", "json",
      "--permission-mode", mode,
      "--cwd", cwd,
      "--no-subagents",
      "--disable-web-search"
    ];
    if (input.session_id) args.push("--resume", input.session_id);
    assertStableWorkingDirectory(identity);
    return runProcess(binary, args, cwd, processOptions(input, signal));
  });
  const parsed = parseGrokJson(execution.stdout);
  return buildResult({
    identity, execution, parsed, mode, startedAt, input,
    emptyMessage: "Grok returned no final message."
  });
}

async function runMuse(input, signal) {
  const identity = prepareDelegation("muse", input);
  const cwd = identity.cwd;
  const binary = agentExecutable("muse", identity.config);
  const mode = input.allow_edits ? "sandboxed-workspace" : "no-shell/no-write";
  const startedAt = Date.now();
  const execution = await withPromptFile(delegatedPrompt(identity, input), async (promptFile) => {
    const args = [
      "exec",
      "--json",
      "--prompt-file", promptFile,
      "--workspace", cwd,
      "--approval-mode", "never",
      "--sandbox-network", "restricted",
      "--max-model-steps", "32",
      "--max-tool-output-bytes", "1000000",
      "--no-foreign-personal-context",
      "--disable-web-tools"
    ];
    const provider = process.env.AGENT_RELAY_MUSE_PROVIDER ?? process.env.AGENT_ROUTER_MUSE_PROVIDER;
    if (provider) args.push("--provider", provider);
    if (input.allow_edits) args.push("--trust-workspace");
    else args.push("--disable-write", "--disable-shell");
    if (input.session_id) args.push("--session-id", input.session_id);
    assertStableWorkingDirectory(identity);
    return runProcess(binary, args, cwd, processOptions(input, signal));
  });
  const parsed = parseMuseJsonl(execution.stdout);
  return buildResult({
    identity, execution, parsed, mode, startedAt, input,
    emptyMessage: "Muse returned no final message."
  });
}

function buildResult({ identity, execution, parsed, mode, startedAt, input, emptyMessage }) {
  const providerOk = execution.code === 0 && !parsed.isError;
  const sessionBinding = input.session_id ? "resumed" : parsed.sessionId ? "new" : "none";
  let sessionBound = input.session_id ? true : parsed.sessionId ? false : undefined;
  let sessionBindingError;
  if (providerOk && parsed.sessionId) {
    try {
      recordSessionBinding(identity.sessionsDirectory, parsed.sessionId, identity);
      sessionBound = true;
    } catch (error) {
      sessionBound = false;
      sessionBindingError = errorMessage(error);
    }
  }
  const ok = providerOk && !sessionBindingError && !(input.job && parsed.permissionDenials?.length);
  const sessionId = parsed.sessionId ?? input.session_id;
  return {
    agent: identity.target,
    ok,
    project_id: identity.projectId,
    agent_id: identity.agentId,
    role: identity.role,
    mode,
    project_root: identity.root,
    project_root_fingerprint: createHash("sha256").update(identity.root).digest("hex").slice(0, 16),
    subdir: identity.subdir,
    cwd: identity.cwd,
    write_requested: input.allow_edits,
    write_allowed_by_policy: identity.canWrite,
    write_effective: Boolean(input.allow_edits && identity.canWrite),
    session_id: sessionId,
    session_binding: sessionBinding,
    resumed_session_id: input.session_id,
    session_bound: sessionBound,
    session_binding_error: sessionBindingError,
    config_version: 2,
    relay_version: VERSION,
    started_at: new Date(startedAt).toISOString(),
    duration_ms: Date.now() - startedAt,
    answer: trimForResult(parsed.answer || execution.stderr || emptyMessage),
    exit_code: execution.code,
    stderr: trimForResult(execution.stderr),
    permission_denials: parsed.permissionDenials,
    model: parsed.model
  };
}

function guardAgainstLoops() {
  if (ROUTER_DEPTH >= 1 || HAS_RELAY_ANCESTOR) {
    throw new Error("Nested agent delegation is blocked to prevent routing loops.");
  }
}

function guardEditPermission(identity, requested) {
  if (!requested) return;
  if (identity.target === "claude") throw new Error("Claude is hard-locked to read-only plan/review mode; allow_edits must be false");
  if (!identity.canWrite) throw new Error(`edits are disabled for agent identity ${identity.agentId}`);
}

function prepareDelegation(target, input) {
  guardAgainstLoops();
  const loaded = loadConfig(CONFIG_PATH);
  const identity = resolveDelegation(loaded, target, input);
  guardEditPermission(identity, input.allow_edits);
  if (input.session_id) assertSessionBinding(identity.sessionsDirectory, input.session_id, identity);
  return identity;
}

function delegatedPrompt(identity, input) {
  return [
    "Agent Relay project binding (authoritative):",
    `project_id=${identity.projectId}`,
    `agent_id=${identity.agentId}`,
    `role=${identity.role}`,
    `project_root=${identity.root}`,
    "Stay inside this project and follow its repository instructions.",
    input.allow_edits
      ? "Make the requested changes. Report files changed, checks run and anything blocked. Ask the initiating agent before widening scope."
      : "Review only. Report findings and leave project files untouched.",
    "",
    input.prompt
  ].join("\n");
}

function processOptions(input, signal, stdinText) {
  return {
    timeoutMilliseconds: input.timeout_seconds * 1_000,
    signal,
    stdinText,
    waitForCleanup: input.allow_edits,
    maxOutputBytes: MAX_OUTPUT_BYTES,
    env: {
      ...process.env,
      AGENT_RELAY_DEPTH: String(ROUTER_DEPTH + 1),
      AGENT_ROUTER_DEPTH: String(ROUTER_DEPTH + 1)
    }
  };
}

async function withPromptFile(prompt, callback) {
  const directory = mkdtempSync(join(tmpdir(), "agent-relay-prompt-"));
  chmodSync(directory, 0o700);
  const path = join(directory, "prompt.txt");
  writeFileSync(path, prompt, { mode: 0o600, flag: "wx" });
  try {
    return await callback(path);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function parseCodexJsonl(stdout) {
  let sessionId;
  let answer = "";
  let isError = false;
  let failure = "";
  for (const event of parseJsonLines(stdout)) {
    if (event.type === "thread.started") sessionId = event.thread_id;
    if (event.type === "item.completed" && event.item?.type === "agent_message") {
      answer = event.item.text ?? answer;
    }
    if (event.type === "turn.failed") {
      isError = true;
      failure = textValue(event.error?.message);
    }
  }
  return { sessionId, answer: failure || answer, isError };
}

function parseClaudeJson(stdout) {
  try {
    const value = JSON.parse(stdout);
    return {
      sessionId: value.session_id,
      answer: textValue(value.result),
      isError: Boolean(value.is_error),
      model: value.modelUsage ? Object.keys(value.modelUsage).join(", ") : undefined,
      permissionDenials: Array.isArray(value.permission_denials)
        ? value.permission_denials.slice(0, 20).map((item) => String(item?.tool_name ?? "tool")) : undefined
    };
  } catch {
    return { answer: stdout.trim(), isError: false };
  }
}

function parseGrokJson(stdout) {
  let sessionId;
  let answer = "";
  let isError = false;
  const whole = tryParseJson(stdout);
  const events = whole ? [whole] : parseJsonLines(stdout);

  for (const event of events) {
    sessionId = sessionId ?? event.session_id ?? event.sessionId ?? event.session?.id;
    if (event.type === "session.started" || event.type === "session_created") {
      sessionId = sessionId ?? event.id;
    }
    if (event.type === "error") {
      isError = true;
      answer = textValue(event.message) || answer;
      continue;
    }
    const candidate =
      textValue(event.result) ||
      textValue(event.output_text) ||
      textValue(event.text) ||
      textValue(event.message?.content) ||
      (event.role === "assistant" ? textValue(event.content) : "");
    if (candidate) answer = candidate;
  }
  return { sessionId, answer, isError };
}

function parseMuseJsonl(stdout) {
  let sessionId;
  let answer = "";
  let isError = false;
  let delta = "";

  for (const event of parseJsonLines(stdout)) {
    if (event.stream?.kind === "session") sessionId = sessionId ?? event.stream.id;
    if (event.payload_type === "run.output.delta") delta += textValue(event.payload?.text);
    if (event.payload_type === "run.terminal.completed") {
      answer = textValue(event.payload?.text) || delta || answer;
    }
    if (event.payload_type === "run.terminal.failed" || event.payload?.terminal === "failed") {
      isError = true;
      answer = textValue(event.payload?.reason) || textValue(event.payload?.text) || answer;
    }
  }
  return { sessionId, answer: answer || delta, isError };
}

function parseJsonLines(stdout) {
  const values = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const value = tryParseJson(line);
    if (value) values.push(value);
  }
  return values;
}

function tryParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function textValue(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((item) => textValue(item?.text ?? item?.content ?? item)).filter(Boolean).join("");
  }
  return "";
}

function toolResult(result) {
  const text = result.session_binding_error
    ? `Session binding failed after the provider completed: ${result.session_binding_error}\n\nProvider answer:\n${result.answer}`
    : result.answer;
  return {
    content: [{ type: "text", text }],
    structuredContent: result,
    isError: !result.ok
  };
}

function toolError(agent, error, input) {
  const message = errorMessage(error);
  return {
    content: [{ type: "text", text: message }],
    structuredContent: {
      agent,
      ok: false,
      project_id: input?.project_id,
      agent_id: input?.agent_id,
      config_version: 2,
      relay_version: VERSION,
      error: message
    },
    isError: true
  };
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function trimForResult(value) {
  const trimmed = stripAnsi(value).trim();
  return trimmed.length > 4_000 ? `${trimmed.slice(0, 4_000)}\n[truncated]` : trimmed;
}

function stripAnsi(value) {
  return String(value).replace(/\u001B\[[0-?]*[ -\/]*[@-~]/g, "");
}

function loadConfiguration() {
  try {
    return loadConfig(CONFIG_PATH);
  } catch (error) {
    return undefined;
  }
}

function describeConfiguration(loaded) {
  let error;
  if (!loaded) {
    try { loadConfig(CONFIG_PATH); }
    catch (caught) { error = errorMessage(caught); }
  }
  return {
    configured: Boolean(loaded),
    config_path: CONFIG_PATH,
    project_count: loaded?.config.projects.length ?? 0,
    error
  };
}

function detectRelayAncestor() {
  if (process.platform === "win32") return false;
  let pid = process.ppid;
  for (let depth = 0; depth < 32 && pid > 1; depth += 1) {
    try {
      const line = execFileSync("ps", ["-o", "ppid=,command=", "-p", String(pid)], {
        encoding: "utf8",
        timeout: 1_000,
        stdio: ["ignore", "pipe", "ignore"]
      }).trim();
      const match = line.match(/^(\d+)\s+([\s\S]+)$/);
      if (!match) return false;
      const command = match[2];
      if (/router[\\/](?:src|dist)[\\/]server\.mjs(?:\s|$)/i.test(command) && /--(?:host|target|targets)(?:\s|=)/.test(command)) {
        return true;
      }
      pid = Number.parseInt(match[1], 10);
    } catch {
      return false;
    }
  }
  return false;
}
