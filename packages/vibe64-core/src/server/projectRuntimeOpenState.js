import { readFile, rm } from "node:fs/promises";
import path from "node:path";

import { writeJsonFileAtomic } from "./atomicFile.js";
import { isMissingPathError, isPlainObject } from "./core.js";
import { toText } from "@jskit-ai/kernel/shared/support/normalize";

const PROJECT_RUNTIME_STATE_DIR = "runtime";
const PROJECT_RUNTIME_OPEN_STATE_FILE = "open.json";

function projectRuntimeOpenStatePath(projectRuntimeRoot = "") {
  const root = toText(projectRuntimeRoot);
  return root ? path.join(path.resolve(root), PROJECT_RUNTIME_STATE_DIR, PROJECT_RUNTIME_OPEN_STATE_FILE) : "";
}

async function readProjectRuntimeOpenState({
  projectRuntimeRoot = ""
} = {}) {
  const filePath = projectRuntimeOpenStatePath(projectRuntimeRoot);
  if (!filePath) {
    return closedProjectRuntimeOpenState("");
  }
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    if (!isPlainObject(parsed) || parsed.open !== true) {
      return closedProjectRuntimeOpenState(filePath);
    }
    return publicProjectRuntimeOpenState({
      ...parsed,
      filePath,
      open: true
    });
  } catch (error) {
    if (isMissingPathError(error) || error instanceof SyntaxError) {
      return closedProjectRuntimeOpenState(filePath);
    }
    throw error;
  }
}

async function writeProjectRuntimeOpenState({
  projectRuntimeRoot = "",
  projectSlug = "",
  reason = "project-open"
} = {}) {
  const filePath = projectRuntimeOpenStatePath(projectRuntimeRoot);
  if (!filePath) {
    throw new Error("writeProjectRuntimeOpenState requires projectRuntimeRoot.");
  }
  const now = new Date().toISOString();
  const state = {
    open: true,
    openedAt: now,
    projectSlug: toText(projectSlug),
    reason: toText(reason) || "project-open",
    updatedAt: now
  };
  // Readers never see a partial file, which they would read as a closed project.
  await writeJsonFileAtomic(filePath, state);
  return publicProjectRuntimeOpenState(state);
}

/**
 * Records activity in an open project runtime: only its updatedAt changes.
 * A closed runtime stays closed.
 */
async function touchProjectRuntimeOpenState({
  projectRuntimeRoot = ""
} = {}) {
  const current = await readProjectRuntimeOpenState({ projectRuntimeRoot });
  if (current.open !== true) {
    return publicProjectRuntimeOpenState(current);
  }
  const state = { ...current, updatedAt: new Date().toISOString() };
  await writeJsonFileAtomic(projectRuntimeOpenStatePath(projectRuntimeRoot), state);
  return state;
}

async function clearProjectRuntimeOpenState({
  projectRuntimeRoot = ""
} = {}) {
  const filePath = projectRuntimeOpenStatePath(projectRuntimeRoot);
  if (filePath) {
    await rm(filePath, {
      force: true
    });
  }
  return publicProjectRuntimeOpenState(closedProjectRuntimeOpenState(filePath));
}

function publicProjectRuntimeOpenState(state) {
  const open = state?.open === true;
  return {
    open,
    ...(open && toText(state.openedAt) ? { openedAt: toText(state.openedAt) } : {}),
    ...(open && toText(state.projectSlug) ? { projectSlug: toText(state.projectSlug) } : {}),
    ...(open && toText(state.reason) ? { reason: toText(state.reason) } : {}),
    ...(open && toText(state.updatedAt) ? { updatedAt: toText(state.updatedAt) } : {})
  };
}

function closedProjectRuntimeOpenState(filePath = "") {
  return {
    filePath,
    open: false
  };
}

const __testables = Object.freeze({ projectRuntimeOpenStatePath });

export {
  clearProjectRuntimeOpenState,
  publicProjectRuntimeOpenState,
  readProjectRuntimeOpenState,
  touchProjectRuntimeOpenState,
  writeProjectRuntimeOpenState,
  __testables
};
