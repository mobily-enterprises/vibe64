import { constants as fsConstants } from "node:fs";
import {
  access,
  readFile
} from "node:fs/promises";

async function fileExists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile(filePath) {
  try {
    const text = await readFile(filePath, "utf8");
    return {
      ok: true,
      value: JSON.parse(text)
    };
  } catch (error) {
    return {
      error: String(error?.message || error),
      ok: false,
      value: null
    };
  }
}

export {
  fileExists,
  readJsonFile
};
