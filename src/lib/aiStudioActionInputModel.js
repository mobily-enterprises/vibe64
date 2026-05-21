function normalizeActionInputField(field = {}) {
  const name = String(field?.name || "").trim();
  if (!name) {
    return null;
  }
  const kind = String(field.kind || "text").trim();
  return {
    kind: kind === "textarea" ? "textarea" : "text",
    label: String(field.label || name).trim(),
    name,
    placeholder: String(field.placeholder || "").trim(),
    required: field.required !== false,
    requiredMessage: String(field.requiredMessage || "").trim()
  };
}

function normalizeActionInputFields(fields = []) {
  return (Array.isArray(fields) ? fields : [])
    .map(normalizeActionInputField)
    .filter(Boolean);
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
  emptyActionInputValues,
  normalizeActionInputFields,
  requiredActionInputMissing
};
