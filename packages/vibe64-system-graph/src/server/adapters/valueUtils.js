function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function ensureObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function sortStrings(values) {
  return [...values].sort((left, right) => String(left).localeCompare(String(right)));
}

export {
  ensureArray,
  ensureObject,
  sortStrings
};
