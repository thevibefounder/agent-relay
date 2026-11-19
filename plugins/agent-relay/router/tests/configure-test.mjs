#!/usr/bin/env node

import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, parse as parsePath } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const temporary = mkdtempSync(join(tmpdir(), "agent-relay-config-"));
const fakeHome = join(temporary, "home");
const projectPath = join(temporary, "project");
const config = join(temporary, "settings", "config.json");
mkdirSync(fakeHome, { mode: 0o700 });
mkdirSync(projectPath);
const project = realpathSync.native(projectPath);

const script = fileURLToPath(new URL("../../scripts/configure.mjs", import.meta.url));
const result = run([
  "--project", `worktrace=${project}`,
  "--agent", "worktrace:codex-worktrace:codex:implementer:write",
  "--agent", "worktrace:claude-worktrace:claude:reviewer:read",
  "--config", config
]);
assert.equal(result.status, 0, result.stderr);
const parsed = JSON.parse(readFileSync(config, "utf8"));
assert.equal(parsed.version, 2);
assert.deepEqual(parsed.projects, [{
  id: "worktrace",
  root: realpathSync.native(project),
  agents: [
    { id: "codex-worktrace", target: "codex", role: "implementer", can_write: true },
    { id: "claude-worktrace", target: "claude", role: "reviewer", can_write: false }
  ]
}]);
if (process.platform !== "win32") assert.equal(statSync(config).mode & 0o777, 0o600);

const overwrite = run([
  "--project", `worktrace=${project}`,
  "--agent", "worktrace:codex-worktrace:codex:implementer:read",
  "--config", config
]);
assert.notEqual(overwrite.status, 0);
assert.match(overwrite.stderr, /already exists/i);
const forced = run([
  "--force",
  "--project", `worktrace=${project}`,
  "--agent", "worktrace:codex-worktrace:codex:implementer:write",
  "--agent", "worktrace:claude-worktrace:claude:reviewer:read",
  "--config", config
]);
assert.equal(forced.status, 0, forced.stderr);

const badPolicyDirectory = join(temporary, "bad-policy");
mkdirSync(badPolicyDirectory, { mode: 0o700 });
const workspaceConfig = join(badPolicyDirectory, "config.json");
const workspace = run(["--workspace", project, "--allow-edits", "--config", workspaceConfig]);
assert.equal(workspace.status, 0, workspace.stderr);
assert.deepEqual(JSON.parse(readFileSync(workspaceConfig, "utf8")).projects[0].agents.map(
  ({ target, can_write }) => [target, can_write]
), [["claude", true], ["codex", true]]);

for (const unsafeRoot of [parsePath(realpathSync(fakeHome)).root, realpathSync(fakeHome)]) {
  const unsafe = run([
    "--project", `unsafe=${unsafeRoot}`,
    "--agent", "unsafe:codex-unsafe:codex:implementer:read",
    "--config", join(temporary, `unsafe-${Buffer.from(unsafeRoot).toString("hex")}.json`)
  ]);
  assert.notEqual(unsafe.status, 0);
  assert.match(unsafe.stderr, /unsafe project root/i);
}

const selfPolicy = run([
  "--project", `project=${project}`,
  "--agent", "project:codex-project:codex:implementer:read",
  "--config", join(project, "config.json")
]);
assert.notEqual(selfPolicy.status, 0);
assert.match(selfPolicy.stderr, /policy data/i);

const customDirectory = join(temporary, "custom-config");
mkdirSync(customDirectory, { mode: 0o755 });
chmodSync(customDirectory, 0o755);
const custom = run([
  "--project", `project=${project}`,
  "--agent", "project:codex-project:codex:implementer:read",
  "--config", join(customDirectory, "config.json")
]);
assert.equal(custom.status, 0, custom.stderr);
if (process.platform !== "win32") assert.equal(statSync(customDirectory).mode & 0o777, 0o755);

const migrationDirectory = join(temporary, "migration");
mkdirSync(migrationDirectory, { mode: 0o700 });
const migrationConfig = join(migrationDirectory, "config.json");
writeFileSync(migrationConfig, `${JSON.stringify({
  version: 1,
  allowed_roots: [project],
  default_cwd: project,
  editable_agents: ["codex"],
  cli_paths: { codex: process.execPath }
})}\n`, { mode: 0o600 });
const migration = run(["--migrate-v1", "--config", migrationConfig]);
assert.equal(migration.status, 0, migration.stderr);
const migrated = JSON.parse(readFileSync(migrationConfig, "utf8"));
assert.equal(migrated.version, 2);
assert.ok(migrated.projects[0].agents.every((agent) => agent.can_write === false));
assert.equal(migrated.cli_paths.codex, realpathSync.native(process.execPath));
assert.equal(JSON.parse(readFileSync(`${migrationConfig}.v1.backup`, "utf8")).version, 1);

if (process.platform !== "win32") {
  const insecureMigrationDirectory = join(temporary, "insecure-migration");
  mkdirSync(insecureMigrationDirectory, { mode: 0o700 });
  const insecureMigrationConfig = join(insecureMigrationDirectory, "config.json");
  writeFileSync(insecureMigrationConfig, `${JSON.stringify({ version: 1, allowed_roots: [project] })}\n`, { mode: 0o666 });
  chmodSync(insecureMigrationConfig, 0o666);
  const insecureMigration = run(["--migrate-v1", "--config", insecureMigrationConfig]);
  assert.notEqual(insecureMigration.status, 0);
  assert.match(insecureMigration.stderr, /group- or world-writable/i);
}

const brokenCliDirectory = join(temporary, "broken-cli-migration");
mkdirSync(brokenCliDirectory, { mode: 0o700 });
const brokenCliConfig = join(brokenCliDirectory, "config.json");
writeFileSync(brokenCliConfig, `${JSON.stringify({
  version: 1,
  allowed_roots: [project],
  cli_paths: { codex: join(temporary, "missing-codex") }
})}\n`, { mode: 0o600 });
const brokenCliMigration = run(["--migrate-v1", "--config", brokenCliConfig]);
assert.notEqual(brokenCliMigration.status, 0);
assert.match(brokenCliMigration.stderr, /does not exist/i);
assert.equal(existsSync(`${brokenCliConfig}.v1.backup`), false);

process.stdout.write("Agent Relay version 2 configuration and migration tests passed.\n");

function run(args) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, HOME: fakeHome }
  });
}
