// Small JSON state files written atomically and durably (Core's atomic file
// writer), so a crash or a power cut never leaves half a record behind.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { writeJsonFileAtomic } from "@local/vibe64-core/server/atomicFile";

/**
 * Reads one JSON state file; a missing file reads as what `fallback` returns.
 * @param {string} file
 * @param {() => unknown} fallback
 */
async function readJsonFile(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback();
    if (error instanceof SyntaxError) {
      throw Object.assign(new Error(`${path.basename(file)} is not valid JSON.`), { code: "vibe64_publishing_state_invalid" });
    }
    throw error;
  }
}

async function writeJsonFile(file, value, options = {}) {
  const { mode = 0o600, directoryMode = 0o700 } = options;
  await writeJsonFileAtomic(file, value, { directoryMode, fileMode: mode });
  return value;
}

/**
 * One writer at a time per file inside this process.
 */
function serialized() {
  let tail = Promise.resolve();
  return (operation) => {
    const run = tail.then(operation, operation);
    tail = run.catch(() => {}); // The queue goes on; run's failure reaches its caller.
    return run;
  };
}

export { readJsonFile, serialized, writeJsonFile };
