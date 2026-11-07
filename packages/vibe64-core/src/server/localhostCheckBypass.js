import { vibe64Host } from "@local/vibe64-execution/server/hostProfile";
import { isLoopbackAddress } from "./localStudioRequest.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */

const LOCALHOST_CHECK_BYPASS_FLAG = "--bypass-localhost-check";
const LOCALHOST_CHECK_BYPASS_ENV = "VIBE64_BYPASS_LOCALHOST_CHECK";
const LOCALHOST_CHECK_BYPASS_REFUSED = "vibe64_localhost_check_bypass_refused";

function isTruthyEnvValue(value = "") {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function hasLocalhostCheckBypassArg(argv = []) {
  return Array.isArray(argv) && argv.some((arg) => String(arg || "") === LOCALHOST_CHECK_BYPASS_FLAG);
}

function stripLocalhostCheckBypassArgs(args = []) {
  return (Array.isArray(args) ? args : []).filter((arg) => String(arg || "") !== LOCALHOST_CHECK_BYPASS_FLAG);
}

/**
 * The host a Vite launch listens on: "" for its loopback default, and every
 * interface for a bare --host.
 * @param {string[]} args
 */
function launchHostArg(args = []) {
  const list = Array.isArray(args) ? args.map((arg) => String(arg || "")) : [];
  const index = list.findIndex((arg) => arg === "--host" || arg.startsWith("--host="));
  if (index < 0) return "";
  if (list[index].startsWith("--host=")) return list[index].slice("--host=".length).trim() || "0.0.0.0";
  const next = list[index + 1] || "";
  return next && !next.startsWith("-") ? next.trim() : "0.0.0.0";
}

function bypassRefusal(reason) {
  const error = new Error(
    `The localhost check bypass is only for local development on this computer, and ${reason} ` +
    `Remove ${LOCALHOST_CHECK_BYPASS_FLAG} and ${LOCALHOST_CHECK_BYPASS_ENV} to start.`
  );
  error.code = LOCALHOST_CHECK_BYPASS_REFUSED;
  return error;
}

/**
 * Refuses the bypass where it would open the editor to more than this
 * computer's own developer: a host listening beyond loopback, or a server that
 * is not a local editor.
 * @param {object} input
 * @param {string} [input.host] the TCP host the server or its development proxy listens on
 * @param {boolean} [input.local] whether the server is a local editor
 */
function assertLocalhostCheckBypassAllowed({ host = "", local = true } = {}) {
  if (!local) {
    throw bypassRefusal("this server is not a local editor.");
  }
  if (!isLoopbackAddress(host)) {
    throw bypassRefusal(`it would listen on ${host}, not on loopback.`);
  }
}

/**
 * Whether this process was started with the localhost check bypassed. A host
 * that shares or provisions its machine (several Unix accounts, a command
 * helper or its own tool packs) refuses it.
 * @param {object} options
 * @param {string[]} [options.argv]
 * @param {RuntimeEnv} options.env
 */
function isLocalhostCheckBypassEnabled({
  argv = process.argv,
  env
}) {
  const enabled = hasLocalhostCheckBypassArg(argv) || isTruthyEnvValue(env[LOCALHOST_CHECK_BYPASS_ENV]);
  const host = vibe64Host();
  if (enabled && (host.sharedGroupAccess || host.execHelperPath || host.runtimePackRoot || host.sharedCacheRoot)) {
    throw bypassRefusal("this host shares or provisions its machine.");
  }
  return enabled;
}

const __testables = Object.freeze({ LOCALHOST_CHECK_BYPASS_FLAG });

export {
  LOCALHOST_CHECK_BYPASS_ENV,
  LOCALHOST_CHECK_BYPASS_REFUSED,
  assertLocalhostCheckBypassAllowed,
  hasLocalhostCheckBypassArg,
  isLocalhostCheckBypassEnabled,
  launchHostArg,
  stripLocalhostCheckBypassArgs,
  __testables
};
