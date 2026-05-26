import {
  normalizeText
} from "@local/ai-studio-core/server/core";

function configValues(config = {}) {
  return config?.values && typeof config.values === "object" ? config.values : config;
}

function configValue(config = {}, fieldId = "", fallback = "") {
  return configValues(config)[fieldId] || fallback;
}

function configTextValue(config = {}, fieldId = "", fallback = "") {
  return normalizeText(configValue(config, fieldId, fallback));
}

function selectedConfigValue(config = {}, fieldId = "", allowedValues = new Set(), fallback = "") {
  const value = configTextValue(config, fieldId, fallback);
  return allowedValues.has(value) ? value : fallback;
}

function configOptionValues(options = []) {
  return new Set(options.map((option) => option.value));
}

function defaultConfigFromFields(fields = []) {
  return Object.fromEntries(fields.map((field) => [
    field.id,
    field.defaultValue || ""
  ]));
}

export {
  configOptionValues,
  configTextValue,
  configValues,
  defaultConfigFromFields,
  selectedConfigValue
};
