import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  CODEX_RECONNECT_REQUIRED_CODE,
  CODEX_RECONNECT_REQUIRED_MESSAGE
} from "../shared/codexAuth.js";

const CODEX_AUTH_MARKER_RELATIVE_PATH = Object.freeze(["auth", "codex", "status.json"]);
const CODEX_AUTH_STATUS_RELATIVE_PATH = Object.freeze(["auth", "codex", "auth-status.json"]);
const CODEX_AUTH_STATE_SIGNATURE_VERSION = 1;
const CODEX_AUTH_INVALIDATED_PATTERN =
  /\b(?:token_invalidated|refresh_token_invalidated)\b|authentication token has been invalidated|HTTP error:\s*401 Unauthorized|401 Unauthorized/iu;

function codexAuthFilePath(systemRoot = "", {
  relativePath = []
} = {}) {
  return path.join(path.resolve(systemRoot || process.cwd()), ...relativePath);
}

function codexAuthMarkerPath(systemRoot = "") {
  return codexAuthFilePath(systemRoot, {
    relativePath: CODEX_AUTH_MARKER_RELATIVE_PATH
  });
}

function codexAuthStatusPath(systemRoot = "") {
  return codexAuthFilePath(systemRoot, {
    relativePath: CODEX_AUTH_STATUS_RELATIVE_PATH
  });
}

function hashCodexAuthState(value = "") {
  return createHash("sha256").update(String(value || "")).digest("hex").slice(0, 24);
}

async function readCodexAuthMarkerText(markerPath = "") {
  try {
    return await readFile(markerPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

async function readCodexAuthStatus(systemRoot = "") {
  const statusPath = codexAuthStatusPath(systemRoot);
  const text = await readCodexAuthMarkerText(statusPath);
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function clearCodexAuthStatus(systemRoot = "") {
  await rm(codexAuthStatusPath(systemRoot), {
    force: true
  });
}

async function markCodexReconnectRequired(systemRoot = "", {
  reason = "codex-command"
} = {}) {
  const statusPath = codexAuthStatusPath(systemRoot);
  await mkdir(path.dirname(statusPath), {
    mode: 0o700,
    recursive: true
  });
  await writeFile(statusPath, `${JSON.stringify({
    code: CODEX_RECONNECT_REQUIRED_CODE,
    message: CODEX_RECONNECT_REQUIRED_MESSAGE,
    reason: String(reason || "codex-command"),
    status: "reconnect_required",
    updatedAt: new Date().toISOString(),
    version: 1
  }, null, 2)}\n`, {
    mode: 0o600
  });
  return {
    code: CODEX_RECONNECT_REQUIRED_CODE,
    message: CODEX_RECONNECT_REQUIRED_MESSAGE,
    status: "reconnect_required"
  };
}

function codexAuthOutputRequiresReconnect(output = "") {
  return CODEX_AUTH_INVALIDATED_PATTERN.test(String(output || ""));
}

async function codexAuthStateSignature({
  systemRoot = ""
} = {}) {
  const markerPath = codexAuthMarkerPath(systemRoot);
  const authStatusPath = codexAuthStatusPath(systemRoot);
  const markerText = await readCodexAuthMarkerText(markerPath);
  const authStatusText = await readCodexAuthMarkerText(authStatusPath);
  const state = markerText
    ? `present\0${path.resolve(systemRoot || process.cwd())}\0${markerText}\0${authStatusText}`
    : `missing\0${path.resolve(systemRoot || process.cwd())}\0${authStatusText}`;
  return `v${CODEX_AUTH_STATE_SIGNATURE_VERSION}:${hashCodexAuthState(state)}`;
}

export {
  CODEX_AUTH_MARKER_RELATIVE_PATH,
  CODEX_AUTH_STATUS_RELATIVE_PATH,
  CODEX_AUTH_STATE_SIGNATURE_VERSION,
  CODEX_RECONNECT_REQUIRED_CODE,
  CODEX_RECONNECT_REQUIRED_MESSAGE,
  clearCodexAuthStatus,
  codexAuthOutputRequiresReconnect,
  codexAuthMarkerPath,
  codexAuthStateSignature,
  codexAuthStatusPath,
  markCodexReconnectRequired,
  readCodexAuthStatus
};
