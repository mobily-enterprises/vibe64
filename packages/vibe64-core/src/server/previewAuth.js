import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  PREVIEW_IDENTITY_SELECTOR_EMAIL,
  PREVIEW_IDENTITY_SELECTOR_LOGIN,
  PREVIEW_IDENTITY_SELECTOR_TYPES,
  PREVIEW_IDENTITY_SELECTOR_USER_ID
} from "../shared/previewIdentity.js";

// The one Preview authentication mode: the app's own Preview identity command
// (Outputs `#### Preview identity`) signs the selected application user in.
const APPLICATION_COMMAND_PREVIEW_AUTH_KIND = "application-command";
const PREVIEW_IDENTITY_CONTROL_PATH = "/__vibe64/preview-identity";
const PREVIEW_IDENTITY_GRANT_PREFIX = "vibe64-preview-identity-v1";
const PREVIEW_IDENTITY_GRANT_TTL_SECONDS = 60;
const PREVIEW_IDENTITY_GRANT_SECRET = crypto.randomBytes(32);
const PREVIEW_IDENTITY_LOGIN_OPERATION = "login-as";
const PREVIEW_IDENTITY_LOGOUT_OPERATION = "logout";
const PREVIEW_IDENTITY_SUBJECT_SELECTOR = "selector";
const PREVIEW_APPLICATION_IDENTITY_NAME_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/u;
const PREVIEW_APPLICATION_IDENTITY_RESERVED_NAMES = new Set([
  "default",
  "guest",
  "you"
]);
const PREVIEW_APPLICATION_IDENTITY_FIELDS = new Set(["name", "type", "value"]);
const PREVIEW_APPLICATION_IDENTITY_LIMIT = 32;
const PREVIEW_IDENTITY_GRANT_SCOPE_KEYS = Object.freeze([
  "projectScope",
  "sessionSourceRoot",
  "sessionId",
  "targetHref",
  "terminalSessionId"
]);

function normalizePreviewAuthKind(value = "") {
  return String(value || "").trim() === APPLICATION_COMMAND_PREVIEW_AUTH_KIND
    ? APPLICATION_COMMAND_PREVIEW_AUTH_KIND
    : "";
}

function createPreviewAuthSecret() {
  return crypto.randomBytes(32).toString("hex");
}

function requirePreviewAuthSecret(secret = "") {
  const normalizedSecret = String(secret || "").trim();
  if (!/^[a-f0-9]{64}$/u.test(normalizedSecret)) {
    throw new Error("Preview auth secret is missing or invalid.");
  }
  return normalizedSecret;
}

function previewAuthEnvironment({
  kind = "",
  previewIdentity = null,
  secret = ""
} = {}) {
  return normalizePreviewAuthKind(kind)
    ? previewIdentityCommandEnvironment({ previewIdentity, secret })
    : {};
}

function previewAuthIdentityAvailable({ kind = "" } = {}) {
  return Boolean(normalizePreviewAuthKind(kind));
}

function normalizePreviewIdentityTypes(value = []) {
  const values = Array.isArray(value) ? value : [];
  return [...new Set(values
    .map((entry) => String(entry || "").trim())
    .filter((entry) => PREVIEW_IDENTITY_SELECTOR_TYPES.includes(entry)))];
}

function previewApplicationIdentitiesError(message = "") {
  const error = new Error(message || "Managed app identities are invalid.");
  error.code = "vibe64_invalid_application_identities_config";
  return error;
}

function previewApplicationIdentityEntries(value = []) {
  if (Array.isArray(value)) {
    return value;
  }
  const text = String(value || "").trim();
  if (!text) {
    return [];
  }
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // Report the same field-level validation error as every other invalid shape.
  }
  throw previewApplicationIdentitiesError(
    "Managed app identities must be a list of names, selector types, and application values."
  );
}

function normalizePreviewApplicationIdentities(value = []) {
  const entries = previewApplicationIdentityEntries(value);
  if (entries.length > PREVIEW_APPLICATION_IDENTITY_LIMIT) {
    throw previewApplicationIdentitiesError(
      `Managed app identities cannot contain more than ${PREVIEW_APPLICATION_IDENTITY_LIMIT} entries.`
    );
  }
  const names = new Set();
  return entries.map((entry, index) => {
    if (
      !entry ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      Object.keys(entry).some((key) => !PREVIEW_APPLICATION_IDENTITY_FIELDS.has(key))
    ) {
      throw previewApplicationIdentitiesError(
        `Managed app identity ${index + 1} must contain only name, type, and value.`
      );
    }
    const name = String(entry.name || "").trim().toLowerCase();
    if (
      !PREVIEW_APPLICATION_IDENTITY_NAME_PATTERN.test(name) ||
      PREVIEW_APPLICATION_IDENTITY_RESERVED_NAMES.has(name)
    ) {
      throw previewApplicationIdentitiesError(
        `Managed app identity ${index + 1} has an invalid name. Use a short name such as admin or user.`
      );
    }
    let selector;
    try {
      selector = normalizePreviewIdentitySelector({
        type: entry.type,
        value: entry.value
      });
    } catch {
      throw previewApplicationIdentitiesError(
        `Managed app identity ${name} has an invalid application selector.`
      );
    }
    if (names.has(name)) {
      throw previewApplicationIdentitiesError(
        `Managed app identity name ${name} is duplicated.`
      );
    }
    names.add(name);
    return {
      name,
      type: selector.type,
      value: selector.value
    };
  });
}

// previewIdentity is the Outputs Preview identity that @local/vibe64-genesis
// already parsed and validated; its environment names are the app's aliases.
function previewIdentityCommandEnvironment({
  previewIdentity = null,
  secret = ""
} = {}) {
  if (!previewIdentity) {
    return {};
  }
  const normalizedSecret = requirePreviewAuthSecret(secret);
  const { enabled = "", secret: secretName = "" } = previewIdentity.environment || {};
  return {
    ...(enabled ? { [enabled]: "true" } : {}),
    ...(secretName ? { [secretName]: normalizedSecret } : {})
  };
}

function previewAuthIdentityTypes({
  identityTypes = [],
  kind = ""
} = {}) {
  const supported = normalizePreviewAuthKind(kind) ? PREVIEW_IDENTITY_SELECTOR_TYPES : [];
  const requested = normalizePreviewIdentityTypes(identityTypes);
  return Array.isArray(identityTypes) && identityTypes.length > 0
    ? requested.filter((type) => supported.includes(type))
    : [...supported];
}

function normalizePreviewIdentitySelector(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const type = String(source.type || "").trim();
  if (!PREVIEW_IDENTITY_SELECTOR_TYPES.includes(type)) {
    throw previewIdentityError(
      "Preview identity selector type is invalid.",
      "vibe64_preview_identity_selector_type_invalid"
    );
  }
  const rawValue = String(source.value || "").trim();
  const normalizedValue = type === PREVIEW_IDENTITY_SELECTOR_EMAIL
    ? rawValue.toLowerCase()
    : rawValue;
  if (!normalizedValue) {
    throw previewIdentityError(
      "Preview identity selector is missing.",
      "vibe64_preview_identity_selector_missing"
    );
  }
  if (
    type === PREVIEW_IDENTITY_SELECTOR_EMAIL &&
    (!normalizedValue.includes("@") || normalizedValue.length > 320)
  ) {
    throw previewIdentityError(
      "Preview identity email is invalid.",
      "vibe64_preview_identity_email_invalid"
    );
  }
  if (type !== PREVIEW_IDENTITY_SELECTOR_EMAIL && normalizedValue.length > 256) {
    throw previewIdentityError(
      type === PREVIEW_IDENTITY_SELECTOR_LOGIN
        ? "Preview identity login is invalid."
        : "Preview identity user id is invalid.",
      type === PREVIEW_IDENTITY_SELECTOR_LOGIN
        ? "vibe64_preview_identity_login_invalid"
        : "vibe64_preview_identity_user_id_invalid"
    );
  }
  return {
    type,
    value: normalizedValue
  };
}

function normalizePreviewIdentitySelection(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  if (Object.hasOwn(source, "subject")) {
    throw previewIdentityError(
      "Preview identity login requires an explicit application selector.",
      "vibe64_preview_identity_subject_unsupported"
    );
  }
  const operation = String(source.operation || PREVIEW_IDENTITY_LOGIN_OPERATION).trim();
  if (![PREVIEW_IDENTITY_LOGIN_OPERATION, PREVIEW_IDENTITY_LOGOUT_OPERATION].includes(operation)) {
    throw previewIdentityError(
      "Preview identity operation is invalid.",
      "vibe64_preview_identity_operation_invalid"
    );
  }
  return {
    operation,
    ...(operation === PREVIEW_IDENTITY_LOGIN_OPERATION
      ? { selector: normalizePreviewIdentitySelector(source.selector) }
      : {})
  };
}

function previewIdentityGrantScope(previewAuth = {}) {
  const scope = {
    projectScope: String(previewAuth.projectScope || "").trim(),
    sessionSourceRoot: String(previewAuth.sessionSourceRoot || "").trim(),
    sessionId: String(previewAuth.sessionId || "").trim(),
    targetHref: String(previewAuth.targetHref || "").trim(),
    terminalSessionId: String(previewAuth.terminalSessionId || "").trim()
  };
  if (PREVIEW_IDENTITY_GRANT_SCOPE_KEYS.some((key) => !scope[key])) {
    throw previewIdentityError(
      "Preview identity authorization scope is incomplete.",
      "vibe64_preview_identity_scope_incomplete"
    );
  }
  return scope;
}

function previewIdentityGrantSignature(payloadText = "") {
  return crypto
    .createHmac("sha256", PREVIEW_IDENTITY_GRANT_SECRET)
    .update(PREVIEW_IDENTITY_GRANT_PREFIX)
    .update("\0")
    .update(payloadText)
    .digest("base64url");
}

function createPreviewIdentityGrant(previewAuth = {}, selection = {}, {
  nowSeconds = Math.floor(Date.now() / 1000),
  ttlSeconds = PREVIEW_IDENTITY_GRANT_TTL_SECONDS
} = {}) {
  if (!previewAuthIdentityAvailable(previewAuth)) {
    throw previewIdentityError(
      "This preview does not support identity switching.",
      "vibe64_preview_identity_unsupported"
    );
  }
  const normalizedSelection = normalizePreviewIdentitySelection(selection);
  if (normalizedSelection.operation === PREVIEW_IDENTITY_LOGIN_OPERATION) {
    const allowedTypes = previewAuthIdentityTypes(previewAuth);
    if (!allowedTypes.includes(normalizedSelection.selector.type)) {
      throw previewIdentityError(
        "This preview does not support that application user identifier.",
        "vibe64_preview_identity_selector_unsupported"
      );
    }
  }
  const normalizedTtlSeconds = Math.min(
    PREVIEW_IDENTITY_GRANT_TTL_SECONDS,
    Math.max(1, Math.floor(Number(ttlSeconds) || PREVIEW_IDENTITY_GRANT_TTL_SECONDS))
  );
  const payloadText = Buffer.from(JSON.stringify({
    expiresAt: nowSeconds + normalizedTtlSeconds,
    issuedAt: nowSeconds,
    nonce: crypto.randomBytes(16).toString("base64url"),
    scope: previewIdentityGrantScope(previewAuth),
    selection: normalizedSelection,
    version: 1
  })).toString("base64url");
  return `${PREVIEW_IDENTITY_GRANT_PREFIX}.${payloadText}.${previewIdentityGrantSignature(payloadText)}`;
}

function verifyPreviewIdentityGrant(grant = "", previewAuth = {}, {
  nowSeconds = Math.floor(Date.now() / 1000)
} = {}) {
  const [prefix, payloadText, signature, extra] = String(grant || "").trim().split(".");
  if (prefix !== PREVIEW_IDENTITY_GRANT_PREFIX || !payloadText || !signature || extra) {
    throw invalidPreviewIdentityGrant();
  }
  const expectedSignature = previewIdentityGrantSignature(payloadText);
  if (!timingSafeTextEqual(signature, expectedSignature)) {
    throw invalidPreviewIdentityGrant();
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadText, "base64url").toString("utf8"));
  } catch {
    throw invalidPreviewIdentityGrant();
  }
  if (
    payload?.version !== 1 ||
    !payload?.nonce ||
    !samePreviewIdentityGrantScope(payload.scope, previewIdentityGrantScope(previewAuth))
  ) {
    throw previewIdentityError(
      "Preview identity grant does not belong to this preview.",
      "vibe64_preview_identity_grant_scope_mismatch"
    );
  }
  if (
    !Number.isInteger(payload.issuedAt) ||
    !Number.isInteger(payload.expiresAt) ||
    payload.issuedAt > nowSeconds + 5 ||
    payload.expiresAt <= nowSeconds
  ) {
    throw previewIdentityError(
      "Preview identity grant has expired.",
      "vibe64_preview_identity_grant_expired"
    );
  }
  return {
    expiresAt: payload.expiresAt,
    nonce: String(payload.nonce),
    selection: normalizePreviewIdentitySelection(payload.selection)
  };
}

function samePreviewIdentityGrantScope(left = {}, right = {}) {
  return PREVIEW_IDENTITY_GRANT_SCOPE_KEYS.every(
    (key) => String(left?.[key] || "") === String(right?.[key] || "")
  );
}

function timingSafeTextEqual(left = "", right = "") {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function previewIdentityError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function invalidPreviewIdentityGrant() {
  return previewIdentityError(
    "Preview identity grant is invalid.",
    "vibe64_preview_identity_grant_invalid"
  );
}

function previewAuthSecretPath({
  sessionRoot = "",
  terminalSessionId = ""
} = {}) {
  return previewAuthRuntimePath({
    filename: "exchange-secret",
    sessionRoot,
    terminalSessionId
  });
}

function previewAuthRuntimePath({
  filename = "",
  sessionRoot = "",
  terminalSessionId = ""
} = {}) {
  const normalizedSessionRoot = String(sessionRoot || "").trim();
  const normalizedTerminalSessionId = String(terminalSessionId || "").trim();
  const normalizedFilename = String(filename || "").trim();
  return normalizedSessionRoot && normalizedTerminalSessionId && normalizedFilename
    ? path.join(normalizedSessionRoot, "runtime", "preview-auth", normalizedTerminalSessionId, normalizedFilename)
    : "";
}

function readPreviewAuthSecret(secretPath = "") {
  const normalizedPath = String(secretPath || "").trim();
  if (!normalizedPath) {
    return "";
  }
  try {
    return requirePreviewAuthSecret(readFileSync(normalizedPath, "utf8").trim());
  } catch (error) {
    if (error?.code === "ENOENT") {
      return "";
    }
    throw new Error(`Cannot read preview auth secret: ${String(error?.message || error)}`);
  }
}

export {
  APPLICATION_COMMAND_PREVIEW_AUTH_KIND,
  PREVIEW_APPLICATION_IDENTITY_LIMIT,
  PREVIEW_APPLICATION_IDENTITY_RESERVED_NAMES,
  PREVIEW_IDENTITY_CONTROL_PATH,
  PREVIEW_IDENTITY_LOGIN_OPERATION,
  PREVIEW_IDENTITY_LOGOUT_OPERATION,
  PREVIEW_IDENTITY_SELECTOR_EMAIL,
  PREVIEW_IDENTITY_SELECTOR_LOGIN,
  PREVIEW_IDENTITY_SELECTOR_TYPES,
  PREVIEW_IDENTITY_SELECTOR_USER_ID,
  PREVIEW_IDENTITY_SUBJECT_SELECTOR,
  createPreviewAuthSecret,
  createPreviewIdentityGrant,
  normalizePreviewApplicationIdentities,
  normalizePreviewAuthKind,
  normalizePreviewIdentitySelector,
  normalizePreviewIdentitySelection,
  previewAuthEnvironment,
  previewAuthIdentityAvailable,
  previewAuthIdentityTypes,
  previewAuthSecretPath,
  previewIdentityCommandEnvironment,
  readPreviewAuthSecret,
  verifyPreviewIdentityGrant
};
