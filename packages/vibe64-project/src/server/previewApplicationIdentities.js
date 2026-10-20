import crypto from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  isMissingPathError,
  isPlainObject,
  normalizeText,
  vibe64Error
} from "@local/vibe64-core/server/core";
import {
  normalizePreviewApplicationIdentities
} from "@local/vibe64-core/server/previewAuth";
import { vibe64SharedModes } from "@local/vibe64-execution/server/hostProfile";

const PREVIEW_APPLICATION_IDENTITIES_DIR = ".vibe64";
const PREVIEW_APPLICATION_IDENTITIES_FILE = "preview-identities.json";
const PREVIEW_APPLICATION_IDENTITIES_VERSION = 1;

function resolvePreviewIdentitySourceRoot(sourceRoot = "") {
  const root = normalizeText(sourceRoot);
  if (!root) {
    throw vibe64Error(
      "Managed app identities require an available project source.",
      "vibe64_preview_application_identities_root_required"
    );
  }
  return path.resolve(root);
}

function previewApplicationIdentitiesPath(sourceRoot = "") {
  return path.join(
    resolvePreviewIdentitySourceRoot(sourceRoot),
    PREVIEW_APPLICATION_IDENTITIES_DIR,
    PREVIEW_APPLICATION_IDENTITIES_FILE
  );
}

function normalizeStoredPreviewApplicationIdentities(state = {}) {
  if (
    !isPlainObject(state) ||
    state.version !== PREVIEW_APPLICATION_IDENTITIES_VERSION ||
    !Array.isArray(state.identities)
  ) {
    throw vibe64Error(
      "Managed app identity state is invalid.",
      "vibe64_invalid_preview_application_identity_state"
    );
  }
  return {
    identities: normalizePreviewApplicationIdentities(state.identities),
    version: PREVIEW_APPLICATION_IDENTITIES_VERSION
  };
}

async function readStoredPreviewApplicationIdentities(filePath = "") {
  try {
    return normalizeStoredPreviewApplicationIdentities(
      JSON.parse(await readFile(filePath, "utf8"))
    );
  } catch (error) {
    if (isMissingPathError(error)) {
      return null;
    }
    if (error instanceof SyntaxError) {
      throw vibe64Error(
        "Managed app identity state is invalid.",
        "vibe64_invalid_preview_application_identity_state"
      );
    }
    throw error;
  }
}

async function readPreviewApplicationIdentities({
  sourceRoot = ""
} = {}) {
  const filePath = previewApplicationIdentitiesPath(sourceRoot);
  const state = await readStoredPreviewApplicationIdentities(filePath);
  return {
    filePath,
    identities: state?.identities || []
  };
}

async function savePreviewApplicationIdentities({
  identities = [],
  sourceRoot = ""
} = {}) {
  const filePath = previewApplicationIdentitiesPath(sourceRoot);
  const state = normalizeStoredPreviewApplicationIdentities({
    identities,
    version: PREVIEW_APPLICATION_IDENTITIES_VERSION
  });
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await mkdir(path.dirname(filePath), {
    mode: vibe64SharedModes().inheritingDirectory,
    recursive: true
  });
  try {
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
      mode: vibe64SharedModes().file
    });
    await rename(temporaryPath, filePath);
    await chmod(filePath, vibe64SharedModes().file);
  } finally {
    await rm(temporaryPath, {
      force: true
    });
  }
  return {
    filePath,
    identities: state.identities
  };
}

export {
  readPreviewApplicationIdentities,
  savePreviewApplicationIdentities
};
