import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  isMissingPathError,
  isPlainObject,
  normalizeText
} from "./core.js";

const PROJECT_RUNTIME_STATE_DIR = "runtime";
const PROJECT_RUNTIME_OPEN_STATE_FILE = "open.json";

function projectRuntimeOpenStatePath(projectLocalRoot = "") {
  const root = normalizeText(projectLocalRoot);
  return root ? path.join(path.resolve(root), PROJECT_RUNTIME_STATE_DIR, PROJECT_RUNTIME_OPEN_STATE_FILE) : "";
}

async function readProjectRuntimeOpenState({
  projectLocalRoot = ""
} = {}) {
  const filePath = projectRuntimeOpenStatePath(projectLocalRoot);
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
  projectLocalRoot = "",
  projectSlug = "",
  reason = "project-open",
  targetRoot = ""
} = {}) {
  const filePath = projectRuntimeOpenStatePath(projectLocalRoot);
  if (!filePath) {
    throw new Error("writeProjectRuntimeOpenState requires projectLocalRoot.");
  }
  const now = new Date().toISOString();
  const state = {
    open: true,
    openedAt: now,
    projectSlug: normalizeText(projectSlug),
    reason: normalizeText(reason) || "project-open",
    targetRoot: normalizeText(targetRoot),
    updatedAt: now
  };
  await mkdir(path.dirname(filePath), {
    recursive: true
  });
  await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  return publicProjectRuntimeOpenState({
    ...state,
    filePath
  });
}

async function clearProjectRuntimeOpenState({
  projectLocalRoot = ""
} = {}) {
  const filePath = projectRuntimeOpenStatePath(projectLocalRoot);
  if (filePath) {
    await rm(filePath, {
      force: true
    });
  }
  return publicProjectRuntimeOpenState(closedProjectRuntimeOpenState(filePath));
}

function publicProjectRuntimeOpenState(state = {}) {
  const open = state?.open === true;
  return {
    open,
    ...(open && normalizeText(state.openedAt) ? { openedAt: normalizeText(state.openedAt) } : {}),
    ...(open && normalizeText(state.projectSlug) ? { projectSlug: normalizeText(state.projectSlug) } : {}),
    ...(open && normalizeText(state.reason) ? { reason: normalizeText(state.reason) } : {}),
    ...(open && normalizeText(state.targetRoot) ? { targetRoot: normalizeText(state.targetRoot) } : {}),
    ...(open && normalizeText(state.updatedAt) ? { updatedAt: normalizeText(state.updatedAt) } : {})
  };
}

function closedProjectRuntimeOpenState(filePath = "") {
  return {
    filePath,
    open: false
  };
}

export {
  PROJECT_RUNTIME_OPEN_STATE_FILE,
  PROJECT_RUNTIME_STATE_DIR,
  clearProjectRuntimeOpenState,
  projectRuntimeOpenStatePath,
  publicProjectRuntimeOpenState,
  readProjectRuntimeOpenState,
  writeProjectRuntimeOpenState
};
