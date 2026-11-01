import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { isMissingPathError, isPlainObject } from "./core.js";
import { toText } from "../shared/toText.js";

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
  PROJECT_RUNTIME_OPEN_STATE_FILE,
  PROJECT_RUNTIME_STATE_DIR,
  clearProjectRuntimeOpenState,
  publicProjectRuntimeOpenState,
  readProjectRuntimeOpenState,
  writeProjectRuntimeOpenState,
  __testables
};
