import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  resolveVibe64ProviderHomesRoot
} from "./studioRoots.js";

const CODEX_AUTH_MARKER_RELATIVE_PATH = Object.freeze(["provider-homes", "codex", "status.json"]);
const CODEX_AUTH_PROVIDER_MARKER_RELATIVE_PATH = Object.freeze(["codex", "status.json"]);
const CODEX_AUTH_STATE_SIGNATURE_VERSION = 1;

function codexAuthMarkerPath(systemRoot = "", {
  providerHomesRoot = ""
} = {}) {
  const markerRoot = String(providerHomesRoot || "").trim()
    ? path.resolve(String(providerHomesRoot || ""))
    : path.join(systemRoot, "provider-homes");
  return path.join(markerRoot, ...CODEX_AUTH_PROVIDER_MARKER_RELATIVE_PATH);
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

async function codexAuthStateSignature({
  env = process.env,
  projectsRoot = "",
  runtimeProfile = null,
  systemRoot = ""
} = {}) {
  const resolvedProviderHomesRoot = resolveVibe64ProviderHomesRoot({
    env,
    projectsRoot,
    runtimeProfile,
    systemRoot
  });
  const markerPath = codexAuthMarkerPath("", {
    providerHomesRoot: resolvedProviderHomesRoot
  });
  const markerText = await readCodexAuthMarkerText(markerPath);
  const state = markerText
    ? `present\0${resolvedProviderHomesRoot}\0${markerText}`
    : `missing\0${resolvedProviderHomesRoot}`;
  return `v${CODEX_AUTH_STATE_SIGNATURE_VERSION}:${hashCodexAuthState(state)}`;
}

export {
  CODEX_AUTH_MARKER_RELATIVE_PATH,
  CODEX_AUTH_PROVIDER_MARKER_RELATIVE_PATH,
  CODEX_AUTH_STATE_SIGNATURE_VERSION,
  codexAuthMarkerPath,
  codexAuthStateSignature
};
