function previewOptionsForTarget(launchTarget = {}) {
  return Array.isArray(launchTarget?.previewOptions)
    ? launchTarget.previewOptions.filter((option) => option?.id)
    : [];
}

function normalizeStringList(value = []) {
  const entries = Array.isArray(value) ? value : String(value || "").split(/\r?\n/u);
  return entries
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
}

function normalizePreviewOptionValue(option = {}, value = null) {
  if (option.type === "string-list") {
    return normalizeStringList(value);
  }
  return String(value ?? "").trim();
}

function normalizePreviewInput(launchTarget = {}, input = {}) {
  const options = previewOptionsForTarget(launchTarget);
  const rawValues = input?.values && typeof input.values === "object" && !Array.isArray(input.values)
    ? input.values
    : {};
  return {
    values: Object.fromEntries(options.map((option) => [
      option.id,
      normalizePreviewOptionValue(option, rawValues[option.id] ?? option.defaultValue)
    ]))
  };
}

function previewInputHasValues(input = {}) {
  const values = input?.values && typeof input.values === "object" && !Array.isArray(input.values)
    ? input.values
    : {};
  return Object.values(values).some((value) => Array.isArray(value)
    ? value.length > 0
    : String(value || "").trim());
}

function previewOptionFormValue(option = {}, input = {}) {
  const value = input?.values?.[option.id];
  if (option.type === "string-list") {
    return normalizeStringList(value).join("\n");
  }
  return String(value ?? "").trim();
}

function previewInputFromFormValues(launchTarget = {}, formValues = {}) {
  const values = Object.fromEntries(previewOptionsForTarget(launchTarget).map((option) => [
    option.id,
    normalizePreviewOptionValue(option, formValues[option.id])
  ]));
  return {
    values
  };
}

export {
  normalizePreviewInput,
  previewInputFromFormValues,
  previewInputHasValues,
  previewOptionFormValue,
  previewOptionsForTarget
};
