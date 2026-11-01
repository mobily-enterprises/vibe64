import { constants as fsConstants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import path from "node:path";

import { isMissingPathError, pathInsideOrEqual } from "@local/vibe64-core/server/core";
import { GENESIS_BLUEPRINT_PATH, GENESIS_SUBSYSTEMS_PATH } from "@local/vibe64-genesis/server";

import { openedFileWithin } from "./openedFileWithin.js";
import {
  PROMPT_HINT_BLUEPRINT_MAX_CHARACTERS,
  PROMPT_HINT_SUBSYSTEMS_MAX_CHARACTERS,
  boundedText
} from "./promptHintRules.js";
import { toText } from "@local/vibe64-core/shared/toText";

function promptHintBlueprintError(message) {
  const error = new Error(message);
  error.code = "vibe64_prompt_hint_blueprint_unsafe";
  return error;
}

async function readPromptHintBlueprint(sourceRoot = "") {
  return readPromptHintGenesisFile(sourceRoot, GENESIS_BLUEPRINT_PATH, PROMPT_HINT_BLUEPRINT_MAX_CHARACTERS);
}

async function readPromptHintSubsystems(sourceRoot = "") {
  return readPromptHintGenesisFile(sourceRoot, GENESIS_SUBSYSTEMS_PATH, PROMPT_HINT_SUBSYSTEMS_MAX_CHARACTERS);
}

/**
 * Reads one bounded Genesis document from the session source without following
 * links out of it. Blueprint safety errors also cover the subsystems map.
 */
async function readPromptHintGenesisFile(sourceRoot = "", relativePath = "", maxCharacters = 0) {
  const normalizedSourceRoot = toText(sourceRoot);
  if (!normalizedSourceRoot) {
    return "";
  }
  const resolvedSourceRoot = path.resolve(normalizedSourceRoot);
  const blueprintPath = path.resolve(resolvedSourceRoot, relativePath);
  if (!pathInsideOrEqual(resolvedSourceRoot, blueprintPath)) {
    throw promptHintBlueprintError("Prompt hint Blueprint path escapes the session source.");
  }

  let canonicalSourceRoot = "";
  try {
    canonicalSourceRoot = await realpath(resolvedSourceRoot);
  } catch (error) {
    if (isMissingPathError(error)) {
      return "";
    }
    throw error;
  }

  let handle = null;
  try {
    try {
      handle = await open(
        blueprintPath,
        fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK
      );
    } catch (error) {
      if (isMissingPathError(error)) {
        return "";
      }
      if (error?.code === "ELOOP") {
        throw promptHintBlueprintError("Prompt hint Blueprint must not be a symbolic link.");
      }
      throw error;
    }

    const fileStat = await handle.stat();
    if (!fileStat.isFile()) {
      throw promptHintBlueprintError("Prompt hint Blueprint must be a regular file.");
    }
    if (!await openedFileWithin(handle, blueprintPath, (openedPath) => pathInsideOrEqual(canonicalSourceRoot, openedPath))) {
      throw promptHintBlueprintError("Prompt hint Blueprint escapes the session source.");
    }
    const buffer = Buffer.alloc(16_384);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return boundedText(buffer.subarray(0, bytesRead).toString("utf8"), maxCharacters);
  } finally {
    await handle?.close();
  }
}

export {
  readPromptHintBlueprint,
  readPromptHintSubsystems
};
