import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  VIBE64_STATE_DIR,
  vibe64Error,
  isMissingPathError,
  normalizeTargetRoot,
  normalizeText
} from "@local/vibe64-core/server/core";

const VIBE64_PROJECT_TYPE_FILE = "project_type";

function projectTypePath(targetRoot = process.cwd()) {
  return path.join(normalizeTargetRoot(targetRoot), VIBE64_STATE_DIR, VIBE64_PROJECT_TYPE_FILE);
}

async function readProjectTypeFile(filePath) {
  try {
    return normalizeText(await readFile(filePath, "utf8"));
  } catch (error) {
    if (isMissingPathError(error)) {
      return "";
    }
    throw error;
  }
}

function createVibe64ProjectTypeStore({
  targetRoot = process.cwd()
} = {}) {
  const normalizedTargetRoot = normalizeTargetRoot(targetRoot);
  const filePath = projectTypePath(normalizedTargetRoot);

  async function readProjectType() {
    return readProjectTypeFile(filePath);
  }

  async function writeProjectType(projectType) {
    const normalizedProjectType = normalizeText(projectType);
    if (!normalizedProjectType) {
      throw vibe64Error("Choose an Vibe64 project type.", "vibe64_project_type_missing");
    }
    await mkdir(path.dirname(filePath), {
      recursive: true
    });
    await writeFile(filePath, `${normalizedProjectType}\n`, "utf8");
    return normalizedProjectType;
  }

  return Object.freeze({
    path: filePath,
    readProjectType,
    targetRoot: normalizedTargetRoot,
    writeProjectType
  });
}

export {
  VIBE64_PROJECT_TYPE_FILE,
  createVibe64ProjectTypeStore,
  projectTypePath
};
