import { readFile } from "node:fs/promises";
import path from "node:path";
import { writeJsonFileAtomic } from "./atomicFile.js";

import {
  isMissingPathError,
  isPlainObject,
  normalizeText,
  vibe64Error
} from "./core.js";

const PERSONAL_AI_PROFILE_DIRECTORY = "profile";
const PERSONAL_AI_PROFILE_FILE = "personal.json";
const PERSONAL_AI_PROFILE_VERSION = 1;
const MAX_PREFERRED_NAME_LENGTH = 80;

function normalizePreferredName(value = "") {
  const preferredName = String(value || "")
    .normalize("NFC")
    .replace(/\s+/gu, " ")
    .trim();
  if (/\p{Cc}/u.test(preferredName)) {
    const error = new Error("Preferred name cannot contain control characters.");
    error.code = "vibe64_preferred_name_invalid";
    throw error;
  }
  if ([...preferredName].length > MAX_PREFERRED_NAME_LENGTH) {
    const error = new Error(`Preferred name cannot exceed ${MAX_PREFERRED_NAME_LENGTH} characters.`);
    error.code = "vibe64_preferred_name_too_long";
    throw error;
  }
  return preferredName;
}

function personalAiProfilePath(systemRoot = "") {
  const root = normalizeText(systemRoot);
  if (!root) {
    throw vibe64Error(
      "Personal AI profile requires the Vibe64 system root.",
      "vibe64_personal_ai_profile_root_required"
    );
  }
  return path.join(path.resolve(root), PERSONAL_AI_PROFILE_DIRECTORY, PERSONAL_AI_PROFILE_FILE);
}

function emptyPersonalAiProfile() {
  return {
    preferredName: "",
    version: PERSONAL_AI_PROFILE_VERSION
  };
}

function normalizePersonalAiProfile(value = {}) {
  if (!isPlainObject(value)) {
    throw vibe64Error(
      "Personal AI profile must be an object.",
      "vibe64_personal_ai_profile_invalid"
    );
  }
  if (value.version !== undefined && value.version !== PERSONAL_AI_PROFILE_VERSION) {
    throw vibe64Error(
      `Personal AI profile version ${String(value.version)} is not supported.`,
      "vibe64_personal_ai_profile_version_unsupported"
    );
  }
  return {
    preferredName: normalizePreferredName(value.preferredName),
    version: PERSONAL_AI_PROFILE_VERSION
  };
}

function createPersonalAiProfileStore({
  systemRoot = ""
} = {}) {
  const filePath = personalAiProfilePath(systemRoot);
  let pendingWrite = Promise.resolve();

  async function read() {
    try {
      return normalizePersonalAiProfile(JSON.parse(await readFile(filePath, "utf8")));
    } catch (error) {
      if (isMissingPathError(error)) {
        return emptyPersonalAiProfile();
      }
      if (error instanceof SyntaxError) {
        throw vibe64Error(
          "Stored personal AI profile is not valid JSON.",
          "vibe64_personal_ai_profile_invalid"
        );
      }
      throw error;
    }
  }

  async function write(profile = {}) {
    const normalized = normalizePersonalAiProfile(profile);
    const operation = pendingWrite.catch(() => {}).then(async () => {
      await writeJsonFileAtomic(filePath, normalized, { directoryMode: 0o700, fileMode: 0o600 });
      return normalized;
    });
    pendingWrite = operation;
    return operation;
  }

  return Object.freeze({
    filePath,
    read,
    write
  });
}

export {
  MAX_PREFERRED_NAME_LENGTH,
  PERSONAL_AI_PROFILE_FILE,
  PERSONAL_AI_PROFILE_VERSION,
  createPersonalAiProfileStore,
  emptyPersonalAiProfile,
  normalizePersonalAiProfile,
  normalizePreferredName,
  personalAiProfilePath
};
