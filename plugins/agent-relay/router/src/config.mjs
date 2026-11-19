import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, parse, relative, resolve } from "node:path";
import { z } from "zod";

export const AGENT_NAMES = ["claude", "codex", "grok", "muse"];
export const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

const agentSchema = z.object({
  id: z.string().regex(ID_PATTERN),
  target: z.enum(AGENT_NAMES),
  role: z.string().trim().min(1).max(100).regex(/^[^\u0000-\u001F\u007F]+$/),
  can_write: z.boolean()
}).strict();

const projectSchema = z.object({
  id: z.string().regex(ID_PATTERN),
  root: z.string().min(1),
  agents: z.array(agentSchema).min(1)
}).strict();

const cliPathsSchema = z.object({
  claude: z.string().optional(),
  codex: z.string().optional(),
  grok: z.string().optional(),
  muse: z.string().optional()
}).strict();

const configSchema = z.object({
  version: z.literal(2),
  cli_paths: cliPathsSchema.default({}),
  projects: z.array(projectSchema).min(1)
}).strict();

export function loadConfig(configPath) {
  rejectLegacyEnvironmentOverrides();
  const stats = lstatSync(configPath);
  if (stats.isSymbolicLink()) throw new Error("configuration file must not be a symbolic link");
  if (process.platform !== "win32" && (stats.mode & 0o022) !== 0) {
    throw new Error("configuration file must not be group- or world-writable");
  }
  const parsed = parseConfig(readFileSync(configPath, "utf8"));
  const configDirectoryPath = dirname(configPath);
  const directoryStats = lstatSync(configDirectoryPath);
  if (directoryStats.isSymbolicLink()) throw new Error("configuration directory must not be a symbolic link");
  if (process.platform !== "win32" && (directoryStats.mode & 0o022) !== 0) {
    throw new Error("configuration directory must not be group- or world-writable");
  }
  const configDirectory = canonicalExistingPath(configDirectoryPath);
  const sessionsDirectory = join(configDirectory, "sessions");
  const projectIds = new Set();
  const roots = [];

  for (const project of parsed.projects) {
    assertUnique(projectIds, project.id, "project id");
    if (!isAbsolute(project.root)) throw new Error(`project ${project.id} root must be absolute`);
    const configuredRoot = resolve(project.root);
    const root = canonicalExistingPath(configuredRoot);
    if (configuredRoot !== root) {
      throw new Error(`project ${project.id} root must be canonical: ${root}`);
    }
    validateAuthorizedRoot(root, configDirectory, sessionsDirectory);
    for (const existing of roots) {
      if (containsPath(existing.root, root) || containsPath(root, existing.root)) {
        throw new Error(`project roots must not overlap: ${existing.id} and ${project.id}`);
      }
    }
    roots.push({ id: project.id, root });

    const agentIds = new Set();
    for (const agent of project.agents) {
      assertUnique(agentIds, agent.id, `agent id in project ${project.id}`);
    }
    project.root = root;
  }

  for (const [agent, path] of Object.entries(parsed.cli_paths)) {
    if (!isAbsolute(path)) throw new Error(`cli_paths.${agent} must be absolute`);
  }

  return { config: parsed, configDirectory, sessionsDirectory };
}

export function resolveDelegation(loaded, target, input) {
  const project = loaded.config.projects.find((entry) => entry.id === input.project_id);
  if (!project) throw new Error(`unknown project_id: ${input.project_id}`);
  const agent = project.agents.find((entry) => entry.id === input.agent_id);
  if (!agent) throw new Error(`unknown agent_id for project ${project.id}: ${input.agent_id}`);
  if (agent.target !== target) {
    throw new Error(`agent ${agent.id} is bound to ${agent.target}, not ${target}`);
  }

  const currentRoot = canonicalExistingPath(project.root);
  if (currentRoot !== project.root) {
    throw new Error(`project root changed since configuration: ${project.root}`);
  }
  let cwd = currentRoot;
  let subdir;
  if (input.subdir !== undefined) {
    subdir = validateSubdir(input.subdir);
    cwd = canonicalExistingPath(resolve(currentRoot, subdir));
    if (!containsPath(currentRoot, cwd)) {
      throw new Error(`subdir escapes project root: ${input.subdir}`);
    }
    if (!statSync(cwd).isDirectory()) throw new Error(`subdir is not a directory: ${input.subdir}`);
  }

  return {
    projectId: project.id,
    agentId: agent.id,
    target: agent.target,
    role: agent.role,
    canWrite: agent.can_write,
    root: currentRoot,
    subdir,
    cwd,
    sessionsDirectory: loaded.sessionsDirectory,
    config: loaded.config
  };
}

export function describeProjects(loaded, selectedTargets) {
  return loaded.config.projects.map((project) => ({
    id: project.id,
    root: project.root,
    agents: project.agents
      .filter((agent) => selectedTargets.includes(agent.target))
      .map((agent) => ({
        id: agent.id,
        target: agent.target,
        role: agent.role,
        can_write: agent.can_write
      }))
  }));
}

export function assertStableWorkingDirectory(identity) {
  const root = canonicalExistingPath(identity.root);
  const cwd = canonicalExistingPath(identity.cwd);
  if (root !== identity.root || cwd !== identity.cwd || !containsPath(root, cwd)) {
    throw new Error("project working directory changed after authorization");
  }
}

export function containsPath(root, candidate) {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function canonicalFuturePath(value) {
  let ancestor = dirname(value);
  const suffix = [basename(value)];
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor);
    if (parent === ancestor) break;
    suffix.unshift(basename(ancestor));
    ancestor = parent;
  }
  const canonicalAncestor = existsSync(ancestor) ? canonicalExistingPath(ancestor) : ancestor;
  return join(canonicalAncestor, ...suffix);
}

function parseConfig(source) {
  let raw;
  try {
    raw = JSON.parse(source);
  } catch (error) {
    throw new Error(`configuration JSON is invalid: ${error.message}`);
  }
  if (raw?.version === 1) {
    throw new Error("configuration version 1 is no longer accepted; run setup with --migrate-v1");
  }
  const result = configSchema.safeParse(raw);
  if (!result.success) throw new Error(`configuration schema is invalid: ${z.prettifyError(result.error)}`);
  return result.data;
}

function rejectLegacyEnvironmentOverrides() {
  for (const name of [
    "AGENT_RELAY_ROOTS",
    "AGENT_ROUTER_ROOTS",
    "AGENT_RELAY_DEFAULT_CWD",
    "AGENT_ROUTER_DEFAULT_CWD"
  ]) {
    if (process.env[name]) throw new Error(`${name} is forbidden with configuration version 2`);
  }
}

function canonicalExistingPath(value) {
  const path = realpathSync.native(value);
  if (!statSync(path).isDirectory()) throw new Error(`path is not a directory: ${value}`);
  return path;
}

function validateAuthorizedRoot(root, configDirectory, sessionsDirectory) {
  const home = canonicalExistingPath(homedir());
  if (root === parse(root).root || containsPath(root, home)) {
    throw new Error(`unsafe project root: ${root}. Filesystem roots, home directories, and ancestors of home are forbidden`);
  }
  if (
    containsPath(root, configDirectory) || containsPath(configDirectory, root) ||
    containsPath(root, sessionsDirectory) || containsPath(sessionsDirectory, root)
  ) {
    throw new Error(`unsafe project root: ${root}. Project roots and Agent Relay policy data cannot overlap`);
  }
}

function validateSubdir(value) {
  if (!value || isAbsolute(value) || value.startsWith("~")) {
    throw new Error("subdir must be a non-empty relative path");
  }
  if (value.split(/[\\/]+/).includes("..")) throw new Error("subdir must not contain .. segments");
  return value;
}

function assertUnique(values, value, label) {
  if (values.has(value)) throw new Error(`duplicate ${label}: ${value}`);
  values.add(value);
}
