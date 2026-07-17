import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  isPlainObject,
  normalizeText
} from "./core.js";

const PROJECT_BOOTSTRAP_CONFIG_SCHEMA_VERSION = 1;
const PROJECT_BOOTSTRAP_CONFIG_KEY = "bootstrapConfig";
const PROJECT_BOOTSTRAP_CONFIG_STATUS_PENDING = "pending";

async function readJsonFile(filePath = "") {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function writeJsonFile(filePath = "", value = {}) {
  if (!filePath) {
    throw new Error("writeJsonFile requires filePath.");
  }
  await mkdir(path.dirname(filePath), {
    recursive: true
  });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normalizeBootstrapValues(values = {}) {
  const input = isPlainObject(values) ? values : {};
  return Object.fromEntries(Object.keys(input)
    .sort((left, right) => left.localeCompare(right))
    .map((key) => [normalizeText(key), normalizeText(input[key])])
    .filter(([key]) => Boolean(key)));
}

function normalizeProjectBootstrapConfig(value = {}) {
  if (!isPlainObject(value)) {
    return null;
  }
  const projectType = normalizeText(value.projectType);
  const values = normalizeBootstrapValues(value.values);
  if (!projectType && Object.keys(values).length < 1) {
    return null;
  }
  return {
    schemaVersion: PROJECT_BOOTSTRAP_CONFIG_SCHEMA_VERSION,
    status: PROJECT_BOOTSTRAP_CONFIG_STATUS_PENDING,
    projectType,
    values,
    ...(normalizeText(value.savedAt) ? { savedAt: normalizeText(value.savedAt) } : {})
  };
}

function pendingProjectBootstrapConfig(metadata = {}) {
  const config = normalizeProjectBootstrapConfig(metadata?.[PROJECT_BOOTSTRAP_CONFIG_KEY]);
  return config?.status === PROJECT_BOOTSTRAP_CONFIG_STATUS_PENDING ? config : null;
}

function projectMetadataWithBootstrapConfig(metadata = {}, bootstrapConfig = {}) {
  const normalized = normalizeProjectBootstrapConfig({
    ...bootstrapConfig,
    savedAt: normalizeText(bootstrapConfig.savedAt) || new Date().toISOString(),
    status: PROJECT_BOOTSTRAP_CONFIG_STATUS_PENDING
  });
  if (!normalized) {
    return {
      ...metadata
    };
  }
  return {
    ...metadata,
    [PROJECT_BOOTSTRAP_CONFIG_KEY]: normalized
  };
}

function projectMetadataWithoutBootstrapConfig(metadata = {}) {
  const {
    [PROJECT_BOOTSTRAP_CONFIG_KEY]: _bootstrapConfig,
    ...rest
  } = metadata;
  return rest;
}

async function readProjectRecordMetadata(projectRecordPath = "") {
  const filePath = normalizeText(projectRecordPath);
  return filePath ? readJsonFile(filePath) : {};
}

async function updateProjectRecordMetadata(projectRecordPath = "", update = {}) {
  const filePath = normalizeText(projectRecordPath);
  if (!filePath) {
    throw new Error("Updating project metadata requires a project record path.");
  }
  const current = await readProjectRecordMetadata(filePath);
  const next = typeof update === "function"
    ? update(current)
    : {
        ...current,
        ...(isPlainObject(update) ? update : {})
      };
  if (!isPlainObject(next)) {
    throw new TypeError("Project metadata updates must produce an object.");
  }
  await writeJsonFile(filePath, next);
  return next;
}

async function saveProjectBootstrapConfig({
  projectRecordPath = "",
  projectType = "",
  values = {}
} = {}) {
  const filePath = normalizeText(projectRecordPath);
  if (!filePath) {
    const error = new Error("Project bootstrap config requires a project record path.");
    error.code = "vibe64_project_bootstrap_record_required";
    throw error;
  }
  const updated = await updateProjectRecordMetadata(filePath, (metadata) => (
    projectMetadataWithBootstrapConfig(metadata, {
      projectType,
      values
    })
  ));
  return pendingProjectBootstrapConfig(updated);
}

async function consumeProjectBootstrapConfig({
  projectRecordPath = ""
} = {}) {
  const filePath = normalizeText(projectRecordPath);
  if (!filePath) {
    return null;
  }
  const metadata = await readProjectRecordMetadata(filePath);
  const bootstrapConfig = pendingProjectBootstrapConfig(metadata);
  if (!bootstrapConfig) {
    return null;
  }
  await updateProjectRecordMetadata(filePath, projectMetadataWithoutBootstrapConfig);
  return bootstrapConfig;
}

export {
  PROJECT_BOOTSTRAP_CONFIG_KEY,
  PROJECT_BOOTSTRAP_CONFIG_SCHEMA_VERSION,
  PROJECT_BOOTSTRAP_CONFIG_STATUS_PENDING,
  consumeProjectBootstrapConfig,
  normalizeProjectBootstrapConfig,
  pendingProjectBootstrapConfig,
  projectMetadataWithBootstrapConfig,
  readProjectRecordMetadata,
  saveProjectBootstrapConfig,
  updateProjectRecordMetadata
};
