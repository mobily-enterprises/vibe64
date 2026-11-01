// A value as trimmed text; absent values are empty.
function trimmedText(value = "") {
  return String(value || "").trim();
}

export { trimmedText };
