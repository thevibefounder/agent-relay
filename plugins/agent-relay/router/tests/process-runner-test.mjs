#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runProcess } from "../src/process-runner.mjs";

const fake = fileURLToPath(new URL("./fake-cli.mjs", import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), "agent-relay-process-test-"));

const utf8 = await runProcess(process.execPath, [fake], temporary, {
  timeoutMilliseconds: 5_000,
  env: { ...process.env, AGENT_RELAY_FAKE_MODE: "raw-utf8" },
  maxOutputBytes: 2 * 1024 * 1024
});
assert.equal(utf8.stdout, "🙂漢字".repeat(20_000));

await assertTerminated("timeout", async (pidFile) => {
  await assert.rejects(
    runProcess(process.execPath, [fake], temporary, {
      timeoutMilliseconds: 100,
      env: { ...process.env, AGENT_RELAY_FAKE_MODE: "hang", AGENT_RELAY_FAKE_PID_FILE: pidFile }
    }),
    /exceeded 1 seconds/i
  );
});

await assertTerminated("cancellation", async (pidFile) => {
  const controller = new AbortController();
  const running = runProcess(process.execPath, [fake], temporary, {
    timeoutMilliseconds: 5_000,
    signal: controller.signal,
    env: { ...process.env, AGENT_RELAY_FAKE_MODE: "hang", AGENT_RELAY_FAKE_PID_FILE: pidFile }
  });
  setTimeout(() => controller.abort(), 100);
  await assert.rejects(running, /cancelled by the host/i);
});

await assert.rejects(
  runProcess(process.execPath, [fake], temporary, {
    timeoutMilliseconds: 5_000,
    env: { ...process.env, AGENT_RELAY_FAKE_MODE: "overflow" },
    maxOutputBytes: 1_024
  }),
  /output exceeded 1024 bytes/i
);

// The parent exits on TERM but its descendant ignores TERM. Returning the error
// must not clear the pending SIGKILL or let Node exit before escalation runs.
for (const trigger of ["timeout", "cancellation"]) {
  const pidFile = join(temporary, `parent-exits-${trigger}.json`);
  const controller = new AbortController();
  const running = runProcess(process.execPath, [fake], temporary, {
    timeoutMilliseconds: trigger === "timeout" ? 300 : 5000,
    signal: controller.signal,
    env: { ...process.env, AGENT_RELAY_FAKE_MODE: "exit-on-term", AGENT_RELAY_FAKE_PID_FILE: pidFile }
  });
  if (trigger === "cancellation") setTimeout(() => controller.abort(), 300);
  await assert.rejects(running, /exceeded|cancelled/);
  const pids = JSON.parse(readFileSync(pidFile, "utf8"));
  const deadline = Date.now() + 2000;
  while (isAlive(pids.descendant) && Date.now() < deadline) await delay(50);
  assert.equal(isAlive(pids.parent), false, `${trigger} parent survived`);
  assert.equal(isAlive(pids.descendant), false, `${trigger} TERM-ignoring descendant survived parent exit`);
}

process.stdout.write("Agent Relay process-tree, cancellation, output-cap, and UTF-8 tests passed.\n");

async function assertTerminated(name, run) {
  const pidFile = join(temporary, `${name}.json`);
  await run(pidFile);
  await delay(150);
  const pids = JSON.parse(readFileSync(pidFile, "utf8"));
  assert.equal(isAlive(pids.parent), false, `${name} parent process survived`);
  assert.equal(isAlive(pids.descendant), false, `${name} descendant process survived`);
}

function isAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error?.code === "ESRCH") return false; throw error; }
}

function delay(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
