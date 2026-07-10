function normalizedDraftFields(fields = {}) {
  const source = fields && typeof fields === "object" && !Array.isArray(fields)
    ? fields
    : {};
  return Object.fromEntries(
    Object.entries(source)
      .map(([name, value]) => [String(name || "").trim(), String(value ?? "")])
      .filter(([name]) => Boolean(name))
  );
}

function draftFieldsEqual(left = {}, right = {}) {
  const leftFields = normalizedDraftFields(left);
  const rightFields = normalizedDraftFields(right);
  const names = new Set([
    ...Object.keys(leftFields),
    ...Object.keys(rightFields)
  ]);
  return [...names].every((name) => leftFields[name] === rightFields[name]);
}

function emptyDraftFields(fields = {}, fieldName = "") {
  const source = normalizedDraftFields(fields);
  const empty = Object.fromEntries(
    Object.keys(source).map((name) => [name, ""])
  );
  const normalizedFieldName = String(fieldName || "").trim();
  if (!Object.keys(empty).length && normalizedFieldName) {
    empty[normalizedFieldName] = "";
  }
  return empty;
}

export {
  draftFieldsEqual,
  emptyDraftFields,
  normalizedDraftFields
};
