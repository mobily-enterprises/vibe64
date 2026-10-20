import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";

import {
  isMissingPathError,
  isPlainObject,
  vibe64Error
} from "./core.js";
import {
  resolveProjectRuntimeRoot
} from "./projectState.js";
import { vibe64SharedModes } from "@local/vibe64-execution/server/hostProfile";

const PROJECT_PROMPT_HINTS_FILE = "prompt-hints.json";

function projectPromptHintsError(message = "Project prompt-hint settings are invalid.") {
  return vibe64Error(message, "vibe64_project_prompt_hints_invalid");
}

function normalizeProjectPromptHints(value = {}) {
  if (
    !isPlainObject(value) ||
    Object.keys(value).some((field) => field !== "promptHints") ||
    typeof value.promptHints !== "boolean"
  ) {
    throw projectPromptHintsError();
  }
  return { promptHints: value.promptHints };
}

function projectPromptHintsPath(projectRuntimeRoot = "") {
  return path.join(
    resolveProjectRuntimeRoot({ projectRuntimeRoot }),
    "settings",
    PROJECT_PROMPT_HINTS_FILE
  );
}

async function readProjectPromptHints({ projectRuntimeRoot = "" } = {}) {
  const filePath = projectPromptHintsPath(projectRuntimeRoot);
  try {
    return {
      filePath,
      settings: normalizeProjectPromptHints(JSON.parse(await readFile(filePath, "utf8")))
    };
  } catch (error) {
    if (isMissingPathError(error)) {
      return {
        filePath,
        settings: { promptHints: true }
      };
    }
    if (error instanceof SyntaxError) {
      throw projectPromptHintsError("Stored project prompt-hint settings are not valid JSON.");
    }
    throw error;
  }
}

async function saveProjectPromptHints({
  projectRuntimeRoot = "",
  settings = {}
} = {}) {
  const filePath = projectPromptHintsPath(projectRuntimeRoot);
  const normalized = normalizeProjectPromptHints(settings);
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`
  );
  try {
    await writeFile(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: vibe64SharedModes().file
    });
    await rename(temporaryPath, filePath);
    await chmod(filePath, vibe64SharedModes().file);
  } finally {
    await rm(temporaryPath, { force: true });
  }
  return { filePath, settings: normalized };
}

export {
  PROJECT_PROMPT_HINTS_FILE,
  normalizeProjectPromptHints,
  projectPromptHintsPath,
  readProjectPromptHints,
  saveProjectPromptHints
};
