import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt);
const PASSWORD_HASH_PREFIX = "scrypt:v1";
const PASSWORD_KEY_LENGTH = 64;
const SCRYPT_PARAMS = Object.freeze({
  N: 16384,
  p: 1,
  r: 8
});

function normalizePassword(value = "") {
  return String(value || "");
}

function assertUsablePassword(password = "") {
  const normalized = normalizePassword(password);
  if (normalized.length < 8) {
    const error = new Error("Password must be at least 8 characters.");
    error.code = "vibe64_password_too_short";
    throw error;
  }
  return normalized;
}

async function hashPassword(password = "") {
  const normalized = assertUsablePassword(password);
  const salt = crypto.randomBytes(16).toString("base64url");
  const key = await derivePasswordKey(normalized, salt);
  return [
    PASSWORD_HASH_PREFIX,
    String(SCRYPT_PARAMS.N),
    String(SCRYPT_PARAMS.r),
    String(SCRYPT_PARAMS.p),
    salt,
    key.toString("base64url")
  ].join(":");
}

async function verifyPassword(password = "", passwordHash = "") {
  const parsed = parsePasswordHash(passwordHash);
  if (!parsed) {
    return false;
  }
  const key = await derivePasswordKey(normalizePassword(password), parsed.salt, parsed.params);
  const expected = Buffer.from(parsed.hash, "base64url");
  return expected.length === key.length && crypto.timingSafeEqual(expected, key);
}

function parsePasswordHash(value = "") {
  const parts = String(value || "").split(":");
  if (parts.length !== 7 || `${parts[0]}:${parts[1]}` !== PASSWORD_HASH_PREFIX) {
    return null;
  }
  const params = {
    N: Number(parts[2]),
    r: Number(parts[3]),
    p: Number(parts[4])
  };
  if (!Number.isInteger(params.N) || !Number.isInteger(params.r) || !Number.isInteger(params.p)) {
    return null;
  }
  return {
    hash: parts[6],
    params,
    salt: parts[5]
  };
}

async function derivePasswordKey(password, salt, params = SCRYPT_PARAMS) {
  return scrypt(password, salt, PASSWORD_KEY_LENGTH, {
    ...params,
    maxmem: 64 * 1024 * 1024
  });
}

export {
  assertUsablePassword,
  hashPassword,
  verifyPassword
};
