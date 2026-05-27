import { access } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const VIBE64_STATE_DIR = ".vibe64";

function normalizeText(value) {
  return String(value ?? "").trim();
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function plainClone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function normalizeTargetRoot(targetRoot = process.cwd()) {
  return path.resolve(normalizeText(targetRoot) || process.cwd());
}

function vibe64Error(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isMissingPathError(error) {
  return error?.code === "ENOENT" || error?.code === "ENOTDIR";
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error;
    }
    return false;
  }
}

export {
  VIBE64_STATE_DIR,
  vibe64Error,
  isPlainObject,
  isMissingPathError,
  normalizeText,
  normalizeTargetRoot,
  plainClone,
  pathExists
};
