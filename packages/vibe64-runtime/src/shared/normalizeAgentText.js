// A value as trimmed text; null and undefined are empty.
function normalizeAgentText(value = "") {
  return String(value ?? "").trim();
}

export { normalizeAgentText };
