import { access } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

function normalizeText(value) {
  return String(value ?? "").trim();
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function normalizeTargetRoot(targetRoot = process.cwd()) {
  return path.resolve(normalizeText(targetRoot) || process.cwd());
}

function aiStudioError(message, code) {
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
  aiStudioError,
  isPlainObject,
  isMissingPathError,
  normalizeText,
  normalizeTargetRoot,
  pathExists
};
