export function cleanTitle(value) {
  return String(value || "").trim() || "Untitled";
}
