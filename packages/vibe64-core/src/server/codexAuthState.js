import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  resolveVibe64ProviderHomesRoot
} from "./studioRoots.js";
import {
  CODEX_RECONNECT_REQUIRED_CODE,
  CODEX_RECONNECT_REQUIRED_MESSAGE
} from "../shared/codexAuth.js";

const CODEX_AUTH_MARKER_RELATIVE_PATH = Object.freeze(["provider-homes", "codex", "status.json"]);
const CODEX_AUTH_PROVIDER_MARKER_RELATIVE_PATH = Object.freeze(["codex", "status.json"]);
const CODEX_AUTH_STATUS_RELATIVE_PATH = Object.freeze(["provider-homes", "codex", ".vibe64", "auth-status.json"]);
const CODEX_AUTH_PROVIDER_STATUS_RELATIVE_PATH = Object.freeze(["codex", ".vibe64", "auth-status.json"]);
const CODEX_AUTH_STATE_SIGNATURE_VERSION = 1;
const CODEX_AUTH_INVALIDATED_PATTERN =
  /\b(?:token_invalidated|refresh_token_invalidated)\b|authentication token has been invalidated|HTTP error:\s*401 Unauthorized|401 Unauthorized/iu;

function codexProviderFilePath(systemRoot = "", {
  providerHomesRoot = "",
  providerRelativePath = []
} = {}) {
  const markerRoot = String(providerHomesRoot || "").trim()
    ? path.resolve(String(providerHomesRoot || ""))
    : path.join(systemRoot, "provider-homes");
  return path.join(markerRoot, ...providerRelativePath);
}

function codexAuthMarkerPath(systemRoot = "", {
  providerHomesRoot = ""
} = {}) {
  return codexProviderFilePath(systemRoot, {
    providerHomesRoot,
    providerRelativePath: CODEX_AUTH_PROVIDER_MARKER_RELATIVE_PATH
  });
}

function codexAuthStatusPath(systemRoot = "", {
  providerHomesRoot = ""
} = {}) {
  return codexProviderFilePath(systemRoot, {
    providerHomesRoot,
    providerRelativePath: CODEX_AUTH_PROVIDER_STATUS_RELATIVE_PATH
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

async function readCodexAuthStatus(systemRoot = "", {
  providerHomesRoot = ""
} = {}) {
  const statusPath = codexAuthStatusPath(systemRoot, {
    providerHomesRoot
  });
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

async function clearCodexAuthStatus(systemRoot = "", {
  providerHomesRoot = ""
} = {}) {
  await rm(codexAuthStatusPath(systemRoot, {
    providerHomesRoot
  }), {
    force: true
  });
}

async function markCodexReconnectRequired(systemRoot = "", {
  providerHomesRoot = "",
  reason = "codex-command"
} = {}) {
  const statusPath = codexAuthStatusPath(systemRoot, {
    providerHomesRoot
  });
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
  env = process.env,
  providerHomesRoot = "",
  projectsRoot = "",
  runtimeProfile = null,
  systemRoot = ""
} = {}) {
  const resolvedProviderHomesRoot = resolveVibe64ProviderHomesRoot({
    env,
    explicitRoot: providerHomesRoot,
    projectsRoot,
    runtimeProfile,
    systemRoot
  });
  const markerPath = codexAuthMarkerPath("", {
    providerHomesRoot: resolvedProviderHomesRoot
  });
  const authStatusPath = codexAuthStatusPath("", {
    providerHomesRoot: resolvedProviderHomesRoot
  });
  const markerText = await readCodexAuthMarkerText(markerPath);
  const authStatusText = await readCodexAuthMarkerText(authStatusPath);
  const state = markerText
    ? `present\0${resolvedProviderHomesRoot}\0${markerText}\0${authStatusText}`
    : `missing\0${resolvedProviderHomesRoot}\0${authStatusText}`;
  return `v${CODEX_AUTH_STATE_SIGNATURE_VERSION}:${hashCodexAuthState(state)}`;
}

export {
  CODEX_AUTH_MARKER_RELATIVE_PATH,
  CODEX_AUTH_PROVIDER_MARKER_RELATIVE_PATH,
  CODEX_AUTH_PROVIDER_STATUS_RELATIVE_PATH,
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
