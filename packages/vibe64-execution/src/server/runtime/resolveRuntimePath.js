import {
  normalizeText,
  uniqueStrings
} from "../normalize.js";
import {
  runtimePackBinPaths
} from "./runtimePacks.js";

const DEFAULT_SYSTEM_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

function pathParts(value = "") {
  return String(value || "")
    .split(":")
    .map(normalizeText)
    .filter(Boolean);
}

function resolveRuntimePath({
  env = process.env,
  existingPath = "",
  runtimes = [],
  shimDirs = []
} = {}) {
  return uniqueStrings([
    ...pathParts(shimDirs.join(":")),
    ...runtimes.flatMap((runtime) => runtimePackBinPaths(runtime, { env })),
    ...pathParts(existingPath || env.PATH),
    ...pathParts(DEFAULT_SYSTEM_PATH)
  ]).join(":");
}

export {
  DEFAULT_SYSTEM_PATH,
  resolveRuntimePath
};
