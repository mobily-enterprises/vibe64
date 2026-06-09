import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  VIBE64_STATE_DIR,
  vibe64Error,
  isMissingPathError,
  isPlainObject,
  normalizeText,
  normalizeTargetRoot,
  pathExists
} from "@local/vibe64-core/server/core";
import {
  deepFreeze
} from "@local/vibe64-core/server/deepFreeze";

const VIBE64_CONFIG_DIR = "config";
const VIBE64_RUNTIME_DIR = "runtime";
const VIBE64_CONFIG_HELPER_FILE = "vibe64-config.sh";
const CONFIG_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u;
const CONFIG_FIELD_TYPES = new Set(["boolean", "path", "select", "string"]);

const VIBE64_GENERAL_CONFIG_FIELDS = deepFreeze([]);

function assertConfigName(name = "") {
  const normalizedName = normalizeText(name);
  if (!CONFIG_NAME_PATTERN.test(normalizedName)) {
    throw vibe64Error(
      `Invalid Vibe64 config name: ${normalizedName || "(empty)"}`,
      "vibe64_invalid_config_name"
    );
  }
  return normalizedName;
}

function normalizeFieldType(type = "") {
  const normalizedType = normalizeText(type || "string");
  if (!CONFIG_FIELD_TYPES.has(normalizedType)) {
    throw vibe64Error(
      `Invalid Vibe64 config field type: ${normalizedType || "(empty)"}`,
      "vibe64_invalid_config_field_type"
    );
  }
  return normalizedType;
}

function normalizeConfigOption(option = {}) {
  const value = normalizeText(isPlainObject(option) ? option.value : option);
  if (!value) {
    throw vibe64Error("Vibe64 select config option is missing a value.", "vibe64_invalid_config_option");
  }
  return {
    description: normalizeText(option.description),
    label: normalizeText(option.label || value),
    value
  };
}

function normalizeBooleanValue(value, fieldId) {
  if (typeof value === "boolean") {
    return value;
  }
  const normalizedValue = normalizeText(value).toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalizedValue)) {
    return true;
  }
  if (["", "0", "false", "no", "off"].includes(normalizedValue)) {
    return false;
  }
  throw vibe64Error(
    `Config ${fieldId} must be true or false.`,
    "vibe64_invalid_boolean_config"
  );
}

function normalizeSelectValue(value, field) {
  const normalizedValue = normalizeText(value);
  const allowedValues = new Set(field.options.map((option) => option.value));
  if (!allowedValues.has(normalizedValue)) {
    throw vibe64Error(
      `Config ${field.id} must be one of: ${[...allowedValues].join(", ")}.`,
      "vibe64_invalid_select_config"
    );
  }
  return normalizedValue;
}

function valueForFile(value, field) {
  if (field.type === "boolean") {
    return value ? "true" : "false";
  }
  return normalizeText(value);
}

function normalizeConfigValue(value, field) {
  if (field.type === "boolean") {
    return normalizeBooleanValue(value, field.id);
  }
  if (field.type === "select") {
    return normalizeSelectValue(value, field);
  }
  return normalizeText(value);
}

function isSavedConfigValueError(error) {
  return error?.code === "vibe64_invalid_boolean_config" ||
    error?.code === "vibe64_invalid_select_config";
}

function invalidSavedConfigValue({
  defaultValue,
  error,
  filePath,
  rawValue
}) {
  return {
    defaultValue,
    filePath,
    invalid: {
      code: error.code,
      message: error.message,
      rawValue: normalizeText(rawValue)
    },
    saved: true,
    value: defaultValue
  };
}

function configReadinessMessage({
  invalid = [],
  missing = []
} = {}) {
  if (invalid.length) {
    return "Some saved config values are no longer valid. Review and save the configuration.";
  }
  if (missing.length) {
    return "Save these values before Studio prepares the target project.";
  }
  return "";
}

function normalizeConfigField(field = {}, {
  sectionId = "general",
  sectionLabel = "Studio"
} = {}) {
  const type = normalizeFieldType(field.type);
  const normalizedField = {
    defaultValue: field.defaultValue,
    description: normalizeText(field.description),
    id: assertConfigName(field.id),
    label: normalizeText(field.label || field.id),
    required: field.required !== false,
    sectionId: normalizeText(field.sectionId || sectionId),
    sectionLabel: normalizeText(field.sectionLabel || sectionLabel),
    type
  };

  if (type === "select") {
    normalizedField.options = (Array.isArray(field.options) ? field.options : [])
      .map(normalizeConfigOption);
    if (!normalizedField.options.length) {
      throw vibe64Error(
        `Select config field ${normalizedField.id} must declare options.`,
        "vibe64_invalid_config_field"
      );
    }
  } else {
    normalizedField.options = [];
  }

  normalizedField.defaultValue = normalizeConfigValue(
    field.defaultValue ?? (type === "boolean" ? false : ""),
    normalizedField
  );

  return normalizedField;
}

function normalizeConfigFields(fields = [], section) {
  return (Array.isArray(fields) ? fields : [])
    .map((field) => normalizeConfigField(field, section));
}

function assertUniqueConfigFields(fields = []) {
  const seen = new Set();
  for (const field of fields) {
    if (seen.has(field.id)) {
      throw vibe64Error(
        `Duplicate Vibe64 config field: ${field.id}.`,
        "vibe64_duplicate_config_field"
      );
    }
    seen.add(field.id);
  }
}

function normalizeDefaultValues(fields = [], defaults = {}) {
  const defaultValues = isPlainObject(defaults) ? defaults : {};
  return Object.fromEntries(fields.map((field) => {
    const defaultValue = Object.hasOwn(defaultValues, field.id)
      ? defaultValues[field.id]
      : field.defaultValue;
    return [field.id, normalizeConfigValue(defaultValue, field)];
  }));
}

function fieldValueFromInput(field, inputValues = {}, defaultValues = {}) {
  const sourceValue = Object.hasOwn(inputValues, field.id)
    ? inputValues[field.id]
    : defaultValues[field.id];
  return normalizeConfigValue(sourceValue, field);
}

function assertKnownConfigInputValues(fields = [], inputValues = {}) {
  const knownFieldIds = new Set(fields.map((field) => field.id));
  for (const fieldId of Object.keys(isPlainObject(inputValues) ? inputValues : {})) {
    const normalizedFieldId = assertConfigName(fieldId);
    if (!knownFieldIds.has(normalizedFieldId)) {
      throw vibe64Error(
        `Unknown Vibe64 config field: ${normalizedFieldId}.`,
        "vibe64_unknown_config_field"
      );
    }
  }
}

function resolveVibe64ConfigPaths({
  stateRoot = "",
  targetRoot = process.cwd()
} = {}) {
  const normalizedTargetRoot = normalizeTargetRoot(targetRoot);
  const resolvedStateRoot = stateRoot ? path.resolve(stateRoot) : path.join(normalizedTargetRoot, VIBE64_STATE_DIR);
  const configRoot = path.join(resolvedStateRoot, VIBE64_CONFIG_DIR);
  const runtimeRoot = path.join(resolvedStateRoot, VIBE64_RUNTIME_DIR);
  return {
    configRoot,
    helperPath: path.join(runtimeRoot, VIBE64_CONFIG_HELPER_FILE),
    runtimeRoot,
    stateRoot: resolvedStateRoot,
    targetRoot: normalizedTargetRoot
  };
}

function configValuePath(configRoot, fieldId) {
  return path.join(configRoot, assertConfigName(fieldId));
}

async function readConfigFile(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (isMissingPathError(error)) {
      return "";
    }
    throw error;
  }
}

function configSections(fields = []) {
  const sections = [];
  const sectionsById = new Map();
  for (const field of fields) {
    if (!sectionsById.has(field.sectionId)) {
      const section = {
        fields: [],
        id: field.sectionId,
        label: field.sectionLabel
      };
      sectionsById.set(field.sectionId, section);
      sections.push(section);
    }
    sectionsById.get(field.sectionId).fields.push(field);
  }
  return sections;
}

function configHelperScript() {
  return `#!/usr/bin/env bash

vibe64_config_dir() {
  printf '%s\\n' "\${VIBE64_CONFIG_DIR:-}"
}

vibe64_config_path() {
  local name="\${1:-}"
  case "$name" in
    ''|*/*|*'..'*)
      return 2
      ;;
  esac
  local dir
  dir="$(vibe64_config_dir)"
  if [ -z "$dir" ]; then
    return 2
  fi
  printf '%s/%s\\n' "$dir" "$name"
}

vibe64_config_value() {
  local name="\${1:-}"
  local default_value="\${2:-}"
  local file_path
  file_path="$(vibe64_config_path "$name")" || {
    printf '%s\\n' "$default_value"
    return 0
  }
  if [ ! -f "$file_path" ]; then
    printf '%s\\n' "$default_value"
    return 0
  fi
  head -n 1 "$file_path" | sed 's/[[:space:]]*$//'
}

vibe64_config_bool() {
  local value
  value="$(vibe64_config_value "\${1:-}" "\${2:-false}" | tr '[:upper:]' '[:lower:]')"
  case "$value" in
    1|true|yes|on)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

vibe64_config_is() {
  [ "$(vibe64_config_value "\${1:-}" "")" = "\${2:-}" ]
}
`;
}

async function writeConfigHelper(paths) {
  await mkdir(paths.runtimeRoot, {
    recursive: true
  });
  await writeFile(paths.helperPath, configHelperScript(), "utf8");
  await chmod(paths.helperPath, 0o755);
}

function normalizeConfigDefinition({
  adapterFields = [],
  adapterLabel = "Adapter",
  defaultValues = {},
  fields = null,
  generalFields = VIBE64_GENERAL_CONFIG_FIELDS
} = {}) {
  if (Array.isArray(fields)) {
    const normalizedFields = normalizeConfigFields(fields);
    assertUniqueConfigFields(normalizedFields);
    return {
      defaults: normalizeDefaultValues(normalizedFields, defaultValues),
      fields: normalizedFields,
      sections: configSections(normalizedFields)
    };
  }

  const normalizedGeneralFields = normalizeConfigFields(generalFields, {
    sectionId: "general",
    sectionLabel: "Studio"
  });
  const normalizedAdapterFields = normalizeConfigFields(adapterFields, {
    sectionId: "adapter",
    sectionLabel: adapterLabel
  });
  const combinedFields = [
    ...normalizedGeneralFields,
    ...normalizedAdapterFields
  ];
  assertUniqueConfigFields(combinedFields);
  return {
    defaults: normalizeDefaultValues(combinedFields, defaultValues),
    fields: combinedFields,
    sections: configSections(combinedFields)
  };
}

function createVibe64ProjectConfigStore({
  stateRoot = "",
  targetRoot = process.cwd()
} = {}) {
  const paths = resolveVibe64ConfigPaths({
    stateRoot,
    targetRoot
  });

  async function ensureRuntimeFiles() {
    await writeConfigHelper(paths);
  }

  async function readConfig(definition = {}) {
    const normalizedDefinition = normalizeConfigDefinition(definition);
    await ensureRuntimeFiles();

    const entries = await Promise.all(normalizedDefinition.fields.map(async (field) => {
      const filePath = configValuePath(paths.configRoot, field.id);
      const saved = await pathExists(filePath);
      const rawValue = saved ? await readConfigFile(filePath) : normalizedDefinition.defaults[field.id];
      const defaultValue = normalizedDefinition.defaults[field.id];
      let value = defaultValue;
      try {
        value = normalizeConfigValue(rawValue, field);
      } catch (error) {
        if (saved && isSavedConfigValueError(error)) {
          return [field.id, invalidSavedConfigValue({
            defaultValue,
            error,
            filePath,
            rawValue
          })];
        }
        throw error;
      }
      return [field.id, {
        defaultValue,
        filePath,
        invalid: null,
        saved,
        value
      }];
    }));
    const fieldValues = Object.fromEntries(entries);
    const values = Object.fromEntries(entries.map(([fieldId, state]) => [fieldId, state.value]));
    const fieldById = new Map(normalizedDefinition.fields.map((field) => [field.id, field]));
    const missing = entries
      .filter(([fieldId, state]) => fieldById.get(fieldId)?.required !== false && !state.saved)
      .map(([fieldId]) => fieldId)
      .sort((left, right) => left.localeCompare(right));
    const invalid = entries
      .filter(([, state]) => state.invalid)
      .map(([fieldId, state]) => ({
        fieldId,
        filePath: state.filePath,
        ...state.invalid
      }))
      .sort((left, right) => left.fieldId.localeCompare(right.fieldId));

    return {
      configRoot: paths.configRoot,
      defaults: normalizedDefinition.defaults,
      fields: normalizedDefinition.fields,
      fieldValues,
      helperPath: paths.helperPath,
      invalid,
      message: configReadinessMessage({
        invalid,
        missing
      }),
      missing,
      ready: missing.length === 0 && invalid.length === 0,
      runtimeRoot: paths.runtimeRoot,
      sections: normalizedDefinition.sections,
      values
    };
  }

  async function saveConfig({
    definition = {},
    values = {}
  } = {}) {
    const normalizedDefinition = normalizeConfigDefinition(definition);
    assertKnownConfigInputValues(normalizedDefinition.fields, values);
    const normalizedValues = Object.fromEntries(normalizedDefinition.fields.map((field) => {
      return [field.id, fieldValueFromInput(field, values, normalizedDefinition.defaults)];
    }));

    await mkdir(paths.configRoot, {
      recursive: true
    });
    await Promise.all(normalizedDefinition.fields.map((field) => {
      return writeFile(
        configValuePath(paths.configRoot, field.id),
        `${valueForFile(normalizedValues[field.id], field)}\n`,
        "utf8"
      );
    }));
    await ensureRuntimeFiles();
    return readConfig({
      defaultValues: normalizedDefinition.defaults,
      fields: normalizedDefinition.fields
    });
  }

  async function environment() {
    await ensureRuntimeFiles();
    return {
      VIBE64_CONFIG_DIR: paths.configRoot,
      VIBE64_CONFIG_SH: paths.helperPath
    };
  }

  return Object.freeze({
    configRoot: paths.configRoot,
    environment,
    helperPath: paths.helperPath,
    readConfig,
    runtimeRoot: paths.runtimeRoot,
    saveConfig
  });
}

export {
  VIBE64_CONFIG_DIR,
  VIBE64_CONFIG_HELPER_FILE,
  VIBE64_GENERAL_CONFIG_FIELDS,
  VIBE64_RUNTIME_DIR,
  createVibe64ProjectConfigStore,
  normalizeConfigDefinition,
  resolveVibe64ConfigPaths
};
