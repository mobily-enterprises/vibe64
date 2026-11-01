import { createHash } from "node:crypto";

/** A value's SHA-256 digest as lowercase hex. */
function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

export { sha256Hex };
