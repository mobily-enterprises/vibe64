import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

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

const RUNTIME_CONFIG_USER_VALUES_DIR = "runtime-config";
const RUNTIME_CONFIG_USER_VALUES_FILE = "user-values.json";
const RUNTIME_CONFIG_USER_VALUES_VERSION = 1;
const RUNTIME_CONFIG_USER_VALUE_SOURCE = "project-runtime-config";

function runtimeConfigUserValuesPath(projectLocalRoot = "") {
  const root = normalizeText(projectLocalRoot);
  if (!root) {
    throw vibe64Error(
      "Runtime config user values require projectLocalRoot.",
      "vibe64_runtime_config_user_values_root_required"
    );
  }
  return path.join(path.resolve(root), RUNTIME_CONFIG_USER_VALUES_DIR, RUNTIME_CONFIG_USER_VALUES_FILE);
}

async function readRuntimeConfigUserValuesFile(filePath = "") {
  try {
    const text = await readFile(filePath, "utf8");
    const parsed = JSON.parse(text);
    return isPlainObject(parsed) ? parsed : emptyRuntimeConfigUserValuesState();
  } catch (error) {
    if (isMissingPathError(error)) {
      return emptyRuntimeConfigUserValuesState();
    }
    throw error;
  }
}

function emptyRuntimeConfigUserValuesState() {
  return {
    scopes: {},
    version: RUNTIME_CONFIG_USER_VALUES_VERSION
  };
}

function normalizeRuntimeConfigUserValuesState(state = {}) {
  const scopes = {};
  const inputScopes = isPlainObject(state?.scopes) ? state.scopes : {};
  for (const [scope, values] of Object.entries(inputScopes)) {
    const normalizedScope = normalizeRuntimeConfigScope(scope);
    if (!isPlainObject(values)) {
      continue;
    }
    scopes[normalizedScope] = Object.fromEntries(Object.entries(values)
      .map(([key, value]) => {
        const record = normalizeRuntimeConfigUserValue(key, value, normalizedScope);
        return [record.key, storedRuntimeConfigUserValue(record)];
      }));
  }
  return {
    scopes,
    version: RUNTIME_CONFIG_USER_VALUES_VERSION
  };
}

function normalizeRuntimeConfigUserValue(key = "", value = {}, scope = "dev") {
  const input = isPlainObject(value)
    ? value
    : {
        value
      };
  return normalizeRuntimeConfigRecord({
    editable: true,
    key: normalizeRuntimeConfigKey(key),
    materialize: input.materialize !== false,
    owner: RUNTIME_CONFIG_OWNERS.USER,
    requiredFor: Array.isArray(input.requiredFor) ? input.requiredFor : [],
    scope,
    secret: input.secret,
    source: RUNTIME_CONFIG_USER_VALUE_SOURCE,
    value: input.value
  });
}

function storedRuntimeConfigUserValue(record = {}) {
  return {
    materialize: record.materialize,
    requiredFor: record.requiredFor,
    secret: record.secret,
    value: record.value
  };
}

function runtimeConfigUserRecordsFromState(state = {}) {
  const normalizedState = normalizeRuntimeConfigUserValuesState(state);
  return Object.entries(normalizedState.scopes)
    .flatMap(([scope, values]) => Object.entries(values)
      .map(([key, value]) => normalizeRuntimeConfigUserValue(key, value, scope)));
}

async function readRuntimeConfigUserValues({
  projectLocalRoot = ""
} = {}) {
  const filePath = runtimeConfigUserValuesPath(projectLocalRoot);
  const state = normalizeRuntimeConfigUserValuesState(await readRuntimeConfigUserValuesFile(filePath));
  return {
    filePath,
    records: runtimeConfigUserRecordsFromState(state),
    state
  };
}

async function saveRuntimeConfigUserValues({
  projectLocalRoot = "",
  scope = "dev",
  values = {}
} = {}) {
  if (!isPlainObject(values)) {
    throw vibe64Error(
      "Runtime config user values must be an object keyed by environment variable name.",
      "vibe64_runtime_config_user_values_invalid"
    );
  }
  const filePath = runtimeConfigUserValuesPath(projectLocalRoot);
  const state = normalizeRuntimeConfigUserValuesState(await readRuntimeConfigUserValuesFile(filePath));
  const normalizedScope = normalizeRuntimeConfigScope(scope);
  const scopeValues = {
    ...(state.scopes[normalizedScope] || {})
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
    const record = normalizeRuntimeConfigUserValue(normalizedKey, nextValue, normalizedScope);
    scopeValues[normalizedKey] = storedRuntimeConfigUserValue(record);
  }

  state.scopes[normalizedScope] = Object.fromEntries(Object.entries(scopeValues)
    .sort(([left], [right]) => left.localeCompare(right)));
  await writeRuntimeConfigUserValuesFile(filePath, state);
  return readRuntimeConfigUserValues({
    projectLocalRoot
  });
}

async function writeRuntimeConfigUserValuesFile(filePath = "", state = {}) {
  const normalizedState = normalizeRuntimeConfigUserValuesState(state);
  await mkdir(path.dirname(filePath), {
    recursive: true
  });
  await writeFile(filePath, `${JSON.stringify(normalizedState, null, 2)}\n`, {
    mode: 0o600
  });
  await chmod(filePath, 0o600);
}

export {
  RUNTIME_CONFIG_USER_VALUE_SOURCE,
  RUNTIME_CONFIG_USER_VALUES_FILE,
  emptyRuntimeConfigUserValuesState,
  readRuntimeConfigUserValues,
  runtimeConfigUserRecordsFromState,
  runtimeConfigUserValuesPath,
  saveRuntimeConfigUserValues
};
