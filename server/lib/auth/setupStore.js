import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const SETUP_STATE_VERSION = 1;

function createFileSetupStore({
  setupPath = ""
} = {}) {
  if (!setupPath) {
    throw new Error("createFileSetupStore requires setupPath.");
  }
  const filePath = path.resolve(setupPath);

  async function readState() {
    try {
      return normalizeSetupState(JSON.parse(await readFile(filePath, "utf8")));
    } catch (error) {
      if (error?.code === "ENOENT") {
        return normalizeSetupState({});
      }
      throw error;
    }
  }

  async function writeState(state = {}) {
    const normalized = normalizeSetupState(state);
    await mkdir(path.dirname(filePath), {
      recursive: true
    });
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
    await rename(tempPath, filePath);
    return normalized;
  }

  async function firstLoginCodexSetupPending() {
    const state = await readState();
    return !state.firstLoginCodexCompletedAt;
  }

  async function markFirstLoginCodexSetupComplete() {
    const state = await readState();
    if (state.firstLoginCodexCompletedAt) {
      return state;
    }
    const now = new Date().toISOString();
    return writeState({
      ...state,
      firstLoginCodexCompletedAt: now,
      updatedAt: now
    });
  }

  return Object.freeze({
    firstLoginCodexSetupPending,
    markFirstLoginCodexSetupComplete,
    readState,
    setupPath: filePath
  });
}

function normalizeSetupState(state = {}) {
  return {
    firstLoginCodexCompletedAt: String(state.firstLoginCodexCompletedAt || ""),
    updatedAt: String(state.updatedAt || state.firstLoginCodexCompletedAt || ""),
    version: SETUP_STATE_VERSION
  };
}

export {
  createFileSetupStore
};
