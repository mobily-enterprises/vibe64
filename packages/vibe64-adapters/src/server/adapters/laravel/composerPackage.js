import { access, readFile } from "node:fs/promises";
import path from "node:path";

import {
  shellQuote
} from "@local/vibe64-execution/server";
import {
  vibe64Error,
  isPlainObject,
  normalizeText
} from "@local/vibe64-core/server/core";
import {
  runtimeShellCommandArgs
} from "@local/vibe64-core/server/runtimeToolchain";

const LARAVEL_RUNTIME_PACKAGE_IDS = Object.freeze([
  "php-8.3",
  "composer",
  "nodejs-22"
]);

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

  return parseComposerJson(text, composerJsonPath);
}

function parseComposerJson(text = "", filePath = "composer.json") {
  try {
    return JSON.parse(String(text));
  } catch {
    throw vibe64Error(`Invalid JSON in Laravel composer file: ${filePath}`, "vibe64_invalid_laravel_composer_json");
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

function laravelRuntimePackageIds() {
  return [...LARAVEL_RUNTIME_PACKAGE_IDS];
}

function laravelRuntimeCommandArgs(command = "") {
  return runtimeShellCommandArgs(laravelRuntimePackageIds(), command, {
    preferSharedRuntimePacks: true
  });
}

function laravelRuntimeCommand(command = "") {
  return laravelRuntimeCommandArgs(command).map(shellQuote).join(" ");
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
  laravelRuntimeCommand,
  laravelRuntimeCommandArgs,
  laravelRuntimePackageIds,
  phpArtisanCommand,
  parseComposerJson,
  readComposerJson
};
