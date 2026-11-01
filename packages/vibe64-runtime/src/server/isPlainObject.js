/**
 * Whether a value is an object that is not an array; a falsy value is returned as it is.
 */
function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

export { isPlainObject };
