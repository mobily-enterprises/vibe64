import { readFile } from "node:fs/promises";
import path from "node:path";

import { isMissingPathError, isPlainObject, vibe64Error } from "@local/vibe64-core/server/core";
import {
  normalizePreviewApplicationIdentities
} from "@local/vibe64-core/server/previewAuth";
import { inspectPreviewApplicationIdentities } from "@local/vibe64-core/shared/previewIdentity";
import { writeJsonFileAtomic } from "@local/vibe64-core/server/atomicFile";
import { vibe64SharedModes } from "@local/vibe64-execution/server/hostProfile";
import { toText } from "@jskit-ai/kernel/shared/support/normalize";

const PREVIEW_APPLICATION_IDENTITIES_DIR = ".vibe64";
const PREVIEW_APPLICATION_IDENTITIES_FILE = "preview-identities.json";
const PREVIEW_APPLICATION_IDENTITIES_VERSION = 1;
const PREVIEW_APPLICATION_IDENTITIES_RELATIVE_PATH = `${PREVIEW_APPLICATION_IDENTITIES_DIR}/${PREVIEW_APPLICATION_IDENTITIES_FILE}`;

function resolvePreviewIdentitySourceRoot(sourceRoot = "") {
  const root = toText(sourceRoot);
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

/**
 * The list a save stores, or the refusal of its first invalid entry.
 * @param {unknown} identities
 */
function storedPreviewApplicationIdentities(identities) {
  if (!Array.isArray(identities)) {
    throw vibe64Error(
      "Managed app identity state is invalid.",
      "vibe64_invalid_preview_application_identity_state"
    );
  }
  return {
    identities: normalizePreviewApplicationIdentities(identities),
    version: PREVIEW_APPLICATION_IDENTITIES_VERSION
  };
}

function unreadableFile(fileProblem) {
  return { fileProblem, identities: [], invalidIdentities: [] };
}

/**
 * What the stored file holds, read without refusing any of it: the valid
 * identities in order, each invalid entry with its position and the reason in
 * plain words, and fileProblem when the file is not an identity list at all.
 * App access shows every entry and Preview uses the valid ones, so a wrong
 * file never makes either unusable; only a write refuses an invalid entry.
 * @param {unknown} state the parsed file
 */
function inspectStoredPreviewApplicationIdentities(state) {
  if (!isPlainObject(state)) {
    return unreadableFile(`${PREVIEW_APPLICATION_IDENTITIES_RELATIVE_PATH} is not an identity list.`);
  }
  if (state.version !== PREVIEW_APPLICATION_IDENTITIES_VERSION) {
    const version = JSON.stringify(state.version);
    return unreadableFile(version === undefined
      ? `${PREVIEW_APPLICATION_IDENTITIES_RELATIVE_PATH} has no version; this Vibe64 reads version ${PREVIEW_APPLICATION_IDENTITIES_VERSION}.`
      : `${PREVIEW_APPLICATION_IDENTITIES_RELATIVE_PATH} has version ${version.slice(0, 40)}; this Vibe64 reads version ${PREVIEW_APPLICATION_IDENTITIES_VERSION}.`);
  }
  if (!Array.isArray(state.identities)) {
    return unreadableFile(`${PREVIEW_APPLICATION_IDENTITIES_RELATIVE_PATH} has no "identities" list.`);
  }
  const rows = inspectPreviewApplicationIdentities(state.identities);
  return {
    fileProblem: "",
    identities: rows.filter((row) => !row.problem).map(({ name, type, value }) => ({ name, type, value })),
    invalidIdentities: rows.filter((row) => row.problem).map(({ name, position, problem, type, value }) => ({
      code: problem.code,
      name,
      position,
      reason: problem.reason,
      type,
      value
    }))
  };
}

async function readStoredPreviewApplicationIdentities(filePath = "") {
  let text;
  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    if (isMissingPathError(error)) {
      return null;
    }
    throw error;
  }
  let state;
  try {
    state = JSON.parse(text);
  } catch (error) {
    return unreadableFile(
      `${PREVIEW_APPLICATION_IDENTITIES_RELATIVE_PATH} is not valid JSON (${String(error?.message || error).slice(0, 200)}).`
    );
  }
  return inspectStoredPreviewApplicationIdentities(state);
}

/**
 * The source's managed app identities: the valid ones, the invalid entries
 * and the file's own problem, as inspectStoredPreviewApplicationIdentities
 * reads them; none when the file does not exist.
 * @param {{ sourceRoot: string }} input
 */
async function readPreviewApplicationIdentities({
  sourceRoot = ""
} = {}) {
  const filePath = previewApplicationIdentitiesPath(sourceRoot);
  const state = await readStoredPreviewApplicationIdentities(filePath);
  return {
    filePath,
    fileProblem: state?.fileProblem || "",
    identities: state?.identities || [],
    invalidIdentities: state?.invalidIdentities || []
  };
}

async function savePreviewApplicationIdentities({
  identities = [],
  sourceRoot = ""
} = {}) {
  const filePath = previewApplicationIdentitiesPath(sourceRoot);
  const state = storedPreviewApplicationIdentities(identities);
  const modes = vibe64SharedModes();
  await writeJsonFileAtomic(filePath, state, { directoryMode: modes.inheritingDirectory, fileMode: modes.file });
  return {
    filePath,
    identities: state.identities
  };
}

export {
  readPreviewApplicationIdentities,
  savePreviewApplicationIdentities
};
