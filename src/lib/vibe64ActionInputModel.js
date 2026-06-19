function normalizeActionInputField(field = {}) {
  const name = String(field?.name || "").trim();
  if (!name) {
    return null;
  }
  const kind = normalizeActionInputFieldKind(field.kind);
  const privacy = actionInputFieldPrivacy(field, kind);
  return {
    kind,
    label: String(field.label || name).trim(),
    name,
    placeholder: String(field.placeholder || "").trim(),
    required: field.required !== false,
    requiredMessage: String(field.requiredMessage || "").trim(),
    ...(privacy === "private" ? { autocomplete: String(field.autocomplete || "off").trim(), privacy } : optionalFieldText(field, "autocomplete")),
    ...optionalFieldText(field, "ariaLabel"),
    ...optionalFieldText(field, "density"),
    ...optionalFieldValue(field, "displayOnly"),
    ...optionalFieldValue(field, "rows"),
    ...optionalFieldValue(field, "value")
  };
}

function normalizeActionInputFieldKind(value = "") {
  const kind = String(value || "text").trim();
  if (kind === "password" || kind === "secret") {
    return "password";
  }
  return kind === "textarea" ? "textarea" : "text";
}

function actionInputFieldPrivacy(field = {}, kind = normalizeActionInputFieldKind(field.kind)) {
  return String(field?.privacy || "").trim() === "private" ||
    field?.private === true ||
    kind === "password"
    ? "private"
    : "public";
}

function optionalFieldText(field = {}, name = "") {
  const value = String(field?.[name] || "").trim();
  return value ? { [name]: value } : {};
}

function optionalFieldValue(field = {}, name = "") {
  return Object.hasOwn(field || {}, name) ? { [name]: field[name] } : {};
}

function normalizeActionInputFields(fields = []) {
  return (Array.isArray(fields) ? fields : [])
    .map(normalizeActionInputField)
    .filter(Boolean);
}

function actionInputFieldIsPrivate(field = {}) {
  const kind = normalizeActionInputFieldKind(field?.kind);
  return actionInputFieldPrivacy(field, kind) === "private";
}

function publicActionInputValuesForFields(fields = [], values = {}) {
  const sourceValues = values && typeof values === "object" && !Array.isArray(values) ? values : {};
  const publicNames = new Set(normalizeActionInputFields(fields)
    .filter((field) => !actionInputFieldIsPrivate(field))
    .map((field) => field.name));
  return Object.fromEntries(Object.entries(sourceValues)
    .filter(([name]) => publicNames.has(String(name || "").trim())));
}

function actionInputFieldsContainPrivateValues(fields = [], values = {}) {
  const sourceValues = values && typeof values === "object" && !Array.isArray(values) ? values : {};
  return normalizeActionInputFields(fields)
    .some((field) => actionInputFieldIsPrivate(field) && Object.hasOwn(sourceValues, field.name));
}

function emptyActionInputValues(fields = []) {
  return Object.fromEntries(normalizeActionInputFields(fields).map((field) => [field.name, ""]));
}

function requiredActionInputMissing(fields = [], values = {}) {
  return normalizeActionInputFields(fields).some((field) => {
    return field.required && !String(values?.[field.name] || "").trim();
  });
}

export {
  actionInputFieldIsPrivate,
  actionInputFieldsContainPrivateValues,
  emptyActionInputValues,
  normalizeActionInputFields,
  publicActionInputValuesForFields,
  requiredActionInputMissing
};
