import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  resolveVibe64DataRoot
} from "./studioRoots.js";

const CODEX_AUTH_MARKER_RELATIVE_PATH = Object.freeze(["provider-homes", "codex", "status.json"]);
const CODEX_AUTH_STATE_SIGNATURE_VERSION = 1;

function codexAuthMarkerPath(dataRoot = "") {
  return path.join(dataRoot, ...CODEX_AUTH_MARKER_RELATIVE_PATH);
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
  dataRoot = "",
  env = process.env
} = {}) {
  const resolvedDataRoot = resolveVibe64DataRoot({
    env,
    explicitRoot: dataRoot
  });
  const markerPath = codexAuthMarkerPath(resolvedDataRoot);
  const markerText = await readCodexAuthMarkerText(markerPath);
  const state = markerText
    ? `present\0${resolvedDataRoot}\0${markerText}`
    : `missing\0${resolvedDataRoot}`;
  return `v${CODEX_AUTH_STATE_SIGNATURE_VERSION}:${hashCodexAuthState(state)}`;
}

export {
  CODEX_AUTH_MARKER_RELATIVE_PATH,
  CODEX_AUTH_STATE_SIGNATURE_VERSION,
  codexAuthMarkerPath,
  codexAuthStateSignature
};
