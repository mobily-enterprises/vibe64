const LOCALHOST_CHECK_BYPASS_FLAG = "--bypass-localhost-check";
const LOCALHOST_CHECK_BYPASS_ENV = "JSKIT_STUDIO_BYPASS_LOCALHOST_CHECK";

function isTruthyEnvValue(value = "") {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function hasLocalhostCheckBypassArg(argv = []) {
  return Array.isArray(argv) && argv.some((arg) => String(arg || "") === LOCALHOST_CHECK_BYPASS_FLAG);
}

function stripLocalhostCheckBypassArgs(args = []) {
  return (Array.isArray(args) ? args : []).filter((arg) => String(arg || "") !== LOCALHOST_CHECK_BYPASS_FLAG);
}

function isLocalhostCheckBypassEnabled({
  argv = process.argv,
  env = process.env
} = {}) {
  return hasLocalhostCheckBypassArg(argv) || isTruthyEnvValue(env?.[LOCALHOST_CHECK_BYPASS_ENV]);
}

export {
  LOCALHOST_CHECK_BYPASS_ENV,
  LOCALHOST_CHECK_BYPASS_FLAG,
  hasLocalhostCheckBypassArg,
  isLocalhostCheckBypassEnabled,
  stripLocalhostCheckBypassArgs
};
