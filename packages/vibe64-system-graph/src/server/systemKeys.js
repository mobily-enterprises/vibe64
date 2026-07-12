const SYSTEM_KEY_MAX_BYTES = 8 * 1024;

function encodeSystemKey(value) {
  const text = String(value || "");
  if (!text) {
    throw new TypeError("System key value must not be empty.");
  }
  return Buffer.from(text, "utf8").toString("base64url");
}

function decodeSystemKey(value) {
  const encoded = String(value || "").trim();
  if (!encoded || encoded.length > SYSTEM_KEY_MAX_BYTES * 2 || !/^[A-Za-z0-9_-]+$/u.test(encoded)) {
    throw new TypeError("Invalid System key.");
  }
  const bytes = Buffer.from(encoded, "base64url");
  const decoded = bytes.toString("utf8");
  if (!decoded || bytes.length > SYSTEM_KEY_MAX_BYTES || encodeSystemKey(decoded) !== encoded) {
    throw new TypeError("Invalid System key.");
  }
  return decoded;
}

export {
  decodeSystemKey,
  encodeSystemKey
};
