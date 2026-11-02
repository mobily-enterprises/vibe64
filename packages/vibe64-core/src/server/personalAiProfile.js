import { readFile } from "node:fs/promises";
import path from "node:path";
import { writeJsonFileAtomic } from "./atomicFile.js";

import { isMissingPathError, isPlainObject, vibe64Error } from "./core.js";
import { toText } from "@jskit-ai/kernel/shared/support/normalize";

const PERSONAL_AI_PROFILE_DIRECTORY = "profile";
const PERSONAL_AI_PROFILE_FILE = "personal.json";
const PERSONAL_AI_PROFILE_VERSION = 1;
const MAX_PREFERRED_NAME_LENGTH = 80;

function normalizePreferredName(value = "") {
  const preferredName = String(value || "")
    .normalize("NFC")
    .replace(/\s+/gu, " ")
    .trim();
  // 422 is the status Online's account routes answer these with; the Accounts envelope answers by code.
  if (/\p{Cc}/u.test(preferredName)) {
    throw vibe64Error("Preferred name cannot contain control characters.", "vibe64_preferred_name_invalid", { status: 422 });
  }
  if ([...preferredName].length > MAX_PREFERRED_NAME_LENGTH) {
    throw vibe64Error(`Preferred name cannot exceed ${MAX_PREFERRED_NAME_LENGTH} characters.`, "vibe64_preferred_name_too_long", {
      status: 422,
      params: { limit: MAX_PREFERRED_NAME_LENGTH }
    });
  }
  return preferredName;
}

function personalAiProfilePath(systemRoot = "") {
  const root = toText(systemRoot);
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
          "vibe64_personal_ai_profile_unreadable"
        );
      }
      throw error;
    }
  }

  async function write(profile = {}) {
    const normalized = normalizePersonalAiProfile(profile);
    // The earlier write's failure reached its own caller; this write only waits for it.
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
  createPersonalAiProfileStore,
  normalizePreferredName
};
