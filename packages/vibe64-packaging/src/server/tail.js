const OUTPUT_LIMIT = 64 * 1024;

/**
 * The last 64 KiB of a command's output, which is all a result keeps.
 */
function tail(text) {
  const value = String(text || "");
  return value.length > OUTPUT_LIMIT ? value.slice(-OUTPUT_LIMIT) : value;
}

export { tail };
