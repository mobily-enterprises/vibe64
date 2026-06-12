import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  vibe64Error,
  isMissingPathError,
  normalizeText
} from "@local/vibe64-core/server/core";

const VIBE64_PROJECT_TYPE_FILE = "project_type";

function projectTypePath({
  projectSharedRoot = ""
} = {}) {
  const resolvedProjectSharedRoot = String(projectSharedRoot || "").trim();
  if (!resolvedProjectSharedRoot) {
    throw vibe64Error("Project type store requires projectSharedRoot.", "vibe64_project_shared_root_required");
  }
  return path.join(path.resolve(resolvedProjectSharedRoot), VIBE64_PROJECT_TYPE_FILE);
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
  projectSharedRoot = "",
  targetRoot = process.cwd()
} = {}) {
  const normalizedTargetRoot = path.resolve(String(targetRoot || process.cwd()).trim() || process.cwd());
  const filePath = projectTypePath({
    projectSharedRoot
  });

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
