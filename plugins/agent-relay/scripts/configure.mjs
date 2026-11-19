#!/usr/bin/env node

import {
  accessSync, chmodSync, constants, existsSync, lstatSync, mkdirSync,
  readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, parse as parsePath, relative, resolve } from "node:path";

const TARGETS = new Set(["claude", "codex", "grok", "muse"]);
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const options = parseArgs(process.argv.slice(2));
const configPath = canonicalFuturePath(resolve(options.config ?? process.env.AGENT_RELAY_CONFIG ?? `${homedir()}/.agent-relay/config.json`));
const defaultConfigDirectory = resolve(homedir(), ".agent-relay");

if (options.show) {
  process.stdout.write(`${configPath}\n`);
  process.exit(0);
}

if (options.workspace) {
  if (options.migrateV1 || options.projects.length || options.agents.length) {
    fail("--workspace cannot be combined with --project, --agent, or --migrate-v1");
  }
  options.projects.push(`workspace=${options.workspace}`);
  const providers = options.withGrok ? ["claude", "codex", "grok"] : ["claude", "codex"];
  for (const provider of providers) {
    options.agents.push(`workspace:${provider}:${provider}:collaborator:${options.allowEdits ? "write" : "read"}`);
  }
} else if (options.allowEdits || options.withGrok) {
  fail("--allow-edits and --with-grok require --workspace");
}

let cliPaths = validateCliPaths(options.cliPaths);
let projects;
let backupPath;
let backupTemporary;
if (options.migrateV1) {
  if (options.projects.length || options.agents.length) fail("--migrate-v1 cannot be combined with --project or --agent");
  const migrated = migrateV1(configPath);
  projects = migrated.projects;
  backupPath = migrated.backupPath;
  backupTemporary = migrated.backupTemporary;
  cliPaths = { ...migrated.cliPaths, ...cliPaths };
} else {
  if (options.projects.length === 0) fail("Provide at least one --project id=/absolute/project/path");
  if (existsSync(configPath) && !options.force) fail(`Configuration already exists: ${configPath}. Pass --force to replace it`);
  projects = buildProjects(options.projects, options.agents, configPath);
}

const config = { version: 2, cli_paths: cliPaths, projects };
try {
  writeConfig(configPath, config);
  if (backupTemporary) renameSync(backupTemporary, backupPath);
} catch (error) {
  if (backupTemporary) {
    try { unlinkSync(backupTemporary); } catch (cleanupError) { if (cleanupError?.code !== "ENOENT") throw cleanupError; }
  }
  fail(`Could not write Agent Relay configuration: ${error.message}`);
}
process.stdout.write([
  `Agent Relay configured at ${configPath}`,
  `Projects: ${projects.length}`,
  `Agent identities: ${projects.reduce((count, project) => count + project.agents.length, 0)}`,
  backupPath ? `Version 1 backup: ${backupPath}` : undefined
].filter(Boolean).join("\n") + "\n");

function parseArgs(args) {
  const result = { projects: [], agents: [], cliPaths: {}, show: false, migrateV1: false, force: false };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--show") { result.show = true; continue; }
    if (flag === "--migrate-v1") { result.migrateV1 = true; continue; }
    if (flag === "--force") { result.force = true; continue; }
    if (flag === "--allow-edits") { result.allowEdits = true; continue; }
    if (flag === "--with-grok") { result.withGrok = true; continue; }
    const value = args[index + 1];
    if (!value) fail(`Missing value for ${flag}`);
    index += 1;
    if (flag === "--project") result.projects.push(value);
    else if (flag === "--agent") result.agents.push(value);
    else if (flag === "--config") result.config = value;
    else if (flag === "--workspace") result.workspace = value;
    else if (["--claude", "--codex", "--grok", "--muse"].includes(flag)) result.cliPaths[flag.slice(2)] = value;
    else fail(`Unknown option: ${flag}`);
  }
  return result;
}

function buildProjects(projectValues, agentValues, targetConfigPath) {
  const projectMap = new Map();
  for (const value of projectValues) {
    const [id, rootValue] = splitOnce(value, "=", "--project must use id=/absolute/path");
    validateId(id, "project id");
    if (projectMap.has(id)) fail(`Duplicate project id: ${id}`);
    const root = authorizedDirectory(rootValue, targetConfigPath);
    for (const project of projectMap.values()) {
      if (inside(project.root, root) || inside(root, project.root)) fail(`Project roots must not overlap: ${project.id} and ${id}`);
    }
    projectMap.set(id, { id, root, agents: [] });
  }

  for (const value of agentValues) {
    const fields = value.split(":");
    if (fields.length !== 5) fail("--agent must use project:agent:target:role:read|write");
    const [projectId, id, target, role, access] = fields;
    const project = projectMap.get(projectId);
    if (!project) fail(`Unknown project in --agent: ${projectId}`);
    validateId(id, "agent id");
    if (!TARGETS.has(target)) fail(`Unknown agent target: ${target}`);
    if (!role || role.length > 100 || /[\u0000-\u001F\u007F]/.test(role)) {
      fail("Agent role must contain 1-100 characters without control characters");
    }
    if (!["read", "write"].includes(access)) fail("Agent access must be read or write");
    if (project.agents.some((agent) => agent.id === id)) fail(`Duplicate agent id in project ${projectId}: ${id}`);
    project.agents.push({ id, target, role, can_write: access === "write" });
  }
  for (const project of projectMap.values()) {
    if (project.agents.length === 0) fail(`Project ${project.id} needs at least one --agent`);
  }
  return [...projectMap.values()];
}

function migrateV1(targetConfigPath) {
  if (!existsSync(targetConfigPath)) fail(`No configuration to migrate: ${targetConfigPath}`);
  const stats = lstatSync(targetConfigPath);
  if (stats.isSymbolicLink()) fail("Configuration file must not be a symbolic link");
  if (process.platform !== "win32" && (stats.mode & 0o022) !== 0) {
    fail("Configuration file must not be group- or world-writable");
  }
  const directoryStats = lstatSync(dirname(targetConfigPath));
  if (directoryStats.isSymbolicLink()) fail("Configuration directory must not be a symbolic link");
  if (process.platform !== "win32" && (directoryStats.mode & 0o022) !== 0) {
    fail("Configuration directory must not be group- or world-writable");
  }
  const sourceText = readFileSync(targetConfigPath, "utf8");
  let source;
  try { source = JSON.parse(sourceText); }
  catch (error) { fail(`Version 1 configuration JSON is invalid: ${error.message}`); }
  if (source?.version !== 1 || !Array.isArray(source.allowed_roots) || source.allowed_roots.length === 0) {
    fail("--migrate-v1 requires a version 1 configuration with allowed_roots");
  }
  const used = new Set();
  const projects = source.allowed_roots.map((value, index) => {
    const root = authorizedDirectory(value, targetConfigPath);
    const base = slug(basename(root)) || `project-${index + 1}`;
    let id = base;
    for (let suffix = 2; used.has(id); suffix += 1) id = `${base}-${suffix}`;
    used.add(id);
    return {
      id,
      root,
      agents: [...TARGETS].map((target) => ({
        id: `${target}-${id}`.slice(0, 64),
        target,
        role: target === "claude" ? "reviewer" : "collaborator",
        can_write: false
      }))
    };
  });
  for (let left = 0; left < projects.length; left += 1) {
    for (let right = left + 1; right < projects.length; right += 1) {
      if (inside(projects[left].root, projects[right].root) || inside(projects[right].root, projects[left].root)) {
        fail(`Project roots must not overlap: ${projects[left].id} and ${projects[right].id}`);
      }
    }
  }
  const cliPaths = validateCliPaths(source.cli_paths ?? {});
  const backupPath = `${targetConfigPath}.v1.backup`;
  if (existsSync(backupPath)) fail(`Migration backup already exists: ${backupPath}`);
  const backupTemporary = `${backupPath}.tmp-${process.pid}`;
  try {
    writeFileSync(backupTemporary, sourceText, { mode: 0o600, flag: "wx" });
    chmodSync(backupTemporary, 0o600);
  } catch (error) {
    fail(`Could not stage migration backup: ${error.message}`);
  }
  return { projects, backupPath, backupTemporary, cliPaths };
}

function validateCliPaths(values) {
  const result = {};
  for (const [agent, value] of Object.entries(values)) {
    if (!isAbsolute(value)) fail(`--${agent} must be an absolute executable path`);
    let executable;
    try { executable = realpathSync.native(value); }
    catch { fail(`--${agent} executable does not exist: ${value}`); }
    if (!statSync(executable).isFile()) fail(`--${agent} is not a file: ${value}`);
    try { accessSync(executable, constants.X_OK); }
    catch { fail(`--${agent} is not executable: ${value}`); }
    result[agent] = executable;
  }
  return result;
}

function writeConfig(targetConfigPath, config) {
  const configDirectory = dirname(targetConfigPath);
  const configDirectoryExisted = existsSync(configDirectory);
  mkdirSync(configDirectory, { recursive: true, mode: 0o700 });
  if (!configDirectoryExisted || configDirectory === defaultConfigDirectory) chmodSync(configDirectory, 0o700);
  else if (process.platform !== "win32" && (statSync(configDirectory).mode & 0o022) !== 0) {
    fail(`Configuration directory must not be group- or world-writable: ${configDirectory}`);
  }
  const temporary = `${targetConfigPath}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  chmodSync(temporary, 0o600);
  renameSync(temporary, targetConfigPath);
}

function authorizedDirectory(value, targetConfigPath) {
  if (!isAbsolute(value)) fail(`Project paths must be absolute: ${value}`);
  if (!existsSync(value)) fail(`Directory does not exist: ${value}`);
  const root = realpathSync.native(value);
  if (!statSync(root).isDirectory()) fail(`Not a directory: ${value}`);
  if (resolve(value) !== root) fail(`Project path must be canonical: ${root}`);
  const home = realpathSync.native(homedir());
  if (root === parsePath(root).root || inside(root, home)) {
    fail(`Unsafe project root: ${root}. Filesystem roots, home directories, and ancestors of home are forbidden`);
  }
  const policyDirectory = dirname(targetConfigPath);
  if (inside(root, policyDirectory) || inside(policyDirectory, root)) {
    fail(`Unsafe project root: ${root}. Project roots and Agent Relay policy data cannot overlap`);
  }
  return root;
}

function splitOnce(value, delimiter, message) {
  const index = value.indexOf(delimiter);
  if (index <= 0 || index === value.length - 1) fail(message);
  return [value.slice(0, index), value.slice(index + delimiter.length)];
}

function validateId(value, label) {
  if (!ID_PATTERN.test(value)) fail(`${label} must match ${ID_PATTERN}`);
}

function inside(root, candidate) {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function canonicalFuturePath(value) {
  let ancestor = dirname(value);
  const suffix = [basename(value)];
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor);
    if (parent === ancestor) break;
    suffix.unshift(basename(ancestor));
    ancestor = parent;
  }
  const canonicalAncestor = existsSync(ancestor) ? realpathSync.native(ancestor) : ancestor;
  return join(canonicalAncestor, ...suffix);
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[^a-z0-9]+/, "").slice(0, 48);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}
