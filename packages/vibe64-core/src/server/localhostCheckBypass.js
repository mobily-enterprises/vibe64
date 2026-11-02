/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */

const LOCALHOST_CHECK_BYPASS_FLAG = "--bypass-localhost-check";
const LOCALHOST_CHECK_BYPASS_ENV = "VIBE64_BYPASS_LOCALHOST_CHECK";

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
 * Whether this process was started with the localhost check bypassed.
 * @param {object} options
 * @param {string[]} [options.argv]
 * @param {RuntimeEnv} options.env
 */
function isLocalhostCheckBypassEnabled({
  argv = process.argv,
  env
}) {
  return hasLocalhostCheckBypassArg(argv) || isTruthyEnvValue(env[LOCALHOST_CHECK_BYPASS_ENV]);
}

const __testables = Object.freeze({ LOCALHOST_CHECK_BYPASS_FLAG });

export {
  LOCALHOST_CHECK_BYPASS_ENV,
  hasLocalhostCheckBypassArg,
  isLocalhostCheckBypassEnabled,
  stripLocalhostCheckBypassArgs,
  __testables
};
