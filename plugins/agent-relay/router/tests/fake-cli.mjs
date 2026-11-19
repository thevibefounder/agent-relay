#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const mode = process.env.AGENT_RELAY_FAKE_MODE ?? "echo";
const agent = process.env.AGENT_RELAY_FAKE_AGENT ?? "codex";

if (mode === "hang" || mode === "exit-on-term") {
  if (mode === "hang") process.on("SIGTERM", () => {});
  const descendant = spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], {
    stdio: ["ignore", "inherit", "inherit"]
  });
  if (process.env.AGENT_RELAY_FAKE_PID_FILE) {
    writeFileSync(process.env.AGENT_RELAY_FAKE_PID_FILE, JSON.stringify({ parent: process.pid, descendant: descendant.pid }));
  }
  setInterval(() => {}, 1_000);
} else if (mode === "raw-utf8") {
  const value = "🙂漢字".repeat(20_000);
  const bytes = Buffer.from(value);
  for (let index = 0; index < bytes.length; index += 7) {
    process.stdout.write(bytes.subarray(index, index + 7));
  }
} else if (mode === "overflow") {
  process.on("SIGTERM", () => {});
  process.stdout.write("x".repeat(256 * 1024));
  setInterval(() => {}, 1_000);
} else {
  const stdin = await readStdin();
  const promptFile = optionValue("--prompt-file");
  const prompt = promptFile ? readFileSync(promptFile, "utf8") : stdin;
  if (process.env.AGENT_RELAY_FAKE_CAPTURE) {
    writeFileSync(process.env.AGENT_RELAY_FAKE_CAPTURE, JSON.stringify({ args: process.argv.slice(2), stdin, prompt }));
  }
  if (process.env.AGENT_RELAY_FAKE_DELAY) {
    await new Promise((resolve) => setTimeout(resolve, Number(process.env.AGENT_RELAY_FAKE_DELAY)));
  }
  emitResult(agent, process.env.AGENT_RELAY_FAKE_ANSWER ?? "ok");
}

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function emitResult(name, answer) {
  const sessionId = process.env.AGENT_RELAY_FAKE_SESSION_ID ?? "fake-session";
  if (name === "claude") {
    process.stdout.write(`${JSON.stringify({ session_id: sessionId, result: answer, is_error: false })}\n`);
  } else if (name === "codex") {
    process.stdout.write(`${JSON.stringify({ type: "thread.started", thread_id: sessionId })}\n`);
    process.stdout.write(`${JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: answer } })}\n`);
  } else if (name === "grok") {
    process.stdout.write(`${JSON.stringify({ session_id: sessionId, result: answer })}\n`);
  } else {
    process.stdout.write(`${JSON.stringify({ stream: { kind: "session", id: sessionId } })}\n`);
    process.stdout.write(`${JSON.stringify({ payload_type: "run.terminal.completed", payload: { text: answer } })}\n`);
  }
}
