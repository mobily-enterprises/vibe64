/**
 * The text an upgrade writes for a JSON file: two-space indentation and a final newline.
 * @param {unknown} value
 */
function upgradeFileText(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export { upgradeFileText };
