import process from "node:process";

const JSKIT_ENV_TOKEN = "jskit.env";

function jskitRuntimeEnv(container = null, fallbackEnv = process.env) {
  if (
    container &&
    typeof container.has === "function" &&
    typeof container.make === "function" &&
    container.has(JSKIT_ENV_TOKEN)
  ) {
    const env = container.make(JSKIT_ENV_TOKEN);
    return env && typeof env === "object" && !Array.isArray(env) ? env : {};
  }
  return fallbackEnv && typeof fallbackEnv === "object" && !Array.isArray(fallbackEnv) ? fallbackEnv : {};
}

export {
  JSKIT_ENV_TOKEN,
  jskitRuntimeEnv
};
