#!/usr/bin/env node

import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const agents = ["claude", "codex", "grok", "muse"];

for (const target of agents) {
  await assertTools(
    ["--target", target],
    ["list_available_agents", `delegate_to_${target}`]
  );
}

for (const host of ["claude", "codex", "grok", "muse"]) {
  await assertTools(
    ["--host", host],
    [
      "list_available_agents",
      ...agents.filter((agent) => agent !== host).map((agent) => `delegate_to_${agent}`)
    ]
  );
}

process.stdout.write("Agent Relay MCP handshake and tool discovery passed.\n");

async function assertTools(args, expected) {
  const { client, transport } = await connect(args);
  try {
    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, [...expected].sort());
  } finally {
    await transport.close();
  }
}

async function connect(args, env = process.env) {
  const client = new Client({ name: "agent-relay-smoke", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath(), ...args],
    env
  });
  await client.connect(transport);
  return { client, transport };
}

function serverPath() {
  return process.env.AGENT_RELAY_SERVER ?? fileURLToPath(new URL("../src/server.mjs", import.meta.url));
}
