#!/usr/bin/env node

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const nestedServer = process.env.AGENT_RELAY_NESTED_SERVER;
const fakeCli = process.env.AGENT_RELAY_NESTED_FAKE_CLI;
const project = process.env.AGENT_RELAY_NESTED_PROJECT;
const config = process.env.AGENT_RELAY_NESTED_CONFIG;
const env = {
  HOME: process.env.HOME,
  LOGNAME: process.env.LOGNAME,
  PATH: process.env.PATH,
  PWD: project,
  SHELL: process.env.SHELL,
  SHLVL: "1",
  TMPDIR: process.env.TMPDIR,
  USER: process.env.USER,
  AGENT_RELAY_CONFIG: config,
  CLAUDE_CLI_PATH: fakeCli,
  AGENT_RELAY_FAKE_MODE: "echo",
  AGENT_RELAY_FAKE_AGENT: "claude"
};

const client = new Client({ name: "agent-relay-nested-probe", version: "0.1.0" });
const transport = new StdioClientTransport({ command: process.execPath, args: [nestedServer, "--target", "claude"], env });
await client.connect(transport);
let answer = "nested-allowed";
try {
  const result = await client.callTool({
    name: "delegate_to_claude",
    arguments: { project_id: "project", agent_id: "claude-project", prompt: "must not launch" }
  });
  const text = result.content.find((item) => item.type === "text")?.text ?? "";
  if (result.isError && /routing loops/i.test(text)) answer = "nested-blocked";
} finally {
  await transport.close();
}

process.stdout.write(`${JSON.stringify({ type: "thread.started", thread_id: "nested-probe" })}\n`);
process.stdout.write(`${JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: answer } })}\n`);
