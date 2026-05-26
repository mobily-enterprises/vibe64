import { access, readFile } from "node:fs/promises";
import path from "node:path";

import {
  shellQuote
} from "@local/studio-terminal-core/server/shellCommands";
import {
  aiStudioError,
  isPlainObject,
  normalizeText
} from "@local/ai-studio-core/server/core";

async function fileExists(filePath = "") {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readComposerJson(root = "") {
  const composerJsonPath = path.join(root, "composer.json");
  let text = "";
  try {
    text = await readFile(composerJsonPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }

  try {
    return JSON.parse(text);
  } catch {
    throw aiStudioError(`Invalid JSON in Laravel composer file: ${composerJsonPath}`, "ai_studio_invalid_laravel_composer_json");
  }
}

function composerDependencyBuckets(composerJson = {}) {
  return [
    composerJson.require,
    composerJson["require-dev"]
  ].filter(isPlainObject);
}

function composerDependencyNames(composerJson = {}) {
  return [...new Set(composerDependencyBuckets(composerJson).flatMap((bucket) => Object.keys(bucket)))]
    .sort((left, right) => left.localeCompare(right));
}

function hasComposerDependency(composerJson = {}, name = "") {
  return composerDependencyBuckets(composerJson).some((bucket) => Object.hasOwn(bucket, name));
}

function composerScripts(composerJson = {}) {
  return isPlainObject(composerJson.scripts) ? composerJson.scripts : {};
}

function composerScriptNames(composerJson = {}) {
  return Object.keys(composerScripts(composerJson))
    .sort((left, right) => left.localeCompare(right));
}

function composerScript(composerJson = {}, scriptName = "") {
  const value = composerScripts(composerJson)[scriptName];
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || "").trim()).filter(Boolean).join(" && ");
  }
  return typeof value === "string" ? value.trim() : "";
}

function composerRunCommand(scriptName = "") {
  return `composer run ${shellQuote(scriptName)}`;
}

function phpArtisanCommand(args = []) {
  return ["php artisan", ...args.map(shellQuote)].filter(Boolean).join(" ");
}

function composerProjectName(composerJson = {}) {
  return normalizeText(composerJson.name || "");
}

export {
  composerDependencyNames,
  composerProjectName,
  composerRunCommand,
  composerScript,
  composerScriptNames,
  composerScripts,
  fileExists,
  hasComposerDependency,
  phpArtisanCommand,
  readComposerJson
};
