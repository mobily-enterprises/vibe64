import {
  isPlainObject,
  normalizeText,
  vibe64Error
} from "@local/vibe64-core/server/core";

const WORKFLOW_INPUT_FIELD_KINDS = Object.freeze([
  "password",
  "text",
  "textarea"
]);
const WORKFLOW_INPUT_FIELD_PRIVACY = Object.freeze({
  PRIVATE: "private",
  PUBLIC: "public"
});

function normalizeWorkflowInputFieldKind(value = "") {
  const kind = normalizeText(value || "text");
  if (kind === "password" || kind === "secret") {
    return "password";
  }
  return WORKFLOW_INPUT_FIELD_KINDS.includes(kind) ? kind : "text";
}

function normalizeWorkflowInputFieldPrivacy(field = {}, kind = "") {
  const source = isPlainObject(field) ? field : {};
  const privacy = normalizeText(source.privacy);
  if (
    privacy === WORKFLOW_INPUT_FIELD_PRIVACY.PRIVATE ||
    source.private === true ||
    kind === "password"
  ) {
    return WORKFLOW_INPUT_FIELD_PRIVACY.PRIVATE;
  }
  return WORKFLOW_INPUT_FIELD_PRIVACY.PUBLIC;
}

function optionalFieldText(field = {}, name = "") {
  const text = normalizeText(field[name]);
  return text ? { [name]: text } : {};
}

function optionalFieldValue(field = {}, name = "") {
  return Object.hasOwn(field, name) ? { [name]: field[name] } : {};
}

function normalizeWorkflowInputField(field = {}, {
  defaultRequiredMessage = "",
  missingNameCode = "vibe64_workflow_input_field_name_missing",
  ownerId = "",
  ownerLabel = "Vibe64 input"
} = {}) {
  if (!isPlainObject(field)) {
    throw vibe64Error(
      `${ownerLabel} has an input field that is not an object.`,
      missingNameCode
    );
  }
  const name = normalizeText(field.name);
  if (!name) {
    throw vibe64Error(
      ownerId
        ? `${ownerLabel} ${ownerId} has an input field without a name.`
        : `${ownerLabel} field is missing a name.`,
      missingNameCode
    );
  }
  const kind = normalizeWorkflowInputFieldKind(field.kind);
  const privacy = normalizeWorkflowInputFieldPrivacy(field, kind);
  const requiredMessage = normalizeText(field.requiredMessage || defaultRequiredMessage);
  return {
    kind,
    label: normalizeText(field.label || name),
    name,
    placeholder: normalizeText(field.placeholder),
    required: field.required !== false,
    ...(requiredMessage ? { requiredMessage } : {}),
    ...(privacy === WORKFLOW_INPUT_FIELD_PRIVACY.PRIVATE
      ? {
          autocomplete: normalizeText(field.autocomplete || "off"),
          privacy
        }
      : optionalFieldText(field, "autocomplete")),
    ...optionalFieldText(field, "ariaLabel"),
    ...optionalFieldText(field, "density"),
    ...optionalFieldValue(field, "displayOnly"),
    ...optionalFieldValue(field, "rows"),
    ...optionalFieldValue(field, "value")
  };
}

function normalizeWorkflowInputFields(fields = [], options = {}) {
  const seenFieldNames = new Set();
  const normalizedFields = [];
  for (const field of Array.isArray(fields) ? fields : []) {
    const normalizedField = normalizeWorkflowInputField(field, options);
    if (seenFieldNames.has(normalizedField.name)) {
      throw vibe64Error(
        options.ownerId
          ? `Duplicate Vibe64 input field in ${options.ownerLabel || "input"} ${options.ownerId}: ${normalizedField.name}`
          : `Duplicate Vibe64 input field: ${normalizedField.name}`,
        options.duplicateCode || "vibe64_duplicate_workflow_input_field"
      );
    }
    seenFieldNames.add(normalizedField.name);
    normalizedFields.push(normalizedField);
  }
  return normalizedFields;
}

function workflowInputFieldIsPrivate(field = {}) {
  const kind = normalizeWorkflowInputFieldKind(field?.kind);
  return normalizeWorkflowInputFieldPrivacy(field, kind) === WORKFLOW_INPUT_FIELD_PRIVACY.PRIVATE;
}

function workflowInputFieldsContainPrivateValues(fields = [], values = {}) {
  if (!isPlainObject(values)) {
    return false;
  }
  return (Array.isArray(fields) ? fields : [])
    .some((field) => workflowInputFieldIsPrivate(field) && Object.hasOwn(values, normalizeText(field.name)));
}

export {
  WORKFLOW_INPUT_FIELD_PRIVACY,
  normalizeWorkflowInputField,
  normalizeWorkflowInputFieldKind,
  normalizeWorkflowInputFieldPrivacy,
  normalizeWorkflowInputFields,
  workflowInputFieldIsPrivate,
  workflowInputFieldsContainPrivateValues
};
