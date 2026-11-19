#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const server = fileURLToPath(new URL("../dist/server.mjs", import.meta.url));
for (const test of ["smoke-test.mjs", "safety-test.mjs", "hardening-test.mjs", "jobs-test.mjs"]) {
  const path = fileURLToPath(new URL(`./${test}`, import.meta.url));
  const result = spawnSync(process.execPath, [path], {
    env: { ...process.env, AGENT_RELAY_SERVER: server },
    stdio: "inherit"
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
process.stdout.write("Agent Relay bundled-router tests passed.\n");
