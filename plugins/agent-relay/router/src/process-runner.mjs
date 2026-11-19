import { spawn, spawnSync } from "node:child_process";

const activeRuns = new Set();

export function runProcess(binary, args, cwd, options = {}) {
  const {
    timeoutMilliseconds,
    signal,
    env = process.env,
    stdinText,
    waitForCleanup = false,
    maxOutputBytes = 2 * 1024 * 1024
  } = options;

  if (signal?.aborted) {
    return Promise.reject(new Error("Delegated run was cancelled by the host."));
  }

  return new Promise((resolvePromise, rejectPromise) => {
    const detached = process.platform !== "win32";
    const child = spawn(binary, args, {
      cwd,
      env,
      detached,
      stdio: ["pipe", "pipe", "pipe"]
    });
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let settled = false;
    let terminationError;
    let timeoutTimer;
    let forceKillTimer;
    let forceSettleTimer;
    let postExitTimer;

    const cleanup = () => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      // Parent exit must not cancel escalation for TERM-ignoring descendants.
      if (forceKillTimer && !terminationError) clearTimeout(forceKillTimer);
      if (forceSettleTimer) clearTimeout(forceSettleTimer);
      if (postExitTimer) clearTimeout(postExitTimer);
      signal?.removeEventListener("abort", onAbort);
      activeRuns.delete(terminate);
    };

    const settle = (error, code = 1) => {
      if (settled) return;
      settled = true;
      cleanup();
      child.stdout?.destroy();
      child.stderr?.destroy();
      child.stdin?.destroy();
      if (error) {
        rejectPromise(error);
        return;
      }
      resolvePromise({
        code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: stripAnsi(Buffer.concat(stderr).toString("utf8"))
      });
    };

    const terminate = (error, force = false) => {
      if (settled || terminationError) return;
      terminationError = error instanceof Error ? error : new Error(String(error));
      killTree(child, force ? "SIGKILL" : "SIGTERM");
      if (force) {
        forceSettleTimer = setTimeout(() => settle(terminationError), 100);
        forceSettleTimer.unref?.();
        return;
      }
      forceKillTimer = setTimeout(() => {
        if (processGroupExists(child)) killTree(child, "SIGKILL");
        forceSettleTimer = setTimeout(() => settle(terminationError), 100);
        forceSettleTimer.unref?.();
      }, 1_000);
    };

    const capture = (target, chunk) => {
      if (settled || terminationError) return;
      outputBytes += chunk.length;
      if (outputBytes > maxOutputBytes) {
        terminate(new Error(`Delegated output exceeded ${maxOutputBytes} bytes.`));
        return;
      }
      target.push(Buffer.from(chunk));
    };

    const onAbort = () => terminate(new Error("Delegated run was cancelled by the host."));
    activeRuns.add(terminate);
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk) => capture(stdout, chunk));
    child.stderr.on("data", (chunk) => capture(stderr, chunk));
    child.once("error", (error) => settle(error));
    child.once("exit", (code) => {
      if (terminationError) {
        if (waitForCleanup && processGroupExists(child)) return;
        settle(terminationError, code ?? 1);
        return;
      }
      killTree(child, "SIGTERM");
      if (processGroupExists(child)) {
        setTimeout(() => {
          if (processGroupExists(child)) killTree(child, "SIGKILL");
          if (waitForCleanup) postExitTimer = setTimeout(() => settle(undefined, code ?? 1), 100);
        }, 1_000);
        if (waitForCleanup) return;
      }
      postExitTimer = setTimeout(() => settle(undefined, code ?? 1), 100);
      postExitTimer.unref?.();
    });
    child.once("close", (code) => {
      if (!waitForCleanup || !processGroupExists(child)) settle(terminationError, code ?? 1);
    });

    timeoutTimer = setTimeout(() => {
      terminate(new Error(`Delegated run exceeded ${Math.ceil(timeoutMilliseconds / 1000)} seconds.`));
    }, timeoutMilliseconds);
    timeoutTimer.unref?.();

    if (stdinText === undefined) child.stdin.end();
    else child.stdin.end(stdinText, "utf8");
  });
}

export function terminateActiveRuns(reason = "Agent Relay is shutting down.", force = true) {
  for (const terminate of [...activeRuns]) terminate(new Error(reason), force);
}

function processGroupExists(child) {
  if (!child.pid) return false;
  if (process.platform === "win32") return true; // No POSIX group probe; retain cleanup fallback.
  try { process.kill(-child.pid, 0); return true; }
  catch (error) { return error?.code !== "ESRCH"; }
}

function killTree(child, signal) {
  if (!child.pid) return;
  try {
    if (process.platform === "win32") {
      if (signal === "SIGKILL") {
        spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      } else {
        child.kill(signal);
      }
    } else {
      process.kill(-child.pid, signal);
    }
  } catch (error) {
    if (error?.code === "ESRCH") return;
    try { child.kill(signal); } catch { /* Best-effort cleanup during shutdown. */ }
  }
}

function stripAnsi(value) {
  return String(value).replace(/\u001B\[[0-?]*[ -\/]*[@-~]/g, "");
}
