import path from "node:path";
import process from "node:process";

import {
  normalizeText,
  vibe64Error
} from "@local/vibe64-core/server/core";
import {
  VIBE64_PROJECT_MANIFEST_FILE,
  projectManifestPath,
  readProjectManifest,
  updateProjectManifest
} from "@local/vibe64-core/server/projectManifest";

const VIBE64_PROJECT_TYPE_FIELD = "projectType";

function projectTypePath({
  sourceContractRoot = ""
} = {}) {
  return projectManifestPath({
    sourceContractRoot
  });
}

function createVibe64ProjectTypeStore({
  sourceContractRoot = "",
  targetRoot = process.cwd()
} = {}) {
  const normalizedTargetRoot = path.resolve(String(targetRoot || process.cwd()).trim() || process.cwd());
  const filePath = projectTypePath({
    sourceContractRoot
  });

  async function readProjectType() {
    return normalizeText((await readProjectManifest({
      sourceContractRoot
    }))?.projectType);
  }

  async function writeProjectType(projectType) {
    const normalizedProjectType = normalizeText(projectType);
    if (!normalizedProjectType) {
      throw vibe64Error("Choose an Vibe64 project type.", "vibe64_project_type_missing");
    }
    await updateProjectManifest({
      sourceContractRoot,
      update: (manifest) => ({
        ...manifest,
        projectType: normalizedProjectType
      })
    });
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
  VIBE64_PROJECT_MANIFEST_FILE,
  VIBE64_PROJECT_TYPE_FIELD,
  createVibe64ProjectTypeStore,
  projectTypePath
};
