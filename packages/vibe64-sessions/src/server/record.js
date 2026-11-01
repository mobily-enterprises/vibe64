/**
 * A plain object value; anything else reads as an empty record.
 */
function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export { record };
