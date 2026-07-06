import {
  isPlainObject,
  normalizeText,
  vibe64Error
} from "@local/vibe64-core/server/core";

const ADAPTER_SETTINGS_ACTION_KINDS = new Set(["command", "flow"]);
const ADAPTER_SETTINGS_ACTION_STATUSES = new Set([
  "available",
  "blocked",
  "configured",
  "not_configured",
  "running"
]);
const ADAPTER_SETTINGS_FIELD_TYPES = new Set([
  "boolean",
  "password",
  "select",
  "string"
]);
const ADAPTER_SETTINGS_STEP_TYPES = new Set([
  "choices",
  "done",
  "error",
  "form",
  "progress"
]);
const SETTINGS_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u;

function assertSettingsId(value = "", label = "adapter settings id") {
  const normalized = normalizeText(value);
  if (!SETTINGS_ID_PATTERN.test(normalized)) {
    throw vibe64Error(
      `Invalid ${label}: ${normalized || "(empty)"}`,
      "vibe64_invalid_adapter_settings_id"
    );
  }
  return normalized;
}

function normalizeSettingsOption(option = {}) {
  const source = isPlainObject(option) ? option : {
    value: option
  };
  const value = normalizeText(source.value);
  if (!value) {
    throw vibe64Error("Adapter settings option is missing a value.", "vibe64_invalid_adapter_settings_option");
  }
  return {
    description: normalizeText(source.description),
    label: normalizeText(source.label || value),
    value
  };
}

function normalizeAdapterSettingsField(field = {}) {
  if (!isPlainObject(field)) {
    throw vibe64Error("Adapter settings field must be an object.", "vibe64_invalid_adapter_settings_field");
  }
  const type = normalizeText(field.type || "string");
  if (!ADAPTER_SETTINGS_FIELD_TYPES.has(type)) {
    throw vibe64Error(
      `Invalid adapter settings field type: ${type || "(empty)"}`,
      "vibe64_invalid_adapter_settings_field_type"
    );
  }
  return {
    description: normalizeText(field.description),
    id: assertSettingsId(field.id || field.name, "adapter settings field id"),
    label: normalizeText(field.label || field.id || field.name),
    name: assertSettingsId(field.name || field.id, "adapter settings field name"),
    options: type === "select"
      ? (Array.isArray(field.options) ? field.options : []).map(normalizeSettingsOption)
      : [],
    placeholder: normalizeText(field.placeholder),
    required: field.required !== false,
    type,
    value: field.value
  };
}

function normalizeAdapterSettingsAction(action = {}) {
  if (!isPlainObject(action)) {
    throw vibe64Error("Adapter settings action must be an object.", "vibe64_invalid_adapter_settings_action");
  }
  const kind = normalizeText(action.kind || "command");
  if (!ADAPTER_SETTINGS_ACTION_KINDS.has(kind)) {
    throw vibe64Error(
      `Invalid adapter settings action kind: ${kind || "(empty)"}`,
      "vibe64_invalid_adapter_settings_action_kind"
    );
  }
  const status = normalizeText(action.status || "available");
  if (!ADAPTER_SETTINGS_ACTION_STATUSES.has(status)) {
    throw vibe64Error(
      `Invalid adapter settings action status: ${status || "(empty)"}`,
      "vibe64_invalid_adapter_settings_action_status"
    );
  }
  return {
    description: normalizeText(action.description),
    disabled: action.disabled === true,
    disabledReason: normalizeText(action.disabledReason),
    id: assertSettingsId(action.id, "adapter settings action id"),
    kind,
    label: normalizeText(action.label || action.id),
    status
  };
}

function normalizeAdapterSettingsComponent(component = {}) {
  if (!isPlainObject(component)) {
    throw vibe64Error("Adapter settings component must be an object.", "vibe64_invalid_adapter_settings_component");
  }
  const componentId = assertSettingsId(component.id, "adapter settings component id");
  return {
    component: normalizeText(component.component || componentId),
    description: normalizeText(component.description),
    id: componentId,
    props: isPlainObject(component.props) ? component.props : {},
    saveValuesOnSuccess: isPlainObject(component.saveValuesOnSuccess) ? component.saveValuesOnSuccess : {},
    title: normalizeText(component.title || component.label || componentId)
  };
}

function normalizeAdapterSettingsSection(section = {}) {
  if (!isPlainObject(section)) {
    throw vibe64Error("Adapter settings section must be an object.", "vibe64_invalid_adapter_settings_section");
  }
  return {
    actions: (Array.isArray(section.actions) ? section.actions : []).map(normalizeAdapterSettingsAction),
    components: (Array.isArray(section.components || section.mounts) ? (section.components || section.mounts) : [])
      .map(normalizeAdapterSettingsComponent),
    description: normalizeText(section.description),
    fields: (Array.isArray(section.fields) ? section.fields : []).map(normalizeAdapterSettingsField),
    id: assertSettingsId(section.id, "adapter settings section id"),
    title: normalizeText(section.title || section.label || section.id)
  };
}

function normalizeAdapterSettingsSections(sections = []) {
  return (Array.isArray(sections) ? sections : [])
    .map(normalizeAdapterSettingsSection);
}

function normalizeAdapterSettingsStep(step = {}) {
  if (!isPlainObject(step)) {
    throw vibe64Error("Adapter settings action step must be an object.", "vibe64_invalid_adapter_settings_step");
  }
  const type = normalizeText(step.type || "done");
  if (!ADAPTER_SETTINGS_STEP_TYPES.has(type)) {
    throw vibe64Error(
      `Invalid adapter settings action step type: ${type || "(empty)"}`,
      "vibe64_invalid_adapter_settings_step_type"
    );
  }
  return {
    choices: type === "choices"
      ? (Array.isArray(step.choices) ? step.choices : []).map(normalizeSettingsOption)
      : [],
    fields: type === "form"
      ? (Array.isArray(step.fields) ? step.fields : []).map(normalizeAdapterSettingsField)
      : [],
    message: normalizeText(step.message),
    step: normalizeText(step.step || type),
    title: normalizeText(step.title),
    type
  };
}

function adapterSettingsActionMissing(actionId = "") {
  return vibe64Error(
    `Adapter settings action is not available: ${normalizeText(actionId) || "(empty)"}`,
    "vibe64_adapter_settings_action_missing"
  );
}

export {
  adapterSettingsActionMissing,
  normalizeAdapterSettingsSections,
  normalizeAdapterSettingsStep
};
