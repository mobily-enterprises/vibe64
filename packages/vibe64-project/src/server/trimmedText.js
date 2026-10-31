// A value as trimmed text; absent values are empty.
function text(value = "") {
  return String(value || "").trim();
}

export { text };
