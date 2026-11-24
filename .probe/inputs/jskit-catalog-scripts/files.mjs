import { access } from "node:fs/promises";
import path from "node:path";

async function fileExists(absolutePath) {
  try {
    await access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

function toPosixPath(value = "") {
  return String(value || "").split(path.sep).join("/");
}

export { fileExists, toPosixPath };
