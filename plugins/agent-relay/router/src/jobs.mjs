import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MAX_JOBS = 64;

export function createJobs(run) {
  const jobs = new Map();

  function get(id) {
    const job = jobs.get(id);
    if (!job) throw new Error("Unknown job ID in this Relay connection.");
    return job;
  }

  function start({ identity, mode, task, previousId }) {
    let session;
    let previous;
    if (previousId) {
      previous = get(previousId);
      const result = previous.receipt;
      if (result.status !== "completed" || !result.session_bound || !result.session_id) {
        throw new Error("Only a completed job with a bound session can be continued.");
      }
      if (previous.identity.root !== identity.root || previous.identity.agentId !== identity.agentId ||
          previous.identity.target !== identity.target || result.mode !== mode) {
        throw new Error("Continue with the same project, agent and mode.");
      }
      session = result.session_id;
      if ([...jobs.values()].some((job) => !job.finished && job.session === session &&
          job.identity.target === identity.target)) {
        throw new Error("This agent session already has a follow-up in progress.");
      }
    }
    for (const [id, job] of jobs) {
      if (jobs.size < MAX_JOBS) break;
      if (job.finished && !job.continuing && job !== previous) jobs.delete(id);
    }
    if (jobs.size >= MAX_JOBS) throw new Error("Too many active jobs in this Relay connection.");

    const id = randomUUID();
    const release = mode === "edit" ? lockCheckout(identity.root, id) : undefined;
    const controller = new AbortController();
    const before = release ? gitSnapshot(identity.root) : undefined;
    const job = {
      identity,
      controller,
      session,
      finished: false,
      receipt: { job_id: id, status: "running", agent: identity.target, mode, project_root: identity.root }
    };
    const initialReceipt = job.receipt;
    jobs.set(id, job);
    if (previous) previous.continuing = true;
    job.done = (async () => {
      try {
        const result = await run(identity, mode, task, session, controller.signal);
        job.receipt = {
          ...job.receipt,
          status: result.ok ? "completed" : result.permission_denials?.length ? "blocked" : "failed",
          answer: result.answer,
          exit_code: result.exit_code,
          stderr: result.stderr,
          model: result.model,
          session_id: result.session_id,
          session_bound: result.session_bound,
          session_binding_error: result.session_binding_error,
          permission_denials: result.permission_denials
        };
      } catch (error) {
        job.receipt = {
          ...job.receipt,
          status: controller.signal.aborted ? "cancelled" : "failed",
          error: error.message
        };
      } finally {
        if (release) {
          job.receipt.git_before = before;
          job.receipt.git_after = gitSnapshot(identity.root);
          job.receipt.inspect_worktree = job.receipt.status !== "completed";
          try { release(); }
          catch (error) { job.receipt.lock_error = error.message; }
        }
        if (previous) previous.continuing = false;
        job.finished = true;
      }
      return job.receipt;
    })();
    return initialReceipt;
  }

  async function result(id, waitSeconds, signal) {
    const job = get(id);
    if (job.finished || !waitSeconds || signal?.aborted) return job.receipt;
    return new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", finish);
        resolve(job.receipt);
      };
      const timer = setTimeout(finish, waitSeconds * 1000);
      signal?.addEventListener("abort", finish, { once: true });
      job.done.then(finish);
    });
  }

  function cancel(id) {
    const job = get(id);
    if (!job.finished) {
      job.receipt = { ...job.receipt, status: "cancelling" };
      job.controller.abort();
    }
    return job.receipt;
  }

  return { start, result, cancel };
}

export function lockCheckout(root, jobId) {
  const temporary = process.platform === "win32" ? tmpdir() : "/tmp";
  const directory = join(realpathSync.native(temporary), `agent-relay-writers-${process.getuid?.() ?? "local"}`);
  try { mkdirSync(directory, { mode: 0o700 }); }
  catch (error) { if (error.code !== "EEXIST") throw error; }
  const stats = lstatSync(directory);
  if (!stats.isDirectory() || (process.platform !== "win32" &&
      ((stats.mode & 0o077) !== 0 || stats.uid !== process.getuid()))) {
    throw new Error("Agent Relay writer lock directory must be private.");
  }
  const path = join(directory, createHash("sha256").update(root).digest("hex"));
  try {
    writeFileSync(path, JSON.stringify({ job_id: jobId, relay_pid: process.pid }), { mode: 0o600, flag: "wx" });
  } catch (error) {
    if (error.code === "EEXIST") throw new Error(`This checkout already has an Agent Relay writer. Lock: ${path}`);
    throw error;
  }
  return () => unlinkSync(path);
}

function gitSnapshot(root) {
  const options = {
    cwd: root, encoding: "utf8", timeout: 3000, maxBuffer: 64 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }
  };
  const git = (...args) => spawnSync("git", ["-c", "core.fsmonitor=false", ...args], options);
  const status = git("status", "--porcelain=v1", "--no-renames", "--untracked-files=all", "--", ".");
  if (status.status !== 0) return { error: "Git status unavailable or exceeds 64 KiB." };
  const diff = git("diff", "--stat", "--no-ext-diff", "--no-textconv", "HEAD", "--", ".");
  return {
    status: status.stdout.trimEnd(),
    diff_stat: diff.status === 0 ? diff.stdout.trimEnd() : undefined
  };
}
