#!/usr/bin/env bash
set -euo pipefail

if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'AgentRelay needs Node.js. Install the LTS version from https://nodejs.org/en/download, reopen Terminal, and run this command again.' >&2
  exit 1
fi

node --input-type=module - "$@" <<'NODE'
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { accessSync, constants, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline';

const version = '0.3.0';
const url = `https://github.com/thevibefounder/agent-relay/releases/download/v${version}/agent-relay-v${version}.zip`;
const archiveHash = '087494858f1649ac8017f63149afd9f724db074cb63815fa78fb07f11a4bb3a1';
const options = { name: 'agent-relay-workshop', edits: false };
let scratch;
const fail = message => { throw new Error(message); };
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 60000 });
  if (result.error) fail(`${command}: ${result.error.message}`);
  if (result.status !== 0) fail((result.stderr || result.stdout || `${command} failed`).trim());
  return result.stdout;
}
function executable(value) {
  const candidates = value.includes('/') ? [resolve(value)] : (process.env.PATH || '').split(delimiter).filter(Boolean).map(p => join(p, value));
  for (const p of candidates) {
    try { accessSync(p, constants.X_OK); if (statSync(p).isFile()) return realpathSync(p); } catch {}
  }
  return undefined;
}
function inside(root, path) {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}
function inspectRegistration(command, args, cwd) {
  const r = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 60000 });
  if (r.error) fail(r.error.message);
  if (r.status === 0) return r.stdout;
  if (/no (?:MCP )?server.*(?:found|named)|(?:MCP )?server.*(?:not found|does not exist)/i.test(r.stderr + r.stdout)) return null;
  fail((r.stderr || r.stdout || 'Cannot inspect existing MCP registration').trim());
}
function verifyFiles(source, destination) {
  if (lstatSync(destination).isSymbolicLink()) fail(`Install location is a symbolic link: ${destination}`);
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const a = join(source, entry.name), b = join(destination, entry.name);
    if (!existsSync(b) || lstatSync(b).isSymbolicLink()) fail(`Existing installation differs: ${b}. Choose a fresh install location or restore it before retrying.`);
    if (entry.isDirectory()) verifyFiles(a, b);
    else if (!statSync(b).isFile() || !readFileSync(a).equals(readFileSync(b))) fail(`Existing installation differs: ${b}. No files were overwritten.`);
  }
}
async function discover(server, policy, host) {
  const child = spawn(process.execPath, [server, '--host', host, '--project', 'workspace'], { env: { ...process.env, AGENT_RELAY_CONFIG: policy }, stdio: ['pipe', 'pipe', 'pipe'] });
  let id = 0, stderr = '';
  const pending = new Map();
  child.stderr.on('data', chunk => { stderr += chunk; });
  function rejectAll(error) { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error); } pending.clear(); }
  child.on('error', rejectAll);
  child.on('exit', code => rejectAll(new Error(`Router exited ${code}: ${stderr}`)));
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    let message; try { message = JSON.parse(line); } catch { return; }
    const p = pending.get(message.id);
    if (!p) return;
    pending.delete(message.id); clearTimeout(p.timer);
    message.error ? p.reject(new Error(JSON.stringify(message.error))) : p.resolve(message.result);
  });
  function request(method, params) {
    const requestId = ++id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('Router discovery timed out')); }, 15000);
      pending.set(requestId, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }) + '\n');
    });
  }
  try {
    const init = await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'agent-relay-installer', version } });
    assert.equal(init.serverInfo.version, version);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const result = await request('tools/call', { name: 'list_available_agents', arguments: {} });
    if (result.isError) fail(JSON.stringify(result));
    const info = result.structuredContent;
    assert.equal(info.configuration.config_path, policy);
    assert.equal(info.projects[0]?.id, 'workspace');
    assert.ok(info.agents.every(agent => agent.available), 'A configured CLI is unavailable');
  } finally {
    child.stdin.end();
    const timer = setTimeout(() => child.kill('SIGTERM'), 1000); timer.unref();
  }
}
try {
  for (let i = 2; i < process.argv.length; i++) {
    const flag = process.argv[i];
    if (flag === '--allow-edits') { options.edits = true; continue; }
    if (!['--project', '--name', '--claude', '--codex'].includes(flag) || !process.argv[i + 1]) fail(`Unknown or incomplete option: ${flag}`);
    options[flag.slice(2)] = process.argv[++i];
  }
  if (Number(process.versions.node.split('.')[0]) < 20) fail('Install a current Node.js LTS (20 or later): https://nodejs.org/en/download');
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(options.name)) fail('Invalid MCP connection name');
  const claude = executable(options.claude || 'claude');
  const codex = executable(options.codex || 'codex');
  if (!claude || !codex) fail([
    !claude && 'Install Claude Code: https://code.claude.com/docs/en/setup',
    !codex && 'Install Codex CLI: https://developers.openai.com/codex/cli/',
    'Open a new Terminal after installation, sign in to each CLI, then run this command again.'
  ].filter(Boolean).join('\n'));
  const unzip = executable('unzip');
  if (!unzip) fail('Install unzip with your system package manager, then retry.');
  run(claude, ['--version']); run(codex, ['--version']);
  const home = realpathSync(homedir());
  const requestedProject = options.project ? resolve(options.project) : join(home, 'AgentRelay-Workshop');
  if (options.project && !existsSync(requestedProject)) fail(`Project folder does not exist: ${requestedProject}`);
  const newProject = !existsSync(requestedProject);
  if (newProject) mkdirSync(requestedProject, { mode: 0o700 });
  const project = realpathSync(requestedProject);
  if (!statSync(project).isDirectory() || inside(project, home)) fail('Choose a project folder inside your home, not your home folder or a filesystem root.');
  const state = join(home, '.agent-relay');
  if (inside(project, state) || inside(state, project)) fail('The project must be separate from AgentRelay policy data.');
  const key = createHash('sha256').update(project).digest('hex').slice(0, 12);
  const policyDirectory = join(state, 'workshop-policies');
  const policy = join(policyDirectory, `${key}-${options.edits ? 'edit' : 'review'}.json`);
  const installBase = join(home, '.local', 'share', 'agent-relay');
  const install = join(installBase, `v${version}`);
  const server = join(install, 'plugins', 'agent-relay', 'router', 'dist', 'server.mjs');
  const existingCodex = inspectRegistration(codex, ['mcp', 'get', options.name, '--json'], project);
  const existingClaude = inspectRegistration(claude, ['mcp', 'get', options.name], project);
  if (existingCodex) {
    const c = JSON.parse(existingCodex);
    if (c.transport?.env?.AGENT_RELAY_CONFIG !== policy || c.transport.command !== process.execPath || JSON.stringify(c.transport.args) !== JSON.stringify([server, '--host', 'codex', '--project', 'workspace'])) fail(`Codex already has a different ${options.name} connection. It was preserved. Retry with --name another-name.`);
  }
  if (existingClaude && (!existingClaude.includes(policy) || !existingClaude.includes(server) || !existingClaude.includes('--host claude --project workspace'))) fail(`Claude already has a different ${options.name} connection. It was preserved. Retry with --name another-name.`);
  console.log(`Downloading AgentRelay ${version} and checking its checksum...`);
  mkdirSync(installBase, { recursive: true, mode: 0o700 });
  scratch = mkdtempSync(join(installBase, '.download-'));
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) fail(`Download failed: HTTP ${response.status}`);
  const archive = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(archive).digest('hex') !== archiveHash) fail('Release checksum mismatch. Nothing was registered.');
  const zip = join(scratch, 'release.zip'); writeFileSync(zip, archive);
  run(unzip, ['-q', zip, '-d', scratch]);
  const extracted = join(scratch, `agent-relay-v${version}`);
  if (existsSync(install)) verifyFiles(extracted, install);
  else renameSync(extracted, install);
  const configure = join(install, 'plugins', 'agent-relay', 'scripts', 'configure.mjs');
  const expected = { version: 2, cli_paths: { claude, codex }, projects: [{ id: 'workspace', root: project, agents: ['claude', 'codex'].map(target => ({ id: target, target, role: 'collaborator', can_write: options.edits })) }] };
  if (existsSync(policy)) {
    if (lstatSync(policy).isSymbolicLink()) fail('Existing policy is a symbolic link; it was preserved.');
    assert.deepEqual(JSON.parse(readFileSync(policy)), expected, 'Existing project policy differs; it was preserved.');
  } else {
    run(process.execPath, [configure, '--config', policy, '--workspace', project, '--claude', claude, '--codex', codex, ...(options.edits ? ['--allow-edits'] : [])]);
  }
  await discover(server, policy, 'codex');
  await discover(server, policy, 'claude');
  let addedCodex = false;
  try {
    if (!existingCodex) { run(codex, ['mcp', 'add', options.name, '--env', `AGENT_RELAY_CONFIG=${policy}`, '--', process.execPath, server, '--host', 'codex', '--project', 'workspace'], project); addedCodex = true; }
    if (!existingClaude) run(claude, ['mcp', 'add', '--scope', 'local', options.name, '-e', `AGENT_RELAY_CONFIG=${policy}`, '--', process.execPath, server, '--host', 'claude', '--project', 'workspace'], project);
  } catch (error) {
    if (addedCodex) { try { run(codex, ['mcp', 'remove', options.name], project); } catch { console.error(`Could not roll back the new Codex connection; inspect it with: codex mcp get ${options.name}`); } }
    throw error;
  }
  if (!options.project && !existsSync(join(project, 'README.md'))) writeFileSync(join(project, 'README.md'), '# AgentRelay workshop\n\nThis practice project connects Claude Code and Codex for agent reviews.\n', { flag: 'wx' });
  const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
  console.log(`\nConnected Claude and Codex (${options.edits ? 'edits allowed when explicitly requested' : 'read-only'}).`);
  console.log(`Project: ${project}\nConnection: ${options.name}\nPolicy: ${policy}`);
  console.log(`\nRestart any open Claude/Codex sessions. Then run:\n  cd ${quote(project)}\n  codex`);
  console.log(`\nPaste this prompt:\nUse ${options.name} to ask Claude to review README.md without editing. Poll get_result until it finishes and show me Claude's answer.`);
  console.log('\nFor the reverse direction, start claude in that same folder and ask it to use this connection to ask Codex for a review.');
  console.log('Relay uses your existing CLI login, model and provider settings. Sign in to each CLI if needed. No model calls were made during installation.');
} catch (error) {
  console.error(`\nAgentRelay setup stopped: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
}
NODE
