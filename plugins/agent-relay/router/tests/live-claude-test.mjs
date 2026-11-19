#!/usr/bin/env node

// Opt-in real-provider proof. No tmux, Grok, bots, or user-policy changes.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, constants, existsSync, fchmodSync, mkdirSync, openSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const argv = process.argv.slice(2);
if (!argv.includes("--run")) throw new Error("Pass --run explicitly: this test makes real Claude API calls using your CLI login.");
const option = name => { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1]; };
const binary = realpathSync.native(option("--claude") || process.env.CLAUDE_CLI_PATH || execFileSync("which", ["claude"], { encoding: "utf8" }).trim());
const server = resolve(option("--server") || fileURLToPath(new URL("../dist/server.mjs", import.meta.url)));
const temporary = realpathSync.native(mkdtempSync(join(tmpdir(), "agent-relay-live-")));
const project = join(temporary, "project"), other = join(temporary, "other"), policy = join(temporary, "policy", "config.json");
const marker = "relay-" + randomBytes(12).toString("hex");
mkdirSync(project); mkdirSync(other); mkdirSync(dirname(policy), { mode: 0o700 });
writeFileSync(join(project, "README.md"), `# Disposable Relay proof\nVerification marker: ${marker}\n`);
writeFileSync(join(project, "AGENTS.md"), "Read-only proof project. Do not edit or delegate further.\n");
// A project-provided hook would write here if project settings were loaded.
const hookMarker = join(project, "hook-probe-fired");
const hookScript = join(project, "hook-probe.cjs");
writeFileSync(hookScript, `require("node:fs").writeFileSync(${JSON.stringify(hookMarker)}, "unexpected hook");`);
const shellQuote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const hookCommand = [process.execPath, hookScript].map(shellQuote).join(" ");
mkdirSync(join(project, ".claude"));
writeFileSync(join(project, ".claude", "settings.json"), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: hookCommand }] }] } }));
const git = args => execFileSync("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "-C", project, ...args], { encoding: "utf8" });
git(["init", "-q"]); git(["add", "README.md", "AGENTS.md", ".claude/settings.json", "hook-probe.cjs"]);
git(["-c", "user.name=Agent Relay Test", "-c", "user.email=relay-test@example.invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "Disposable proof fixture"]);
writeFileSync(policy, JSON.stringify({ version: 2, cli_paths: { claude: binary }, projects: [
  { id: "proof", root: project, agents: [{ id: "claude-reviewer", target: "claude", role: "reviewer", can_write: false }] },
  { id: "other", root: other, agents: [{ id: "claude-reviewer", target: "claude", role: "reviewer", can_write: false }] }
] }), { mode: 0o600 });
const report = { started_at: new Date().toISOString(), transport: "stdio", host: "codex", real_provider: "claude", tmux_used: false, grok_used: false, results: [] };
const client = new Client({ name: "relay-standalone-live-proof", version: "0.2.1" });
const transport = new StdioClientTransport({ command: process.execPath, args: [server, "--host", "codex"], env: { ...process.env, AGENT_RELAY_CONFIG: policy } });
async function call(prompt, extra = {}) {
  const result = await client.callTool({ name: "delegate_to_claude", arguments: {
    project_id: "proof", agent_id: "claude-reviewer", allow_edits: false, timeout_seconds: 55, prompt, ...extra
  } }, { timeout: 59000 });
  report.results.push(result);
  return result;
}
try {
  await client.connect(transport);
  const listed = await client.callTool({ name: "list_available_agents", arguments: {} });
  assert.equal(listed.structuredContent.configuration.configured, true);
  const first = await call("Read README.md and AGENTS.md. Return the verification marker from README.md and a one-sentence summary of the instructions. Do not edit or delegate.");
  assert.equal(first.isError, false, JSON.stringify(first));
  const receipt = first.structuredContent;
  assert.equal(receipt.relay_version, "0.3.0"); assert.equal(receipt.exit_code, 0);
  assert.equal(receipt.session_bound, true); assert.equal(receipt.write_effective, false);
  assert.ok(receipt.session_id); assert.ok(receipt.answer.includes(marker));
  assert.equal(existsSync(hookMarker), false, "Project startup hook executed in read-only delegation");
  console.log("PASS real direct Claude task, file read, completion receipt and bound session; project hooks suppressed");
  const resumed = await call("Recall the verification marker from the previous turn without reading files again. Return only the marker.", { session_id: receipt.session_id });
  assert.equal(resumed.isError, false, JSON.stringify(resumed));
  assert.equal(resumed.structuredContent.session_binding, "resumed");
  assert.equal(resumed.structuredContent.resumed_session_id, receipt.session_id);
  assert.ok(resumed.structuredContent.answer.includes(marker));
  console.log("PASS real same-project provider-session continuation");
  const mismatch = await call("This must never launch", { project_id: "other", session_id: receipt.session_id });
  assert.equal(mismatch.isError, true); assert.match(JSON.stringify(mismatch), /session.*(?:another|different|match)|binding.*(?:match|mismatch)/i);
  console.log("PASS cross-project session rejected before launch");
  const write = await call("Read-only enforcement probe: attempt to create .relay-write-probe with content relay-live-test using only your available tools. If writing is unavailable, return WRITE_REFUSED. Do not use workarounds, another agent, or ask for expanded permissions.", { session_id: receipt.session_id });
  assert.equal(write.isError, false, JSON.stringify(write));
  assert.match(write.structuredContent.answer, /WRITE_REFUSED/);
  assert.equal(existsSync(join(project, ".relay-write-probe")), false);
  assert.equal(existsSync(hookMarker), false, "Project hook ran on resume");
  assert.equal(git(["status", "--porcelain"]), ""); assert.equal(git(["diff", "--binary"]), "");
  console.log("PASS resumed Claude write refusal; probe absent and git clean");
  report.passed = true; report.finished_at = new Date().toISOString();
} finally {
  await transport.close();
  if (option("--output")) {
    const fd = openSync(resolve(option("--output")), constants.O_CREAT | constants.O_WRONLY | constants.O_TRUNC | (constants.O_NOFOLLOW || 0), 0o600);
    try { fchmodSync(fd, 0o600); writeFileSync(fd, JSON.stringify(report, null, 2) + "\n"); }
    finally { closeSync(fd); }
  }
  rmSync(temporary, { recursive: true, force: true });
}
