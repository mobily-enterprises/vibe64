// Release history: one text record per release or dry run, in
// `<project runtime>/publishing/releases/<id>.json`. A record holds the confirmed
// plan hash, versions, tags, build numbers, tools, each package's checksums and
// each target's outcome and proof, plus a short log without secrets.
import { randomBytes } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";

import { publishingError } from "../publishingError.js";
import { readJsonFile, serialized, writeJsonFile } from "./jsonFile.js";

const RELEASE_RECORD_CONTRACT = "vibe64.publishing-release.v1";
const RELEASE_ID = /^r-\d{8}-\d{6}-[0-9a-f]{6}$/u;
const LOG_LIMIT = 400;
const LINE_LIMIT = 2000;

/**
 * A release the history does not hold. Its code answers 404; each sentence has its own messageCode.
 */
function historyError(message, options) {
  return publishingError(message, "vibe64_publishing_release_missing", options);
}

function releaseId(at) {
  const stamp = at.replace(/[-:]/gu, "").replace("T", "-").slice(0, 15);
  return `r-${stamp}-${randomBytes(3).toString("hex")}`;
}

/**
 * @param {object} dependencies
 * @param {string} dependencies.runtimeRoot
 * @param {() => string} [dependencies.now]
 */
function createReleaseHistoryStore({ runtimeRoot, now = () => new Date().toISOString() }) {
  if (!path.isAbsolute(runtimeRoot || "")) throw new TypeError("The release history needs the project's publishing folder.");
  const directory = path.join(runtimeRoot, "releases");
  const exclusive = serialized();
  // Every record this store has read or written, without its log. The store is
  // its folder's only writer in this process, so a list reads only the records
  // it has not seen yet; read(id) still reads the file, log included.
  const known = new Map();
  const remember = ({ log: _log, ...record }) => {
    // A copy: the caller may go on changing the record it was given.
    known.set(record.id, structuredClone(record));
  };
  const fileOf = (id) => {
    if (!RELEASE_ID.test(id || "")) throw historyError("That is not a release id.", { messageCode: "vibe64_publishing_release_id_unknown" });
    return path.join(directory, `${id}.json`);
  };

  async function read(id) {
    const record = await readJsonFile(fileOf(id), () => null);
    if (!record) throw historyError(`There is no release ${id}.`, { messageCode: "vibe64_publishing_release_not_found", params: { releaseId: id } });
    return record;
  }

  /**
   * Applies `change(record)` under the store's lock and saves the result.
   */
  function update(id, change) {
    return exclusive(async () => {
      const record = await read(id);
      const next = (await change(structuredClone(record))) || record;
      next.log = (next.log || []).slice(-LOG_LIMIT);
      await writeJsonFile(fileOf(id), next);
      remember(next);
      return next;
    });
  }

  async function create(fields = {}) {
    const createdAt = now();
    const record = {
      contract: RELEASE_RECORD_CONTRACT,
      id: releaseId(createdAt),
      createdAt,
      finishedAt: null,
      status: "running",
      log: [],
      ...fields
    };
    await writeJsonFile(fileOf(record.id), record);
    remember(record);
    return record;
  }

  function appendLog(id, message, level = "info") {
    return update(id, (record) => {
      record.log.push({ at: now(), level, message: String(message).slice(0, LINE_LIMIT) });
      return record;
    });
  }

  /**
   * Records without their logs, newest activity first.
   */
  async function list({ limit = 50 } = {}) {
    let names = [];
    try {
      names = await readdir(directory);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const ids = new Set(names.filter((name) => name.endsWith(".json")).map((name) => name.slice(0, -5)).filter((id) => RELEASE_ID.test(id)));
    for (const id of known.keys()) {
      if (!ids.has(id)) known.delete(id);
    }
    for (const id of ids) {
      if (known.has(id)) continue;
      const record = await readJsonFile(fileOf(id), () => null);
      // A write that finished while this read was pending is newer.
      if (record?.contract === RELEASE_RECORD_CONTRACT && !known.has(id)) remember(record);
    }
    /**
     * Newest activity first: a release resumed by a new confirmation moves up.
     */
    const activity = (record) => record.resumedAt || record.createdAt;
    return [...known.values()]
      .sort((left, right) => activity(right).localeCompare(activity(left)) || right.id.localeCompare(left.id))
      .slice(0, limit)
      .map((record) => structuredClone(record));
  }

  return Object.freeze({
    directory,
    read,
    update,
    create,
    appendLog,
    list
  });
}

export { createReleaseHistoryStore };
