import { createHash } from "node:crypto";

/**
 * The SHA-256 digest of a string or buffer, as lowercase hex.
 * @param {string | Buffer} value
 */
function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

export { sha256Hex };
