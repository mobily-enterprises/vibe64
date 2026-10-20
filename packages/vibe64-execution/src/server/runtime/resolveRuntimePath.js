import process from "node:process";

import {
  normalizeText,
  uniqueStrings
} from "../normalize.js";
import {
  runtimePackBinPaths,
  runtimePackGuardBinPaths,
  runtimePackPolicyBinPaths,
  runtimePackRoot
} from "./runtimePacks.js";

const DEFAULT_SYSTEM_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

function pathParts(value = "") {
  return String(value || "")
    .split(":")
    .map(normalizeText)
    .filter(Boolean);
}

// Without packs, commands come from the tools installed for the person running
// Vibe64, so the server's own PATH (and Homebrew on macOS) stays reachable.
function installedToolPath() {
  if (runtimePackRoot()) return [];
  return [
    ...pathParts(process.env.PATH),
    ...(process.platform === "darwin" ? ["/opt/homebrew/bin"] : [])
  ];
}

function resolveRuntimePath({
  env = process.env,
  existingPath = "",
  runtimes = [],
  shimDirs = []
} = {}) {
  return uniqueStrings([
    ...pathParts(shimDirs.join(":")),
    ...runtimePackPolicyBinPaths(),
    ...runtimes.flatMap((runtime) => runtimePackBinPaths(runtime)),
    ...runtimePackGuardBinPaths(),
    ...pathParts(existingPath || env.PATH),
    ...installedToolPath(),
    ...pathParts(DEFAULT_SYSTEM_PATH)
  ]).join(":");
}

export {
  DEFAULT_SYSTEM_PATH,
  resolveRuntimePath
};
