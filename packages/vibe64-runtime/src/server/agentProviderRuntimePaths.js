import os from "node:os";
import path from "node:path";
import { toText } from "@jskit-ai/kernel/shared/support/normalize";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */

// Runtime path policy kept apart so the offline upgrade can inventory the same
// native owners without loading execution/Genesis.

function processUid() {
  // readable-check: allow method-probe - platform object: process.getuid() and process.getgid() exist only on POSIX
  return typeof process.getuid === "function" ? process.getuid() : "user";
}

/**
 * The directory that holds native agent provider runtimes: the one the
 * environment names, else the host's runtime directory, else a per-user cache.
 * @param {object} options
 * @param {RuntimeEnv} options.env
 */
function codexAppServerRuntimeBaseDir({ env }) {
  const explicitDir = toText(env.VIBE64_AGENT_RUNTIME_DIR);
  if (explicitDir) {
    return path.resolve(explicitDir);
  }
  const xdgRuntimeDir = toText(env.XDG_RUNTIME_DIR);
  if (xdgRuntimeDir && path.isAbsolute(xdgRuntimeDir)) {
    return path.join(xdgRuntimeDir, "vibe64", "agent-providers");
  }
  const homeDir = toText(os.homedir());
  if (homeDir && path.isAbsolute(homeDir)) {
    return path.join(homeDir, ".cache", "vibe64", "agent-providers");
  }
  return path.join(os.tmpdir(), `vibe64-${processUid()}`, "agent-providers");
}

export { codexAppServerRuntimeBaseDir };
