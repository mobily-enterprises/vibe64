import { readFile } from "node:fs/promises";
import path from "node:path";

import { serializeByKey, writeJsonFileAtomic } from "./atomicFile.js";

import {
  isMissingPathError,
  isPlainObject,
  normalizeText,
  vibe64Error
} from "./core.js";
import {
  RUNTIME_CONFIG_OWNERS,
  normalizeRuntimeConfigKey,
  normalizeRuntimeConfigRecord,
  normalizeRuntimeConfigScope
} from "./runtimeConfig.js";

const ENV_USER_VALUES_DIR = "env";
const ENV_USER_VALUES_FILE = "user-values.json";
const ENV_USER_VALUES_VERSION = 1;
const ENV_USER_VALUE_SOURCE = "user";
// Every session of a project shares its one values file; changes queue per file.
const envUserValuesUpdates = new Map();

function envUserValuesPath(projectRuntimeRoot = "") {
  const root = normalizeText(projectRuntimeRoot);
  if (!root) {
    throw vibe64Error(
      "Env user values require projectRuntimeRoot.",
      "vibe64_env_user_values_root_required"
    );
  }
  return path.join(path.resolve(root), ENV_USER_VALUES_DIR, ENV_USER_VALUES_FILE);
}

async function readEnvUserValuesFile(filePath = "") {
  try {
    const text = await readFile(filePath, "utf8");
    const parsed = JSON.parse(text);
    return isPlainObject(parsed) ? parsed : emptyEnvUserValuesState();
  } catch (error) {
    if (isMissingPathError(error)) {
      return emptyEnvUserValuesState();
    }
    throw error;
  }
}

function emptyEnvUserValuesState() {
  return {
    environments: {},
    version: ENV_USER_VALUES_VERSION
  };
}

function normalizeEnvUserValuesState(state = {}) {
  const environments = {};
  const inputEnvironments = isPlainObject(state?.environments) ? state.environments : {};
  for (const [environment, values] of Object.entries(inputEnvironments)) {
    const normalizedEnvironment = normalizeRuntimeConfigScope(environment);
    if (!isPlainObject(values)) {
      continue;
    }
    environments[normalizedEnvironment] = Object.fromEntries(Object.entries(values)
      .map(([key, value]) => {
        const record = normalizeEnvUserValue(key, value, normalizedEnvironment);
        return [record.key, storedEnvUserValue(record)];
      }));
  }
  return {
    environments,
    version: ENV_USER_VALUES_VERSION
  };
}

function normalizeEnvUserValue(key = "", value = {}, environment = "dev") {
  const input = isPlainObject(value)
    ? value
    : {
        value
      };
  return normalizeRuntimeConfigRecord({
    editable: true,
    key: normalizeRuntimeConfigKey(key),
    owner: RUNTIME_CONFIG_OWNERS.USER,
    requiredFor: [],
    scope: normalizeRuntimeConfigScope(environment),
    secret: input.secret,
    source: ENV_USER_VALUE_SOURCE,
    value: input.value
  });
}

function storedEnvUserValue(record = {}) {
  return {
    secret: record.secret,
    value: record.value
  };
}

function envUserRecordsFromState(state = {}) {
  const normalizedState = normalizeEnvUserValuesState(state);
  return Object.entries(normalizedState.environments)
    .flatMap(([environment, values]) => Object.entries(values)
      .map(([key, value]) => normalizeEnvUserValue(key, value, environment)));
}

async function readEnvUserValues({
  projectRuntimeRoot = ""
} = {}) {
  const filePath = envUserValuesPath(projectRuntimeRoot);
  const state = normalizeEnvUserValuesState(await readEnvUserValuesFile(filePath));
  return {
    filePath,
    records: envUserRecordsFromState(state),
    state
  };
}

async function saveEnvUserValues({
  projectRuntimeRoot = "",
  environment = "dev",
  values = {}
} = {}) {
  if (!isPlainObject(values)) {
    throw vibe64Error(
      "Env user values must be an object keyed by environment variable name.",
      "vibe64_env_user_values_invalid"
    );
  }
  const filePath = envUserValuesPath(projectRuntimeRoot);
  await serializeByKey(envUserValuesUpdates, filePath, async () => {
    const state = normalizeEnvUserValuesState(await readEnvUserValuesFile(filePath));
    applyEnvUserValues(state, environment, values);
    await writeJsonFileAtomic(filePath, normalizeEnvUserValuesState(state), { fileMode: 0o600 });
  });
  return readEnvUserValues({
    projectRuntimeRoot
  });
}

function applyEnvUserValues(state, environment, values) {
  const normalizedEnvironment = normalizeRuntimeConfigScope(environment);
  const scopeValues = {
    ...(state.environments[normalizedEnvironment] || {})
  };

  for (const [key, inputValue] of Object.entries(values)) {
    const normalizedKey = normalizeRuntimeConfigKey(key);
    const previousValue = scopeValues[normalizedKey] || {};
    const nextValue = isPlainObject(inputValue)
      ? {
          ...previousValue,
          ...inputValue
        }
      : {
          ...previousValue,
          value: inputValue
        };
    if (nextValue.remove === true) {
      delete scopeValues[normalizedKey];
      continue;
    }
    const record = normalizeEnvUserValue(normalizedKey, nextValue, normalizedEnvironment);
    scopeValues[normalizedKey] = storedEnvUserValue(record);
  }

  state.environments[normalizedEnvironment] = Object.fromEntries(Object.entries(scopeValues)
    .sort(([left], [right]) => left.localeCompare(right)));
}

export {
  ENV_USER_VALUE_SOURCE,
  ENV_USER_VALUES_FILE,
  emptyEnvUserValuesState,
  readEnvUserValues,
  envUserRecordsFromState,
  envUserValuesPath,
  saveEnvUserValues
};
