// Release history: one text record per release or dry run, in
// `<project runtime>/publishing/releases/<id>.json`. A record holds the confirmed
// plan hash, versions, tags, build numbers, tools, each package's checksums and
// each target's outcome and proof, plus a short log without secrets.
import { randomBytes } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";

import { readJsonFile, serialized, writeJsonFile } from "./jsonFile.js";

const RELEASE_RECORD_CONTRACT = "vibe64.publishing-release.v1";
const RELEASE_ID = /^r-\d{8}-\d{6}-[0-9a-f]{6}$/u;
const LOG_LIMIT = 400;
const LINE_LIMIT = 2000;

function historyError(message, code = "vibe64_publishing_release_missing") {
  return Object.assign(new Error(message), { code });
}

function releaseId(at) {
  const stamp = at.replace(/[-:]/gu, "").replace("T", "-").slice(0, 15);
  return `r-${stamp}-${randomBytes(3).toString("hex")}`;
}

function createReleaseHistoryStore({ runtimeRoot, now = () => new Date().toISOString() } = {}) {
  if (!path.isAbsolute(runtimeRoot || "")) throw new TypeError("The release history needs the project's publishing folder.");
  const directory = path.join(runtimeRoot, "releases");
  const exclusive = serialized();
  const fileOf = (id) => {
    if (!RELEASE_ID.test(id || "")) throw historyError("That is not a release id.");
    return path.join(directory, `${id}.json`);
  };

  async function read(id) {
    const record = await readJsonFile(fileOf(id), null);
    if (!record) throw historyError(`There is no release ${id}.`);
    return record;
  }

  // Applies `change(record)` under the store's lock and saves the result.
  function update(id, change) {
    return exclusive(async () => {
      const record = await read(id);
      const next = (await change(structuredClone(record))) || record;
      next.log = (next.log || []).slice(-LOG_LIMIT);
      await writeJsonFile(fileOf(id), next);
      return next;
    });
  }

  return Object.freeze({
    directory,
    read,
    update,
    async create(fields = {}) {
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
      return record;
    },
    appendLog(id, message, level = "info") {
      return update(id, (record) => {
        record.log.push({ at: now(), level, message: String(message).slice(0, LINE_LIMIT) });
        return record;
      });
    },
    async list({ limit = 50 } = {}) {
      let names = [];
      try {
        names = await readdir(directory);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      const ids = names.filter((name) => name.endsWith(".json")).map((name) => name.slice(0, -5)).filter((id) => RELEASE_ID.test(id));
      const records = [];
      for (const id of ids) {
        const record = await readJsonFile(fileOf(id), null);
        if (record?.contract === RELEASE_RECORD_CONTRACT) records.push(record);
      }
      return records.sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)).slice(0, limit);
    }
  });
}

export { RELEASE_RECORD_CONTRACT, createReleaseHistoryStore };
