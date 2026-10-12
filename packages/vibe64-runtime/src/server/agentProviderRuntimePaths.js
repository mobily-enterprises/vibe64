import os from "node:os";
import path from "node:path";
import { normalizeAgentText } from "./agentProviders.js";

// Existing runtime path policy moved without change so the offline upgrade
// can inventory the same native owners without loading execution/Genesis.
function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(object = {}, property = "") {
  return Object.prototype.hasOwnProperty.call(object, property);
}

function runtimeEnvValue(env = {}, hostEnv = process.env, name = "") {
  const primaryEnv = isPlainObject(env) ? env : {};
  const fallbackEnv = isPlainObject(hostEnv) ? hostEnv : {};
  return normalizeAgentText(hasOwn(primaryEnv, name) ? primaryEnv[name] : fallbackEnv[name]);
}

function processUid() {
  return typeof process.getuid === "function" ? process.getuid() : "user";
}

function codexAppServerRuntimeBaseDir({
  env = process.env,
  hostEnv = process.env
} = {}) {
  const explicitDir = runtimeEnvValue(env, hostEnv, "VIBE64_AGENT_RUNTIME_DIR");
  if (explicitDir) {
    return path.resolve(explicitDir);
  }
  const xdgRuntimeDir = runtimeEnvValue(env, hostEnv, "XDG_RUNTIME_DIR");
  if (xdgRuntimeDir && path.isAbsolute(xdgRuntimeDir)) {
    return path.join(xdgRuntimeDir, "vibe64", "agent-providers");
  }
  const homeDir = normalizeAgentText(os.homedir());
  if (homeDir && path.isAbsolute(homeDir)) {
    return path.join(homeDir, ".cache", "vibe64", "agent-providers");
  }
  return path.join(os.tmpdir(), `vibe64-${processUid()}`, "agent-providers");
}

export { codexAppServerRuntimeBaseDir };
