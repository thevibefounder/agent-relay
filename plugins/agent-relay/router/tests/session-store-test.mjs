#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { assertSessionBinding, recordSessionBinding } from "../src/session-store.mjs";

const temporary = mkdtempSync(join(tmpdir(), "agent-relay-session-store-"));
const directory = join(temporary, "sessions");
const identity = {
  projectId: "project",
  agentId: "codex-project",
  target: "codex",
  root: "/canonical/project"
};
const worker = fileURLToPath(new URL("./session-store-worker.mjs", import.meta.url));

await Promise.all(Array.from({ length: 8 }, () => runWorker(worker, directory, "concurrent-session")));
assertSessionBinding(directory, "concurrent-session", identity);
const path = bindingPath(directory, "concurrent-session");
assert.equal(JSON.parse(readFileSync(path, "utf8")).agent_id, "codex-project");
if (process.platform !== "win32") {
  assert.equal(lstatSync(directory).mode & 0o777, 0o700);
  assert.equal(lstatSync(path).mode & 0o777, 0o600);
}

assert.throws(() => recordSessionBinding(directory, { invalid: true }, identity), /invalid session_id/i);
assert.throws(() => assertSessionBinding(directory, "concurrent-session", { ...identity, agentId: "other" }), /different agent_id/i);

if (process.platform !== "win32") {
  const insecureDirectory = join(temporary, "insecure");
  mkdirSync(insecureDirectory, { mode: 0o755 });
  assert.throws(() => recordSessionBinding(insecureDirectory, "session", identity), /group or world/i);

  const linkedDirectory = join(temporary, "linked");
  symlinkSync(directory, linkedDirectory);
  assert.throws(() => assertSessionBinding(linkedDirectory, "concurrent-session", identity), /real directory/i);

  chmodSync(path, 0o644);
  assert.throws(() => assertSessionBinding(directory, "concurrent-session", identity), /group or world/i);
}

process.stdout.write("Agent Relay atomic session-store and permission tests passed.\n");

function bindingPath(root, sessionId) {
  return join(root, `${createHash("sha256").update(sessionId).digest("hex")}.json`);
}

function runWorker(script, store, sessionId) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [script, store, sessionId], { stdio: ["ignore", "pipe", "pipe"] });
    const stderr = [];
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.once("error", rejectPromise);
    child.once("exit", (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(Buffer.concat(stderr).toString("utf8") || `worker exited ${code}`));
    });
  });
}
