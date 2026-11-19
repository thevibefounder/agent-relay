import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const temporary = realpathSync.native(mkdtempSync(join(tmpdir(), "agent-relay-jobs-test-")));
const project = join(temporary, "project");
const policy = join(temporary, "policy");
const config = join(policy, "config.json");
const fake = fileURLToPath(new URL("./fake-cli.mjs", import.meta.url));
const server = process.env.AGENT_RELAY_SERVER ?? fileURLToPath(new URL("../src/server.mjs", import.meta.url));
mkdirSync(project);
mkdirSync(policy, { mode: 0o700 });
writeFileSync(config, JSON.stringify({
  version: 2, projects: [{ id: "workspace", root: project, agents: ["claude", "codex"].map((target) => ({
    id: target, target, role: "collaborator", can_write: true
  })) }]
}), { mode: 0o600 });

const connections = [];
try {
  const claude = await connect("claude", "codex");
  const codex = await connect("codex", "claude");
  const names = (await claude.listTools()).tools.map(({ name }) => name).sort();
  assert.deepEqual(names, ["ask_agent", "cancel", "get_result", "list_available_agents"]);
  const review = await call(claude, "ask_agent", { agent: "codex", task: "Review this." });
  assert.equal(review.status, "running");
  assert.equal((await call(claude, "get_result", { job_id: review.job_id })).status, "running");
  const receipt = await result(claude, review.job_id);
  assert.equal(receipt.status, "completed");
  assert.equal(receipt.session_bound, true);
  const reviewLaunch = capture("codex");
  assert.match(reviewLaunch.prompt, /Review only.*leave project files untouched/);
  assert.ok(reviewLaunch.args.includes("read-only"));
  assert.equal(reviewLaunch.args.includes("--ignore-user-config"), false);

  const edit = await call(codex, "ask_agent", { agent: "claude", task: "Implement this.", mode: "edit" });
  const busy = await claude.callTool({ name: "ask_agent", arguments: { agent: "codex", task: "Edit too.", mode: "edit" } });
  assert.equal(busy.isError, true);
  assert.match(busy.content[0].text, /already has an Agent Relay writer/);
  const editResult = await result(codex, edit.job_id);
  assert.equal(editResult.status, "completed");
  assert.ok(editResult.git_after);
  assert.match(capture("claude").prompt, /Report files changed, checks run and anything blocked/);
  assert.ok(capture("claude").args.includes("acceptEdits"));

  const continuation = await call(codex, "ask_agent", {
    agent: "claude", task: "Continue.", mode: "edit", continue_from: edit.job_id
  });
  assert.equal((await result(codex, continuation.job_id)).status, "completed");
  assert.ok(capture("claude").args.includes("--resume"));
  assert.ok(capture("claude").args.includes("job-claude"));

  const cancelled = await call(claude, "ask_agent", { agent: "codex", task: "Cancel this.", mode: "edit" });
  assert.equal((await call(claude, "cancel", { job_id: cancelled.job_id })).status, "cancelling");
  const cancelledResult = await result(claude, cancelled.job_id);
  assert.equal(cancelledResult.status, "cancelled");
  assert.equal(cancelledResult.inspect_worktree, true);
  const next = await call(claude, "ask_agent", { agent: "codex", task: "Try again.", mode: "edit" });
  assert.equal((await result(claude, next.job_id)).status, "completed");
} finally {
  await Promise.all(connections.map((transport) => transport.close()));
  rmSync(temporary, { recursive: true, force: true });
}
console.log("Agent Relay job, continuation, permission mode and cross-host writer lock checks passed.");

async function connect(host, target) {
  const client = new Client({ name: "relay-job-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath, args: [server, "--host", host, "--project", "workspace"],
    env: {
      ...process.env, AGENT_RELAY_CONFIG: config, CLAUDE_CLI_PATH: fake, CODEX_CLI_PATH: fake,
      AGENT_RELAY_FAKE_AGENT: target, AGENT_RELAY_FAKE_SESSION_ID: `job-${target}`,
      AGENT_RELAY_FAKE_CAPTURE: join(temporary, `${target}.json`), AGENT_RELAY_FAKE_DELAY: "400"
    }
  });
  connections.push(transport);
  await client.connect(transport);
  return client;
}

async function call(client, name, args) {
  const response = await client.callTool({ name, arguments: args });
  assert.equal(Boolean(response.isError), false, JSON.stringify(response.content));
  return response.structuredContent;
}

function result(client, id) {
  return call(client, "get_result", { job_id: id, wait_seconds: 5 });
}

function capture(target) {
  return JSON.parse(readFileSync(join(temporary, `${target}.json`), "utf8"));
}
