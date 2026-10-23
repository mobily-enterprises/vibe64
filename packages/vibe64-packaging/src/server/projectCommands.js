// Release builds and checks on the saved commit run the project's own code
// (build scripts, Gradle plugins, postinstall scripts, test commands). Like every
// other project command they go through Vibe64's one command gateway, so a host
// that confines project commands confines these too. They inherit nothing from
// the editor's own environment: the caller's credential-free HOME, caches and
// declared variables are all they get. The gateway supplies PATH; folders the
// caller put in front of the editor's own PATH (a tool venv) stay in front.
import path from "node:path";

import { runVibe64Command } from "@local/vibe64-execution/server";

const COMMAND_TIMEOUT_MS = 60 * 60_000;
const OUTPUT_LIMIT = 64 * 1024;
// The gateway owns these: HOME and the XDG folders become the command's own
// home, PATH comes from the tools the host provides.
const GATEWAY_OWNED = /^(?:HOME|PATH|TMPDIR|LOGNAME|USER|XDG_[A-Z_]+)$/u;

function tail(text) {
  const value = String(text || "");
  return value.length > OUTPUT_LIMIT ? value.slice(-OUTPUT_LIMIT) : value;
}

function callerPathFolders(env) {
  const inherited = new Set(String(process.env.PATH || "").split(path.delimiter));
  return String(env.PATH || "").split(path.delimiter).filter((folder) => path.isAbsolute(folder) && !inherited.has(folder));
}

function projectCommandRequest({ command, args = [], cwd, env = {}, signal = null, projectSlug = "", operationId, timeout }) {
  if (!env.HOME) throw new TypeError("A project command needs its own credential-free HOME.");
  return {
    actor: "app",
    command,
    args,
    cwd,
    allowedRoots: [cwd],
    credentialHome: {
      home: env.HOME,
      ...(env.XDG_CACHE_HOME ? { cacheRoot: env.XDG_CACHE_HOME } : {}),
      ...(env.XDG_CONFIG_HOME ? { configRoot: env.XDG_CONFIG_HOME } : {})
    },
    env: Object.fromEntries(Object.entries(env).filter(([name]) => !GATEWAY_OWNED.test(name))),
    baseEnv: {},
    shimDirs: callerPathFolders(env),
    inheritProcessEnv: false,
    envPolicy: "project",
    purpose: "output",
    mode: "capture",
    execution: { kind: "job", lifecycle: "finite", operationId, ...(projectSlug ? { projectSlug } : {}) },
    ...(projectSlug ? { project: { slug: projectSlug } } : {}),
    maxBuffer: 32 * 1024 * 1024,
    timeout: timeout || COMMAND_TIMEOUT_MS,
    ...(signal ? { signal } : {})
  };
}

// Stage 1's runner: { command, args, cwd, env, signal } -> { ok, exitCode, stdout, stderr, error }.
async function runStageCommand({ command, args, cwd, env, signal, projectSlug } = {}, { runCommand = runVibe64Command } = {}) {
  const result = await runCommand(projectCommandRequest({ command, args, cwd, env, signal, projectSlug, operationId: "publish-build" }));
  return {
    ok: result?.ok === true,
    exitCode: Number.isInteger(result?.exitCode) ? result.exitCode : null,
    stdout: tail(result?.stdout),
    stderr: tail(result?.stderr),
    ...(result?.ok === true ? {} : { error: String(result?.error || "") })
  };
}

// A Genesis `processRunner` for checks on the saved commit: resolves on success,
// throws with the command's output otherwise, as Genesis's own runner does.
function checkCommandRunner({ projectSlug = "", runCommand = runVibe64Command } = {}) {
  return async (command, args, { cwd, env = {}, signal, timeoutMs, code = "VERIFICATION_FAILED" } = {}) => {
    const result = await runCommand(projectCommandRequest({ command, args, cwd, env, signal, projectSlug, operationId: "publish-check", timeout: timeoutMs }));
    if (result?.ok === true) return { status: 0, signal: null, stdout: Buffer.from(result.stdout || ""), stderr: Buffer.from(result.stderr || "") };
    const reason = result?.timedOut ? "timed out" : result?.exitCode == null ? String(result?.error || "could not start") : `exited with status ${result.exitCode}`;
    throw Object.assign(new Error(`${command} failed: ${reason}.`), {
      code: result?.timedOut ? "PROCESS_TIMEOUT" : code,
      details: { command, args, status: result?.exitCode ?? null, stdout: tail(result?.stdout), stderr: tail(result?.stderr || result?.error) }
    });
  };
}

export { checkCommandRunner, projectCommandRequest, runStageCommand };
