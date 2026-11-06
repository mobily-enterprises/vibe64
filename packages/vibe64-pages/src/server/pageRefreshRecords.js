// A page's refresh, kept beside its versions:
//
//   <project state>/pages/<page id>/refresh.json        the schedule, who set it, its state and its last runs
//   <project state>/pages/<page id>/refresh/<script>    a command refresh's script, as the agent wrote it
//
// Deleting the page deletes both with it.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { serializeByKey, writeJsonFileAtomic } from "@local/vibe64-core/server/atomicFile";

const REFRESH_CONTRACT = "vibe64.page-refresh.v1";
const REFRESH_FILE = "refresh.json";
const SCRIPT_DIR = "refresh";
const RUNS_KEPT = 10;
const LOG_LIMIT = 8000;

/**
 * The end of a run's output, which is what a person needs to see why it failed.
 * @param {string} text
 */
function logTail(text) {
  const value = String(text || "").trimEnd();
  return value.length > LOG_LIMIT ? `…${value.slice(-LOG_LIMIT)}` : value;
}

function createPageRefreshRecords() {
  const pending = new Map();

  /**
   * @param {string} folder the page's folder
   * @returns {Promise<object | null>}
   */
  async function read(folder) {
    let record;
    try {
      record = JSON.parse(await readFile(path.join(folder, REFRESH_FILE), "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "ENOTDIR" || error instanceof SyntaxError) return null;
      throw error;
    }
    return record?.contract === REFRESH_CONTRACT ? record : null;
  }

  /**
   * Changes the refresh in one step; `edit` gets the record (or null) and returns the new one,
   * or null to leave it as it is.
   * @param {string} folder
   * @param {(record: object | null) => object | null | Promise<object | null>} edit
   */
  function change(folder, edit) {
    return serializeByKey(pending, folder, async () => {
      const current = await read(folder);
      const next = await edit(current);
      if (!next) return current;
      const record = { ...next, contract: REFRESH_CONTRACT, runs: (next.runs || []).slice(-RUNS_KEPT) };
      await writeJsonFileAtomic(path.join(folder, REFRESH_FILE), record);
      return record;
    });
  }

  /**
   * Replaces the refresh, and the script a command refresh runs.
   * @param {string} folder
   * @param {object} record
   * @param {{ name: string, content: Buffer } | null} script
   */
  function replace(folder, record, script) {
    return change(folder, async () => {
      await rm(path.join(folder, SCRIPT_DIR), { force: true, recursive: true });
      if (script) {
        await mkdir(path.join(folder, SCRIPT_DIR), { recursive: true });
        await writeFile(path.join(folder, SCRIPT_DIR, script.name), script.content, { mode: 0o600 });
      }
      return record;
    });
  }

  /** @param {string} folder */
  function remove(folder) {
    return serializeByKey(pending, folder, async () => {
      const current = await read(folder);
      await rm(path.join(folder, REFRESH_FILE), { force: true });
      await rm(path.join(folder, SCRIPT_DIR), { force: true, recursive: true });
      return current;
    });
  }

  /**
   * A command refresh's script.
   * @param {string} folder
   * @param {string} name
   */
  function readScript(folder, name) {
    return readFile(path.join(folder, SCRIPT_DIR, name));
  }

  return Object.freeze({
    change,
    read,
    readScript,
    remove,
    replace
  });
}

export { createPageRefreshRecords, logTail, RUNS_KEPT };
