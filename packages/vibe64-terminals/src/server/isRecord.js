// Whether a value is a plain record: an object that is not an array.
function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export { isRecord };
