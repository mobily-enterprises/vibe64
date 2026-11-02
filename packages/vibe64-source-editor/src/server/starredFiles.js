import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { sourceEditorError } from "./sourceEditorPaths.js";

const pendingWrites = new Map();
const MAX_STARRED_FILES = 100;

function starredFilesPath(stateRoot, user) {
  if (!stateRoot) {
    throw new Error("Starred files require the project's runtime state root.");
  }
  const identity = user
    ? String(user.uid ?? user.id ?? user.username ?? user.osUsername ?? "")
    : "local";
  if (!identity) {
    throw new Error("Starred files require an authenticated account identity.");
  }
  const key = createHash("sha256").update(identity).digest("hex");
  return path.join(stateRoot, "source-editor", "stars", `${key}.json`);
}

async function readStarredFilePaths(filePath) {
  try {
    const record = JSON.parse(await readFile(filePath, "utf8"));
    if (
      !Array.isArray(record.paths) || record.paths.length > MAX_STARRED_FILES ||
      record.paths.some((value) => typeof value !== "string")
    ) {
      throw new Error("Stored starred files are invalid.");
    }
    return record.paths;
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function writeStarredFile(filePath, relativePath, starred) {
  // Serialize read-modify-write for one account without blocking other accounts;
  // an earlier write's failure already reached its own caller.
  const operation = (pendingWrites.get(filePath) || Promise.resolve()).catch(() => {}).then(async () => {
    const paths = await readStarredFilePaths(filePath);
    const next = starred
      ? [...new Set([...paths, relativePath])]
      : paths.filter((value) => value !== relativePath);
    if (next.length > MAX_STARRED_FILES) {
      throw sourceEditorError(`You can star up to ${MAX_STARRED_FILES} files per project.`, "vibe64_source_editor_star_limit", {}, 400, {
        params: { limit: MAX_STARRED_FILES }
      });
    }
    await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, JSON.stringify({ paths: next }), { flag: "wx", mode: 0o600 });
      await rename(temporaryPath, filePath);
    } finally {
      await rm(temporaryPath, { force: true });
    }
    return next;
  });
  pendingWrites.set(filePath, operation);
  try {
    return await operation;
  } finally {
    if (pendingWrites.get(filePath) === operation) {
      pendingWrites.delete(filePath);
    }
  }
}

export { readStarredFilePaths, starredFilesPath, writeStarredFile };
