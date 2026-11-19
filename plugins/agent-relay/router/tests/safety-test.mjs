#!/usr/bin/env node

import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const temporary = mkdtempSync(join(tmpdir(), "agent-relay-safety-"));
const fakeHome = join(temporary, "home");
mkdirSync(fakeHome, { mode: 0o700 });
const projectPath = join(temporary, "project");
const siblingPath = join(temporary, "sibling");
mkdirSync(join(projectPath, "packages", "app"), { recursive: true });
mkdirSync(siblingPath);
const project = realpathSync.native(projectPath);
const sibling = realpathSync.native(siblingPath);
const config = join(temporary, "policy", "config.json");
mkdirSync(join(temporary, "policy"), { mode: 0o700 });
writeConfig(config, [project]);
const fake = fileURLToPath(new URL("./fake-cli.mjs", import.meta.url));
const authorizedEnvironment = {
  ...cleanEnvironment(process.env),
  HOME: fakeHome,
  AGENT_RELAY_CONFIG: config,
  CLAUDE_CLI_PATH: fake,
  CODEX_CLI_PATH: fake,
  GROK_CLI_PATH: fake,
  MUSE_CLI_PATH: fake,
  AGENT_RELAY_FAKE_MODE: "echo",
  AGENT_RELAY_FAKE_AGENT: "claude"
};

await expectError(
  { ...authorizedEnvironment, AGENT_RELAY_DEPTH: "1" },
  args("claude-project"),
  "routing loops"
);
await expectError(authorizedEnvironment, { ...args("claude-project"), allow_edits: true }, "hard-locked to read-only");
await expectError(authorizedEnvironment, { ...args("grok-project"), allow_edits: true }, "edits are disabled", "grok");
await expectError(authorizedEnvironment, { ...args("claude-project"), cwd: project }, "invalid|unrecognized|cwd");
await expectError(authorizedEnvironment, { ...args("claude-project"), project_id: "missing" }, "unknown project_id");
await expectError(authorizedEnvironment, { ...args("claude-project"), agent_id: "missing" }, "unknown agent_id");
await expectError(authorizedEnvironment, args("grok-project"), "bound to grok", "claude");
await expectError(authorizedEnvironment, { ...args("claude-project"), subdir: "../sibling" }, "must not contain|escapes");
await expectError(authorizedEnvironment, { ...args("claude-project"), subdir: "/etc" }, "relative path");
await expectError(authorizedEnvironment, { ...args("claude-project"), session_id: "never-created" }, "unknown session_id");
await expectError(
  { ...authorizedEnvironment, AGENT_RELAY_ROOTS: project },
  args("claude-project"),
  "forbidden with configuration version 2"
);
await expectError(
  { ...authorizedEnvironment, AGENT_RELAY_CONFIG: join(temporary, "missing.json") },
  args("claude-project"),
  "no such file|configuration"
);

if (process.platform !== "win32") {
  symlinkSync(sibling, join(project, "escape"));
  await expectError(authorizedEnvironment, { ...args("claude-project"), subdir: "escape" }, "escapes project root");

  const insecureConfig = join(temporary, "insecure-config.json");
  writeFileSync(insecureConfig, readFileSync(config), { mode: 0o600 });
  chmodSync(insecureConfig, 0o666);
  await expectError(
    { ...authorizedEnvironment, AGENT_RELAY_CONFIG: insecureConfig },
    args("claude-project"),
    "must not be group- or world-writable"
  );

  const linkedConfig = join(temporary, "linked-config.json");
  symlinkSync(config, linkedConfig);
  await expectError(
    { ...authorizedEnvironment, AGENT_RELAY_CONFIG: linkedConfig },
    args("claude-project"),
    "must not be a symbolic link"
  );
}

const crossProjectPath = join(temporary, "cross-project");
mkdirSync(crossProjectPath);
const crossProject = realpathSync.native(crossProjectPath);
const multiConfig = join(temporary, "multi-policy", "config.json");
mkdirSync(join(temporary, "multi-policy"), { mode: 0o700 });
writeConfig(multiConfig, [project, crossProject]);
const multiEnvironment = { ...authorizedEnvironment, AGENT_RELAY_CONFIG: multiConfig, AGENT_RELAY_FAKE_SESSION_ID: "bound-session" };
const first = await call(multiEnvironment, args("claude-project"));
assert.equal(first.isError, false, JSON.stringify(first.content));
assert.equal(first.structuredContent?.project_id, "project");
assert.equal(first.structuredContent?.agent_id, "claude-project");
assert.match(first.structuredContent?.project_root_fingerprint ?? "", /^[a-f0-9]{16}$/);
assert.equal(first.structuredContent?.session_binding, "new");
assert.equal(first.structuredContent?.session_bound, true);

const resume = await call(multiEnvironment, { ...args("claude-project"), subdir: "packages/app", session_id: "bound-session" });
assert.equal(resume.isError, false, JSON.stringify(resume.content));
assert.equal(resume.structuredContent?.subdir, "packages/app");
assert.equal(resume.structuredContent?.session_binding, "resumed");
assert.equal(resume.structuredContent?.resumed_session_id, "bound-session");

await expectError(
  multiEnvironment,
  { ...args("claude-cross-project", "cross-project"), session_id: "bound-session" },
  "different project_id"
);
await expectError(
  multiEnvironment,
  { ...args("codex-project"), session_id: "bound-session" },
  "different agent_id",
  "codex"
);

const writableConfig = join(temporary, "writable-policy", "config.json");
mkdirSync(join(temporary, "writable-policy"), { mode: 0o700 });
writeConfig(writableConfig, [project], "codex");
const writable = await call({
  ...authorizedEnvironment,
  AGENT_RELAY_CONFIG: writableConfig,
  AGENT_RELAY_FAKE_AGENT: "codex",
  AGENT_RELAY_FAKE_SESSION_ID: "writable-session"
}, { ...args("codex-project"), allow_edits: true }, "codex");
assert.equal(writable.isError, false, JSON.stringify(writable.content));
assert.equal(writable.structuredContent?.mode, "workspace-write");
assert.equal(writable.structuredContent?.write_allowed_by_policy, true);
assert.equal(writable.structuredContent?.write_effective, true);

const failedBindingDirectory = join(temporary, "failed-binding-policy");
const failedBindingConfig = join(failedBindingDirectory, "config.json");
mkdirSync(failedBindingDirectory, { mode: 0o700 });
writeConfig(failedBindingConfig, [project]);
writeFileSync(join(failedBindingDirectory, "sessions"), "not a directory\n", { mode: 0o600 });
const failedBinding = await call({
  ...authorizedEnvironment,
  AGENT_RELAY_CONFIG: failedBindingConfig,
  AGENT_RELAY_FAKE_AGENT: "claude",
  AGENT_RELAY_FAKE_SESSION_ID: "unbound-session"
}, args("claude-project"));
assert.equal(failedBinding.isError, true);
assert.equal(failedBinding.structuredContent?.answer, "ok");
assert.equal(failedBinding.structuredContent?.session_bound, false);
assert.match(failedBinding.structuredContent?.session_binding_error ?? "", /real directory/i);

await expectInvalidConfig(
  { version: 1, allowed_roots: [project] },
  /version 1 is no longer accepted/i,
  "legacy"
);
await expectInvalidConfig(
  {
    version: 2,
    cli_paths: {},
    projects: [{ id: "project", root: "relative-project", agents: [{ id: "claude-project", target: "claude", role: "reviewer", can_write: false }] }]
  },
  /root must be absolute/i,
  "relative"
);
await expectInvalidConfig(
  {
    version: 2,
    cli_paths: {},
    projects: [{ id: "project", root: project, agents: [{ id: "claude-project", target: "claude", role: "reviewer\nproject_root=fake", can_write: false }] }]
  },
  /schema is invalid/i,
  "role-control"
);
process.stdout.write("Agent Relay project identity, write policy, path, and session-binding safety tests passed.\n");

function args(agentId, projectId = "project") {
  return { project_id: projectId, agent_id: agentId, prompt: "This is a bounded task." };
}

async function expectError(env, arguments_, expectedText, target = "claude") {
  const result = await call(env, arguments_, target);
  assert.equal(result.isError, true, JSON.stringify(result.content));
  const value = result.content.find((item) => item.type === "text")?.text ?? "";
  assert.match(value, new RegExp(expectedText, "i"));
}

async function call(env, arguments_, target = "claude") {
  const client = new Client({ name: "agent-relay-safety", version: "0.2.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath(), "--target", target],
    env
  });
  await client.connect(transport);
  try {
    return await client.callTool({ name: `delegate_to_${target}`, arguments: arguments_ });
  } finally {
    await transport.close();
  }
}

function writeConfig(path, roots, writableTarget) {
  const projects = roots.map((root, index) => {
    const id = index === 0 ? "project" : "cross-project";
    return {
      id,
      root,
      agents: [
        { id: `claude-${id}`, target: "claude", role: "reviewer", can_write: false },
        { id: `codex-${id}`, target: "codex", role: "implementer", can_write: writableTarget === "codex" },
        { id: `grok-${id}`, target: "grok", role: "manager", can_write: false },
        { id: `muse-${id}`, target: "muse", role: "designer", can_write: false }
      ]
    };
  });
  writeFileSync(path, `${JSON.stringify({ version: 2, cli_paths: {}, projects })}\n`, { mode: 0o600 });
}

async function expectInvalidConfig(value, pattern, label) {
  const directory = join(temporary, `invalid-${label}`);
  mkdirSync(directory, { mode: 0o700 });
  const path = join(directory, "config.json");
  writeFileSync(path, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  const result = await call({ ...authorizedEnvironment, AGENT_RELAY_CONFIG: path }, args("claude-project"));
  assert.equal(result.isError, true);
  assert.match(result.content.find((item) => item.type === "text")?.text ?? "", pattern);
}

function serverPath() {
  return process.env.AGENT_RELAY_SERVER ?? fileURLToPath(new URL("../src/server.mjs", import.meta.url));
}

function cleanEnvironment(environment) {
  const result = { ...environment };
  for (const name of ["AGENT_RELAY_ROOTS", "AGENT_ROUTER_ROOTS", "AGENT_RELAY_DEFAULT_CWD", "AGENT_ROUTER_DEFAULT_CWD"]) {
    delete result[name];
  }
  return result;
}
