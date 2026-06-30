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

const ENV_USER_VALUES_DIR = "env";
const ENV_USER_VALUES_FILE = "user-values.json";
const ENV_USER_VALUES_VERSION = 1;
const ENV_USER_VALUE_SOURCE = "user";

function envUserValuesPath(projectLocalRoot = "") {
  const root = normalizeText(projectLocalRoot);
  if (!root) {
    throw vibe64Error(
      "Env user values require projectLocalRoot.",
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
    materialize: true,
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
  projectLocalRoot = ""
} = {}) {
  const filePath = envUserValuesPath(projectLocalRoot);
  const state = normalizeEnvUserValuesState(await readEnvUserValuesFile(filePath));
  return {
    filePath,
    records: envUserRecordsFromState(state),
    state
  };
}

async function saveEnvUserValues({
  projectLocalRoot = "",
  environment = "dev",
  values = {}
} = {}) {
  if (!isPlainObject(values)) {
    throw vibe64Error(
      "Env user values must be an object keyed by environment variable name.",
      "vibe64_env_user_values_invalid"
    );
  }
  const filePath = envUserValuesPath(projectLocalRoot);
  const state = normalizeEnvUserValuesState(await readEnvUserValuesFile(filePath));
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
  await writeEnvUserValuesFile(filePath, state);
  return readEnvUserValues({
    projectLocalRoot
  });
}

async function writeEnvUserValuesFile(filePath = "", state = {}) {
  const normalizedState = normalizeEnvUserValuesState(state);
  await mkdir(path.dirname(filePath), {
    recursive: true
  });
  await writeFile(filePath, `${JSON.stringify(normalizedState, null, 2)}\n`, {
    mode: 0o600
  });
  await chmod(filePath, 0o600);
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
