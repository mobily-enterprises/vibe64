// A value as a record; anything that is not a plain object is empty.
function record(value = null) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export { record };
