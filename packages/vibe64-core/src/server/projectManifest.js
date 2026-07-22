import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  isMissingPathError,
  isPlainObject,
  normalizeText,
  vibe64Error
} from "./core.js";
import {
  normalizePreviewIdentityCommandCapability
} from "./previewAuth.js";

const VIBE64_PROJECT_MANIFEST_FILE = "vibe64.project.json";
const VIBE64_PROJECT_MANIFEST_SCHEMA = "vibe64.project";
const VIBE64_PROJECT_MANIFEST_SCHEMA_VERSION = 1;
const VIBE64_RUNTIME_LOCK_FILE = "vibe64.runtime-lock.json";
const VIBE64_SYSTEM_DOCUMENT_FILE = "vibe64.system.json";
const VIBE64_PROJECT_LAUNCHER_DIR = "launcher";
const VIBE64_PROJECT_LAUNCHER_COVER_FILE = "cover.webp";
const VIBE64_PROJECT_LAUNCHER_COVER_RELATIVE_PATH = `.vibe64/${VIBE64_PROJECT_LAUNCHER_DIR}/${VIBE64_PROJECT_LAUNCHER_COVER_FILE}`;
const VIBE64_SOURCE_CONTRACT_ROOT_ENTRIES = Object.freeze([
  ".gitignore",
  VIBE64_PROJECT_MANIFEST_FILE,
  VIBE64_RUNTIME_LOCK_FILE,
  VIBE64_SYSTEM_DOCUMENT_FILE
]);
const VIBE64_SOURCE_CONTRACT_VIBE64_DIRS = Object.freeze([
  "bin",
  VIBE64_PROJECT_LAUNCHER_DIR,
  "project-knowledge",
  "prompts",
  "scripts"
]);

function projectContractRoot({
  sourceContractRoot = "",
  sourceRoot = ""
} = {}) {
  const root = normalizeText(sourceRoot || sourceContractRoot);
  if (!root) {
    throw vibe64Error("Project manifest requires a source root.", "vibe64_project_manifest_root_required");
  }
  return path.resolve(root);
}

function projectManifestPath({
  sourceContractRoot = "",
  sourceRoot = ""
} = {}) {
  return path.join(projectContractRoot({
    sourceContractRoot,
    sourceRoot
  }), VIBE64_PROJECT_MANIFEST_FILE);
}

function projectRuntimeLockPath({
  sourceContractRoot = "",
  sourceRoot = ""
} = {}) {
  return path.join(projectContractRoot({
    sourceContractRoot,
    sourceRoot
  }), VIBE64_RUNTIME_LOCK_FILE);
}

function normalizeProjectManifestConfig(config = {}) {
  const input = isPlainObject(config) ? config : {};
  return Object.fromEntries(Object.keys(input)
    .map((key) => [normalizeText(key), normalizeText(input[key])])
    .filter(([key]) => Boolean(key))
    .sort(([left], [right]) => left.localeCompare(right)));
}

function normalizeProjectManifestCapabilities(capabilities = {}) {
  const input = isPlainObject(capabilities) ? capabilities : {};
  const previewIdentity = normalizePreviewIdentityCommandCapability(input.previewIdentity);
  return previewIdentity
    ? { previewIdentity }
    : {};
}

function sourceContractPathLabel(value = "") {
  return String(value || "")
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\.\/+/u, "")
    .replace(/\/+$/u, "");
}

function sourceContractRootEntryIsAllowed(entry = "") {
  return VIBE64_SOURCE_CONTRACT_ROOT_ENTRIES.includes(sourceContractPathLabel(entry));
}

function sourceContractVibe64EntryIsAllowed(entry = "") {
  return VIBE64_SOURCE_CONTRACT_VIBE64_DIRS.includes(sourceContractPathLabel(entry));
}

function sourceContractVibe64Path(entry = "") {
  return `.vibe64/${sourceContractPathLabel(entry)}`;
}

function sourceContractEntryLabelIsAllowed(entry = "") {
  const label = sourceContractPathLabel(entry);
  if (sourceContractRootEntryIsAllowed(label)) {
    return true;
  }
  if (!label.startsWith(".vibe64/")) {
    return false;
  }
  const child = label.slice(".vibe64/".length).split("/", 1)[0];
  return sourceContractVibe64EntryIsAllowed(child);
}

function normalizeProjectManifest(value = {}) {
  const input = isPlainObject(value) ? value : {};
  const capabilities = normalizeProjectManifestCapabilities(input.capabilities);
  return {
    schema: VIBE64_PROJECT_MANIFEST_SCHEMA,
    schemaVersion: VIBE64_PROJECT_MANIFEST_SCHEMA_VERSION,
    projectType: normalizeText(input.projectType),
    config: normalizeProjectManifestConfig(input.config),
    ...(Object.keys(capabilities).length > 0 ? { capabilities } : {})
  };
}

function parseProjectManifestText(text = "") {
  let rawManifest;
  try {
    rawManifest = JSON.parse(String(text));
  } catch {
    throw vibe64Error(
      "vibe64.project.json contains invalid JSON.",
      "vibe64_project_manifest_invalid_json"
    );
  }
  if (!isPlainObject(rawManifest)) {
    throw vibe64Error(
      "Vibe64 project manifest must contain a JSON object.",
      "vibe64_project_manifest_object_required"
    );
  }
  if (
    rawManifest.schema !== VIBE64_PROJECT_MANIFEST_SCHEMA ||
    rawManifest.schemaVersion !== VIBE64_PROJECT_MANIFEST_SCHEMA_VERSION
  ) {
    throw vibe64Error(
      "Vibe64 project manifest schema is not supported by this Vibe64 version.",
      "vibe64_project_manifest_schema_unsupported"
    );
  }
  return normalizeProjectManifest(rawManifest);
}

function stableJson(value = {}) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function readProjectManifest({
  sourceContractRoot = "",
  sourceRoot = ""
} = {}) {
  const filePath = projectManifestPath({
    sourceContractRoot,
    sourceRoot
  });
  try {
    return parseProjectManifestText(await readFile(filePath, "utf8"));
  } catch (error) {
    if (isMissingPathError(error)) {
      return null;
    }
    throw error;
  }
}

async function writeProjectManifest({
  manifest = {},
  sourceContractRoot = "",
  sourceRoot = ""
} = {}) {
  const filePath = projectManifestPath({
    sourceContractRoot,
    sourceRoot
  });
  const normalized = normalizeProjectManifest(manifest);
  await mkdir(path.dirname(filePath), {
    recursive: true
  });
  await writeFile(filePath, stableJson(normalized), "utf8");
  return normalized;
}

async function updateProjectManifest({
  sourceContractRoot = "",
  sourceRoot = "",
  update
} = {}) {
  const current = await readProjectManifest({
    sourceContractRoot,
    sourceRoot
  }) || normalizeProjectManifest();
  const next = typeof update === "function" ? update(current) : {
    ...current,
    ...(isPlainObject(update) ? update : {})
  };
  return writeProjectManifest({
    manifest: next,
    sourceContractRoot,
    sourceRoot
  });
}

export {
  VIBE64_PROJECT_MANIFEST_FILE,
  VIBE64_PROJECT_MANIFEST_SCHEMA,
  VIBE64_PROJECT_MANIFEST_SCHEMA_VERSION,
  VIBE64_PROJECT_LAUNCHER_COVER_FILE,
  VIBE64_PROJECT_LAUNCHER_COVER_RELATIVE_PATH,
  VIBE64_PROJECT_LAUNCHER_DIR,
  VIBE64_RUNTIME_LOCK_FILE,
  VIBE64_SYSTEM_DOCUMENT_FILE,
  VIBE64_SOURCE_CONTRACT_ROOT_ENTRIES,
  VIBE64_SOURCE_CONTRACT_VIBE64_DIRS,
  normalizeProjectManifest,
  normalizeProjectManifestCapabilities,
  normalizeProjectManifestConfig,
  parseProjectManifestText,
  projectContractRoot,
  projectManifestPath,
  projectRuntimeLockPath,
  readProjectManifest,
  sourceContractEntryLabelIsAllowed,
  sourceContractRootEntryIsAllowed,
  sourceContractVibe64EntryIsAllowed,
  sourceContractVibe64Path,
  updateProjectManifest,
  writeProjectManifest
};
