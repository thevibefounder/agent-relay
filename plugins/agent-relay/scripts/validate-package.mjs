#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(pluginRoot, "../..");
const required = ["plugin.json", "mcp.json", "router/dist/server.mjs", "skills/setup/SKILL.md", "skills/agent-relay-orchestrator/SKILL.md"];
const failures = [];

for (const path of required) {
  if (!existsSync(join(pluginRoot, path))) failures.push(`Missing ${path}`);
}

const plugin = parseJson(join(pluginRoot, "plugin.json"));
const mcp = parseJson(join(pluginRoot, "mcp.json"));
const marketplace = parseJson(join(repositoryRoot, ".agents/plugins/marketplace.json"));
if (plugin?.name !== "agent-relay") failures.push("plugin.json name must be agent-relay");
if (plugin?.extensions?.["com.openai"]?.requires_local_executor !== true) failures.push("plugin must require local executor");
if (mcp?.mcpServers?.["agent-relay"]?.type !== "stdio") failures.push("MCP transport must be stdio");
if (marketplace?.plugins?.[0]?.source?.path !== "./plugins/agent-relay") failures.push("marketplace source path is inconsistent");
verifyBundle();

for (const path of walk(pluginRoot)) {
  const text = readFileSync(path, "utf8");
  for (const [label, pattern] of [
    ["personal home path", /\/Users\/[A-Za-z0-9._-]+\//],
    ["embedded secret assignment", /(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|PASSWORD)\s*=\s*["'][^"']+/i],
    ["public listener", /0\.0\.0\.0/]
  ]) {
    if (pattern.test(text)) failures.push(`${label} found in ${path.slice(pluginRoot.length + 1)}`);
  }
}

if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write("Agent Relay package validation passed.\n");

function parseJson(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (error) { failures.push(`Invalid JSON ${path}: ${error.message}`); return undefined; }
}

function walk(root) {
  const files = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory() && entry === "node_modules") continue;
    if (statSync(path).isDirectory()) files.push(...walk(path));
    else files.push(path);
  }
  return files;
}

function verifyBundle() {
  const routerRoot = join(pluginRoot, "router");
  const executable = join(routerRoot, "node_modules", ".bin", process.platform === "win32" ? "esbuild.cmd" : "esbuild");
  if (!existsSync(executable)) {
    failures.push("Cannot verify router bundle: run npm ci in router first");
    return;
  }
  const temporary = mkdtempSync(join(tmpdir(), "agent-relay-bundle-"));
  const rebuilt = join(temporary, "server.mjs");
  try {
    const result = spawnSync(executable, [
      "src/server.mjs",
      "--bundle",
      "--platform=node",
      "--format=esm",
      "--target=node20",
      `--outfile=${rebuilt}`
    ], { cwd: routerRoot, encoding: "utf8" });
    if (result.status !== 0) {
      failures.push(`Router bundle rebuild failed: ${(result.stderr || result.stdout).trim()}`);
      return;
    }
    if (!readFileSync(rebuilt).equals(readFileSync(join(routerRoot, "dist/server.mjs")))) {
      failures.push("router/dist/server.mjs does not match a clean rebuild from source");
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
