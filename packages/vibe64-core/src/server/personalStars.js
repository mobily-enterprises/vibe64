// A person's stars in one project (starred files, starred pages): a short
// list kept in a file named by a hash of who they are, so each person sees
// only their own, and changed one step at a time per person.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { serializeByKey, writeJsonFileAtomic } from "./atomicFile.js";
import { sha256Hex } from "./sha256Hex.js";

const pendingChanges = new Map();
const STARS_FILE_PATTERN = /^[0-9a-f]{64}\.json$/u;

/**
 * The file in folder holding one person's stars; without a signed-in user,
 * the stars of whoever runs Vibe64 here.
 * @param {string} folder
 * @param {object | null | undefined} user
 */
function personalStarsFile(folder, user) {
  const identity = user ? String(user.uid ?? user.id ?? user.username ?? user.osUsername ?? "") : "local";
  if (!identity) {
    throw new Error("Stars require an authenticated account identity.");
  }
  return path.join(folder, `${sha256Hex(identity)}.json`);
}

/**
 * The starred values stored under field, in the order they were starred.
 * @param {string} file
 * @param {{ field: string, limit: number }} list
 * @returns {Promise<string[]>}
 */
async function readPersonalStars(file, { field, limit }) {
  try {
    const values = JSON.parse(await readFile(file, "utf8"))[field];
    if (!Array.isArray(values) || values.length > limit || values.some((value) => typeof value !== "string")) {
      throw new Error("Stored stars are invalid.");
    }
    return values;
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

/**
 * Stars or unstars one value; past the limit, overLimit's error and nothing saved.
 * @param {string} file
 * @param {{ field: string, limit: number, overLimit: () => Error }} list
 * @param {string} value
 * @param {boolean} starred
 * @returns {Promise<string[]>} the stars after the change
 */
function changePersonalStar(file, list, value, starred) {
  return serializeByKey(pendingChanges, file, async () => {
    const values = await readPersonalStars(file, list);
    const next = starred ? [...new Set([...values, value])] : values.filter((entry) => entry !== value);
    if (next.length > list.limit) {
      throw list.overLimit();
    }
    await writeJsonFileAtomic(file, { [list.field]: next }, { directoryMode: 0o700, fileMode: 0o600 });
    return next;
  });
}

/**
 * Unstars a value for everyone whose stars are kept in folder, when the thing
 * it names is gone.
 * @param {string} folder
 * @param {{ field: string, limit: number, overLimit: () => Error }} list
 * @param {string} value
 */
async function forgetPersonalStar(folder, list, value) {
  let names;
  try {
    names = await readdir(folder);
  } catch (error) {
    if (error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  for (const name of names.filter((entry) => STARS_FILE_PATTERN.test(entry))) {
    const file = path.join(folder, name);
    if ((await readPersonalStars(file, list)).includes(value)) {
      await changePersonalStar(file, list, value, false);
    }
  }
}

export { changePersonalStar, forgetPersonalStar, personalStarsFile, readPersonalStars };
