/**
 * A value as trimmed text. Only null and undefined are empty; 0 and false keep their text, unlike the kernel's
 * normalizeText.
 * @param {unknown} value
 */
function toText(value) {
  return String(value ?? "").trim();
}

export { toText };
