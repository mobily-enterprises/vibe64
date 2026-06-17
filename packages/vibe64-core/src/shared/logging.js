const DEFAULT_VIBE64_LOG_LEVEL = "warn";
const VIBE64_LOG_LEVEL_ENV = "VIBE64_LOG_LEVEL";
const STANDARD_LOG_LEVEL_ENV = "LOG_LEVEL";
const VIBE64_LOG_LEVELS = Object.freeze([
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
  "silent"
]);
const VIBE64_LOG_LEVEL_SEVERITY = Object.freeze({
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
  silent: Infinity
});

function runtimeEnv(globalObject = globalThis) {
  return globalObject?.process?.env || {};
}

function isTruthyEnvValue(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return Boolean(normalized) && !["0", "false", "no", "off"].includes(normalized);
}

function normalizeVibe64LogLevel(value = "", fallback = DEFAULT_VIBE64_LOG_LEVEL) {
  const normalized = String(value || "").trim().toLowerCase();
  if (VIBE64_LOG_LEVELS.includes(normalized)) {
    return normalized;
  }
  return fallback;
}

function resolveVibe64LogLevel({
  defaultLevel = DEFAULT_VIBE64_LOG_LEVEL,
  env = runtimeEnv(),
  level = ""
} = {}) {
  const fallback = normalizeVibe64LogLevel(defaultLevel, DEFAULT_VIBE64_LOG_LEVEL);
  const explicitLevel = String(level || "").trim();
  const envLevel = String(env?.[VIBE64_LOG_LEVEL_ENV] || "").trim();
  const standardEnvLevel = String(env?.[STANDARD_LOG_LEVEL_ENV] || "").trim();
  const requestedLevel = explicitLevel || envLevel || standardEnvLevel;
  const source = explicitLevel
    ? "option"
    : envLevel
      ? VIBE64_LOG_LEVEL_ENV
      : standardEnvLevel
        ? STANDARD_LOG_LEVEL_ENV
        : "default";
  const normalizedLevel = normalizeVibe64LogLevel(requestedLevel, fallback);
  return {
    defaultLevel: fallback,
    level: normalizedLevel,
    requestedLevel,
    source,
    valid: !requestedLevel || VIBE64_LOG_LEVELS.includes(String(requestedLevel).trim().toLowerCase())
  };
}

function isVibe64LogLevelEnabled(messageLevel = "info", configuredLevel = DEFAULT_VIBE64_LOG_LEVEL) {
  const normalizedMessageLevel = normalizeVibe64LogLevel(messageLevel, "");
  const normalizedConfiguredLevel = normalizeVibe64LogLevel(configuredLevel, DEFAULT_VIBE64_LOG_LEVEL);
  if (!normalizedMessageLevel || normalizedConfiguredLevel === "silent") {
    return false;
  }
  return VIBE64_LOG_LEVEL_SEVERITY[normalizedMessageLevel] >= VIBE64_LOG_LEVEL_SEVERITY[normalizedConfiguredLevel];
}

function isVibe64DebugLoggingEnabled({
  env = runtimeEnv(),
  flagName = "",
  level = ""
} = {}) {
  if (flagName && isTruthyEnvValue(env?.[flagName])) {
    return true;
  }
  const resolvedLevel = resolveVibe64LogLevel({
    env,
    level
  }).level;
  return isVibe64LogLevelEnabled("debug", resolvedLevel);
}

function browserSearchParamEnabled(search = "", paramName = "") {
  if (!paramName) {
    return false;
  }
  const params = new URLSearchParams(String(search || "").replace(/^\?/, ""));
  if (!params.has(paramName)) {
    return false;
  }
  const value = params.get(paramName);
  return value === "" || isTruthyEnvValue(value);
}

function browserStorageFlagEnabled(storage, key = "") {
  if (!storage || !key) {
    return false;
  }
  try {
    return isTruthyEnvValue(storage.getItem(key));
  } catch {
    return false;
  }
}

function isVibe64BrowserFlagEnabled({
  globalObject = globalThis,
  queryParam = "",
  storageKey = ""
} = {}) {
  const location = globalObject?.location || globalObject?.window?.location;
  if (browserSearchParamEnabled(location?.search || "", queryParam)) {
    return true;
  }
  const storage = globalObject?.localStorage || globalObject?.window?.localStorage;
  return browserStorageFlagEnabled(storage, storageKey);
}

export {
  DEFAULT_VIBE64_LOG_LEVEL,
  isTruthyEnvValue,
  isVibe64BrowserFlagEnabled,
  isVibe64DebugLoggingEnabled,
  isVibe64LogLevelEnabled,
  normalizeVibe64LogLevel,
  resolveVibe64LogLevel,
  STANDARD_LOG_LEVEL_ENV,
  VIBE64_LOG_LEVEL_ENV,
  VIBE64_LOG_LEVELS
};
