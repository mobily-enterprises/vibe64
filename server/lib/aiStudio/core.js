import { access } from "node:fs/promises";

function normalizeText(value) {
  return String(value ?? "").trim();
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
  isMissingPathError,
  normalizeText,
  pathExists
};
