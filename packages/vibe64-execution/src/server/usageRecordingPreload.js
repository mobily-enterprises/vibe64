import { realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * This installation's recorder runtime: the usage recording package installed
 * beside this one, or in a node_modules folder above this file.
 */
function usageRecordingRuntimeRoots(fromFile) {
  const candidates = [path.resolve(path.dirname(fromFile), "../../../vibe64-usage-recording/runtime/node")];
  for (let directory = path.dirname(fromFile); ; directory = path.dirname(directory)) {
    candidates.push(path.join(directory, "node_modules/@local/vibe64-usage-recording/runtime/node"));
    if (path.dirname(directory) === directory) break;
  }
  return candidates.flatMap((candidate) => {
    try {
      return [realpathSync(candidate)];
    } catch {
      return [];
    }
  });
}

/**
 * The only NODE_OPTIONS a launch receives from Vibe64: the usage recorder's
 * preload, accepted as a regular file reached through no symbolic link inside
 * this installation's recorder runtime. The host helper keeps its own copy.
 */
function usageRecordingNodeOptions(preload = "", fromFile = fileURLToPath(import.meta.url)) {
  try {
    if (path.resolve(preload) === preload && realpathSync(preload) === preload && statSync(preload).isFile() &&
        usageRecordingRuntimeRoots(fromFile).some((root) => preload.startsWith(`${root}${path.sep}`))) {
      return `--import=${preload}`;
    }
  } catch {
    // Reported below like any other refused path.
  }
  throw Object.assign(new Error("The usage recorder is not part of this Vibe64 installation."), {
    code: "vibe64_usage_recording_preload_invalid"
  });
}

export { usageRecordingNodeOptions };
