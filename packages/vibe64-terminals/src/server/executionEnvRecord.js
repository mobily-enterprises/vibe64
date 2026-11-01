/**
 * An Env record with trimmed names and text values; names that are empty are dropped.
 */
function executionEnvRecord(env = {}) {
  if (!env || typeof env !== "object" || Array.isArray(env)) {
    return {};
  }
  return Object.fromEntries(Object.entries(env).map(([key, value]) => [
    String(key || "").trim(),
    String(value ?? "")
  ]).filter(([key]) => Boolean(key)));
}

export { executionEnvRecord };
