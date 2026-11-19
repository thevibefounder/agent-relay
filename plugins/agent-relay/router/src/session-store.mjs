import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import { chmodSync, linkSync, lstatSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SESSION_ID_PATTERN } from "./config.mjs";

export function assertSessionBinding(directory, sessionId, identity) {
  validateSessionId(sessionId);
  ensureStore(directory);
  const path = sessionPath(directory, sessionId);
  let stored;
  try {
    stored = readBinding(path);
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(`unknown session_id: ${sessionId}`);
    throw error;
  }
  compareBinding(stored, sessionId, identity);
}

export function recordSessionBinding(directory, sessionId, identity) {
  validateSessionId(sessionId);
  ensureStore(directory);
  const path = sessionPath(directory, sessionId);
  const temporary = join(directory, `.binding-${process.pid}-${randomUUID()}.tmp`);
  const binding = {
    version: 1,
    session_id: sessionId,
    project_id: identity.projectId,
    agent_id: identity.agentId,
    target: identity.target,
    root: identity.root
  };
  try {
    writeFileSync(temporary, `${JSON.stringify(binding, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    chmodSync(temporary, 0o600);
    linkSync(temporary, path);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    compareBinding(readBinding(path), sessionId, identity);
  } finally {
    try { unlinkSync(temporary); } catch { /* Best-effort cleanup; the published binding is authoritative. */ }
  }
}

function ensureStore(directory) {
  try {
    validateStore(directory);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    let created = false;
    try {
      mkdirSync(directory, { mode: 0o700 });
      created = true;
    }
    catch (mkdirError) { if (mkdirError?.code !== "EEXIST") throw mkdirError; }
    if (created) chmodSync(directory, 0o700);
    validateStore(directory);
  }
}

function validateStore(directory) {
  const stats = lstatSync(directory);
  if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error("session store must be a real directory");
  if (process.platform !== "win32" && (stats.mode & 0o077) !== 0) {
    throw new Error("session store must not be accessible by group or world");
  }
}

function readBinding(path) {
  const stats = lstatSync(path);
  if (stats.isSymbolicLink() || !stats.isFile()) throw new Error("session binding must be a real file");
  if (process.platform !== "win32" && (stats.mode & 0o077) !== 0) {
    throw new Error("session binding must not be accessible by group or world");
  }
  const binding = JSON.parse(readFileSync(path, "utf8"));
  if (!binding || binding.version !== 1 || typeof binding.session_id !== "string") {
    throw new Error("session binding is invalid");
  }
  return binding;
}

function compareBinding(stored, sessionId, identity) {
  const expected = {
    session_id: sessionId,
    project_id: identity.projectId,
    agent_id: identity.agentId,
    target: identity.target,
    root: identity.root
  };
  for (const [key, value] of Object.entries(expected)) {
    if (stored[key] !== value) throw new Error(`session_id is bound to a different ${key}`);
  }
}

function sessionPath(directory, sessionId) {
  const digest = createHash("sha256").update(sessionId, "utf8").digest("hex");
  return join(directory, `${digest}.json`);
}

function validateSessionId(sessionId) {
  if (typeof sessionId !== "string" || !SESSION_ID_PATTERN.test(sessionId)) {
    throw new Error("provider returned an invalid session_id");
  }
}
