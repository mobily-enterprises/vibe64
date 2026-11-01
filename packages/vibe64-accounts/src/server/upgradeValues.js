// Value checks and file text shared by the package's offline state upgrades.

/**
 * Whether a saved value is a JSON object (not an array). Falsy values are returned as they are.
 * @param {unknown} value
 */
function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

/**
 * The text an upgrade writes for a JSON file: two-space indentation and a final newline.
 * @param {unknown} value
 */
function upgradeFileText(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export { isPlainObject, upgradeFileText };
