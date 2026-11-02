import { readFile } from "node:fs/promises";
import path from "node:path";

import { serializeByKey, writeJsonFileAtomic } from "./atomicFile.js";

import { isPlainObject } from "./core.js";
import { toText } from "@jskit-ai/kernel/shared/support/normalize";

const projectRecordMetadataUpdates = new Map();

async function readProjectRecordMetadata(projectRecordPath = "") {
  const filePath = toText(projectRecordPath);
  if (!filePath) {
    return {};
  }
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

/**
 * Replaces a project record's metadata with what update returns for the current metadata, one update per record at a time.
 * @param {string} projectRecordPath
 * @param {(current: object) => object | Promise<object>} update
 */
async function updateProjectRecordMetadata(projectRecordPath, update) {
  const filePath = toText(projectRecordPath);
  if (!filePath) {
    throw new Error("Updating project metadata requires a project record path.");
  }
  const metadataPath = path.resolve(filePath);
  return serializeByKey(projectRecordMetadataUpdates, metadataPath, async () => {
    const next = await update(await readProjectRecordMetadata(metadataPath));
    if (!isPlainObject(next)) {
      throw new TypeError("Project metadata updates must produce an object.");
    }
    await writeJsonFileAtomic(metadataPath, next);
    return next;
  });
}

export {
  readProjectRecordMetadata,
  updateProjectRecordMetadata
};
