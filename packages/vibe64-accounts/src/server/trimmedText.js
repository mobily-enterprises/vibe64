// A value as text without surrounding spaces; nothing becomes "".
function trimmedText(value = "") {
  return String(value ?? "").trim();
}

export { trimmedText };
