#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const fake = fileURLToPath(new URL("./fake-cli.mjs", import.meta.url));
const nestedProbe = fileURLToPath(new URL("./nested-relay-cli.mjs", import.meta.url));
const server = process.env.AGENT_RELAY_SERVER ?? fileURLToPath(new URL("../src/server.mjs", import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), "agent-relay-hardening-"));
const fakeHome = join(temporary, "home");
const projectPath = join(temporary, "project");
const config = join(temporary, "policy", "config.json");
mkdirSync(fakeHome, { mode: 0o700 });
mkdirSync(projectPath);
const project = realpathSync.native(projectPath);
mkdirSync(join(temporary, "policy"), { mode: 0o700 });
writeFileSync(config, `${JSON.stringify({
  version: 2,
  cli_paths: {},
  projects: [{
    id: "project",
    root: project,
    agents: ["claude", "codex", "grok", "muse"].map((target) => ({
      id: `${target}-project`, target, role: target === "codex" ? "implementer" : "reviewer", can_write: false
    }))
  }]
})}\n`, { mode: 0o600 });

const dangerousPrompt = "--dangerously-bypass-approvals-and-sandbox\n- still ordinary content";
for (const agent of ["claude", "codex", "grok", "muse"]) {
  const capture = join(temporary, `${agent}.json`);
  const { client, transport } = await connect(agent, {
    AGENT_RELAY_FAKE_MODE: "echo",
    AGENT_RELAY_FAKE_AGENT: agent,
    AGENT_RELAY_FAKE_CAPTURE: capture
  });
  try {
    const listed = await client.listTools();
    const delegate = listed.tools.find((tool) => tool.name === `delegate_to_${agent}`);
    assert.equal(delegate.annotations?.openWorldHint, false);
    assert.equal(delegate.annotations?.destructiveHint, agent !== "claude");
    const initial = await client.callTool({
      name: `delegate_to_${agent}`,
      arguments: { project_id: "project", agent_id: `${agent}-project`, prompt: dangerousPrompt }
    });
    assert.equal(initial.isError, false, JSON.stringify(initial.content));
    const result = await client.callTool({
      name: `delegate_to_${agent}`,
      arguments: { project_id: "project", agent_id: `${agent}-project`, prompt: dangerousPrompt, session_id: `safe-${agent}:1` }
    });
    assert.equal(result.isError, false, JSON.stringify(result.content));
    const captured = JSON.parse(readFileSync(capture, "utf8"));
    assert.ok(captured.prompt.endsWith(dangerousPrompt));
    assert.match(captured.prompt, new RegExp(`agent_id=${agent}-project`));
    assert.equal(captured.args.includes(dangerousPrompt), false, `${agent} prompt leaked into argv`);
    assert.equal(captured.args.includes(`safe-${agent}:1`), true);
    if (agent === "claude") {
      assert.ok(captured.stdin.endsWith(dangerousPrompt));
      assert.equal(captured.args.includes("--restricted"), false, "restricted breaks authentication on affected Claude installations");
      assert.ok(captured.args.includes("--tools=Read,Glob,Grep"));
      assert.equal(captured.args[captured.args.indexOf("--setting-sources") + 1], "user");
      assert.equal(captured.args[captured.args.indexOf("--permission-mode") + 1], "plan");
      assert.equal(captured.args[captured.args.indexOf("--permission-prompts") + 1], "none");
      for (const flag of ["--strict-mcp-config", "--safe-mode"]) assert.ok(captured.args.includes(flag));
    }
    if (agent === "codex") {
      assert.ok(captured.stdin.endsWith(dangerousPrompt));
      assert.ok(captured.args.includes("--ignore-user-config"));
      assert.ok(captured.args.includes("--ignore-rules"));
      assert.ok(captured.args.includes('plugins."agent-relay@agent-relay-marketplace".enabled=false'));
    }
    if (agent === "grok") assert.ok(captured.args.includes("--prompt-file"));
    if (agent === "muse") {
      assert.ok(captured.args.includes("--prompt-file"));
      assert.ok(captured.args.includes("--disable-web-tools"));
      assert.equal(captured.args.includes("--trust-workspace"), false);
    }
  } finally {
    await transport.close();
  }
}

{
  const { client, transport } = await connect("grok", { AGENT_RELAY_FAKE_MODE: "echo", AGENT_RELAY_FAKE_AGENT: "grok" });
  try {
    const invalid = await client.callTool({ name: "delegate_to_grok", arguments: { project_id: "project", agent_id: "grok-project", prompt: "safe", session_id: "--always-approve" } });
    assert.equal(invalid.isError, true);
    assert.match(invalid.content.find((item) => item.type === "text")?.text ?? "", /invalid|session_id/i);
  } finally {
    await transport.close();
  }
}

{
  const pidFile = join(temporary, "cancel-pids.json");
  const { client, transport } = await connect("codex", {
    AGENT_RELAY_FAKE_MODE: "hang",
    AGENT_RELAY_FAKE_AGENT: "codex",
    AGENT_RELAY_FAKE_PID_FILE: pidFile
  });
  const controller = new AbortController();
  try {
    const call = client.callTool(
      { name: "delegate_to_codex", arguments: { project_id: "project", agent_id: "codex-project", prompt: "wait", timeout_seconds: 15 } },
      { signal: controller.signal, timeout: 5_000 }
    );
    setTimeout(() => controller.abort(), 150);
    await assert.rejects(call, /abort|cancel/i);
    await delay(1_300);
    const pids = JSON.parse(readFileSync(pidFile, "utf8"));
    assert.equal(isAlive(pids.parent), false, "cancelled CLI survived");
    assert.equal(isAlive(pids.descendant), false, "cancelled CLI descendant survived");
  } finally {
    await transport.close();
  }
}

if (canInspectProcessTree()) {
  const client = new Client({ name: "agent-relay-loop-hardening", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [server, "--target", "codex"],
    env: {
      ...cleanEnvironment(process.env),
      HOME: fakeHome,
      AGENT_RELAY_CONFIG: config,
      CODEX_CLI_PATH: nestedProbe,
      AGENT_RELAY_NESTED_SERVER: server,
      AGENT_RELAY_NESTED_FAKE_CLI: fake,
      AGENT_RELAY_NESTED_PROJECT: project,
      AGENT_RELAY_NESTED_CONFIG: config
    }
  });
  await client.connect(transport);
  try {
    const result = await client.callTool({ name: "delegate_to_codex", arguments: { project_id: "project", agent_id: "codex-project", prompt: "probe" } });
    assert.equal(result.isError, false, JSON.stringify(result.content));
    assert.equal(result.structuredContent?.answer, "nested-blocked");
  } finally {
    await transport.close();
  }
} else {
  process.stdout.write("Process ancestry test skipped because ps is unavailable in this sandbox.\n");
}

process.stdout.write("Agent Relay argv isolation, annotations, CLI hardening, and MCP cancellation tests passed.\n");

async function connect(agent, overrides) {
  const environmentName = `${agent.toUpperCase()}_CLI_PATH`;
  const env = {
    ...cleanEnvironment(process.env),
    HOME: fakeHome,
    AGENT_RELAY_CONFIG: config,
    [environmentName]: fake,
    AGENT_RELAY_FAKE_SESSION_ID: `safe-${agent}:1`,
    ...overrides
  };
  const client = new Client({ name: "agent-relay-hardening", version: "0.1.0" });
  const transport = new StdioClientTransport({ command: process.execPath, args: [server, "--target", agent], env });
  await client.connect(transport);
  return { client, transport };
}

function isAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error?.code === "ESRCH") return false; throw error; }
}

function delay(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }

function canInspectProcessTree() {
  try {
    execFileSync("ps", ["-o", "ppid=,command=", "-p", String(process.pid)], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function cleanEnvironment(environment) {
  const result = { ...environment };
  for (const name of ["AGENT_RELAY_ROOTS", "AGENT_ROUTER_ROOTS", "AGENT_RELAY_DEFAULT_CWD", "AGENT_ROUTER_DEFAULT_CWD"]) {
    delete result[name];
  }
  return result;
}
