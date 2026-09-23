import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  CODEX_RECONNECT_REQUIRED_CODE,
  CODEX_RECONNECT_REQUIRED_MESSAGE
} from "../shared/codexAuth.js";

const CODEX_AUTH_MARKER_RELATIVE_PATH = Object.freeze(["auth", "codex", "status.json"]);
const CODEX_AUTH_STATUS_RELATIVE_PATH = Object.freeze(["auth", "codex", "auth-status.json"]);
const CODEX_AUTH_STATE_SIGNATURE_VERSION = 1;
const CODEX_AUTH_RECONNECTING_CODE = "vibe64_codex_reconnecting";
const CODEX_AUTH_RECONNECTING_MESSAGE = "Codex is reconnecting with the current account.";
const CODEX_AUTH_INVALIDATED_PATTERN =
  /\b(?:token_invalidated|refresh_token_invalidated)\b|authentication token has been invalidated|HTTP error:\s*401 Unauthorized|401 Unauthorized/iu;

function requireCodexAuthSystemRoot(systemRoot = "") {
  const normalizedRoot = String(systemRoot || "").trim();
  if (!normalizedRoot || !path.isAbsolute(normalizedRoot)) {
    throw new Error("A Vibe64 system root is required for Codex auth state.");
  }
  return path.resolve(normalizedRoot);
}

function codexAuthFilePath(systemRoot = "", {
  relativePath = []
} = {}) {
  return path.join(requireCodexAuthSystemRoot(systemRoot), ...relativePath);
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

async function readCodexLoginId(systemRoot = "") {
  const text = await readCodexAuthMarkerText(codexAuthMarkerPath(systemRoot));
  let marker;
  try {
    marker = JSON.parse(text);
  } catch {
    return "";
  }
  return marker?.connected === true && typeof marker.loginId === "string" &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(marker.loginId)
    ? marker.loginId
    : "";
}

async function clearCodexAuthStatus(systemRoot = "") {
  await rm(codexAuthStatusPath(systemRoot), {
    force: true
  });
}

async function writeCodexAuthRecord(statusPath, status) {
  const tempPath = `${statusPath}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(path.dirname(statusPath), {
    mode: 0o700,
    recursive: true
  });
  await writeFile(tempPath, `${JSON.stringify(status, null, 2)}\n`, {
    mode: 0o600
  });
  await chmod(tempPath, 0o600).catch(() => null);
  await rename(tempPath, statusPath);
  await chmod(statusPath, 0o600).catch(() => null);
  return status;
}

async function writeCodexAuthStatus(systemRoot = "", status = {}) {
  return writeCodexAuthRecord(codexAuthStatusPath(systemRoot), status);
}

async function writeCodexAuthMarker(systemRoot = "", marker = {}) {
  return writeCodexAuthRecord(codexAuthMarkerPath(systemRoot), marker);
}

async function markCodexAuthReconnecting(systemRoot = "", {
  reason = "codex-auth-change"
} = {}) {
  const status = {
    code: CODEX_AUTH_RECONNECTING_CODE,
    generation: randomUUID(),
    message: CODEX_AUTH_RECONNECTING_MESSAGE,
    reason: String(reason || "codex-auth-change"),
    status: "reconnecting",
    updatedAt: new Date().toISOString(),
    version: 1
  };
  await writeCodexAuthStatus(systemRoot, status);
  return status;
}

async function markCodexReconnectRequired(systemRoot = "", {
  reason = "codex-command"
} = {}) {
  return writeCodexAuthStatus(systemRoot, {
    code: CODEX_RECONNECT_REQUIRED_CODE,
    message: CODEX_RECONNECT_REQUIRED_MESSAGE,
    reason: String(reason || "codex-command"),
    status: "reconnect_required",
    updatedAt: new Date().toISOString(),
    version: 1
  });
}

function codexAuthOutputRequiresReconnect(output = "") {
  return CODEX_AUTH_INVALIDATED_PATTERN.test(String(output || ""));
}

async function codexAuthStateSignature({
  systemRoot = ""
} = {}) {
  const markerPath = codexAuthMarkerPath(systemRoot);
  const authStatusPath = codexAuthStatusPath(systemRoot);
  const resolvedSystemRoot = requireCodexAuthSystemRoot(systemRoot);
  const markerText = await readCodexAuthMarkerText(markerPath);
  const authStatusText = await readCodexAuthMarkerText(authStatusPath);
  const state = markerText
    ? `present\0${resolvedSystemRoot}\0${markerText}\0${authStatusText}`
    : `missing\0${resolvedSystemRoot}\0${authStatusText}`;
  return `v${CODEX_AUTH_STATE_SIGNATURE_VERSION}:${hashCodexAuthState(state)}`;
}

export {
  CODEX_AUTH_MARKER_RELATIVE_PATH,
  CODEX_AUTH_RECONNECTING_CODE,
  CODEX_AUTH_RECONNECTING_MESSAGE,
  CODEX_AUTH_STATUS_RELATIVE_PATH,
  CODEX_AUTH_STATE_SIGNATURE_VERSION,
  CODEX_RECONNECT_REQUIRED_CODE,
  CODEX_RECONNECT_REQUIRED_MESSAGE,
  clearCodexAuthStatus,
  codexAuthOutputRequiresReconnect,
  codexAuthMarkerPath,
  codexAuthStateSignature,
  codexAuthStatusPath,
  markCodexAuthReconnecting,
  markCodexReconnectRequired,
  requireCodexAuthSystemRoot,
  readCodexAuthStatus,
  readCodexLoginId,
  writeCodexAuthMarker
};
