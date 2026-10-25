import { readFile } from "node:fs/promises";
import path from "node:path";

import { serializeByKey, writeJsonFileAtomic } from "./atomicFile.js";

import {
  isPlainObject,
  normalizeText
} from "./core.js";

const projectRecordMetadataUpdates = new Map();

async function readProjectRecordMetadata(projectRecordPath = "") {
  const filePath = normalizeText(projectRecordPath);
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

async function updateProjectRecordMetadata(projectRecordPath = "", update = {}) {
  const filePath = normalizeText(projectRecordPath);
  if (!filePath) {
    throw new Error("Updating project metadata requires a project record path.");
  }
  const metadataPath = path.resolve(filePath);
  return serializeByKey(projectRecordMetadataUpdates, metadataPath, async () => {
    const current = await readProjectRecordMetadata(metadataPath);
    const next = typeof update === "function"
      ? await update(current)
      : {
          ...current,
          ...(isPlainObject(update) ? update : {})
        };
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
