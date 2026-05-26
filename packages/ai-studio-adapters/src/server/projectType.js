import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  AI_STUDIO_STATE_DIR,
  aiStudioError,
  isMissingPathError,
  normalizeTargetRoot,
  normalizeText
} from "@local/ai-studio-core/server/core";

const AI_STUDIO_PROJECT_TYPE_FILE = "project_type";

function projectTypePath(targetRoot = process.cwd()) {
  return path.join(normalizeTargetRoot(targetRoot), AI_STUDIO_STATE_DIR, AI_STUDIO_PROJECT_TYPE_FILE);
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

function createAiStudioProjectTypeStore({
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
      throw aiStudioError("Choose an AI Studio project type.", "ai_studio_project_type_missing");
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
  AI_STUDIO_PROJECT_TYPE_FILE,
  createAiStudioProjectTypeStore,
  projectTypePath
};
