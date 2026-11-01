/**
 * A text value trimmed, or "" when there is none.
 */
function normalizeText(value) {
  return String(value || "").trim();
}

export { normalizeText };
