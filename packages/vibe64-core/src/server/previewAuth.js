import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  PREVIEW_APPLICATION_IDENTITY_LIMIT,
  PREVIEW_APPLICATION_IDENTITY_RESERVED_NAMES,
  PREVIEW_IDENTITY_SELECTOR_TYPES,
  checkPreviewIdentitySelector,
  inspectPreviewApplicationIdentities,
  previewApplicationIdentityLabel
} from "../shared/previewIdentity.js";
import { vibe64Error as previewIdentityError } from "./core.js";

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
// A grant's selector refusal, by the rule it breaks.
const PREVIEW_IDENTITY_SELECTOR_MESSAGES = Object.freeze({
  vibe64_preview_identity_email_invalid: "Preview identity email is invalid.",
  vibe64_preview_identity_login_invalid: "Preview identity login is invalid.",
  vibe64_preview_identity_selector_missing: "Preview identity selector is missing.",
  vibe64_preview_identity_selector_type_invalid: "Preview identity selector type is invalid.",
  vibe64_preview_identity_user_id_invalid: "Preview identity user id is invalid."
});
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

/**
 * An invalid managed app identity list. Every sentence keeps the code callers
 * branch on and names itself with its own messageCode.
 * @param {string} message
 * @param {string} messageCode
 * @param {Record<string, unknown>} [messageParams]
 */
function previewApplicationIdentitiesError(message, messageCode, messageParams = {}) {
  return previewIdentityError(message, "vibe64_invalid_application_identities_config", { messageCode, messageParams });
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
    "Managed app identities must be a list of names, selector types, and application values.",
    "vibe64_application_identities_not_list"
  );
}

/**
 * A managed app identity list as it is stored, or the refusal of its first
 * invalid entry, naming that entry and the reason (the rules are
 * inspectPreviewApplicationIdentities'). Every write goes through it.
 * @param {unknown} value
 */
function normalizePreviewApplicationIdentities(value = []) {
  const rows = inspectPreviewApplicationIdentities(previewApplicationIdentityEntries(value));
  const refused = rows.find((row) => row.problem);
  if (refused) {
    throw previewApplicationIdentitiesError(
      `Managed app ${previewApplicationIdentityLabel(refused)} is not valid. ${refused.problem.reason}`,
      refused.problem.code,
      { name: refused.name, position: refused.position }
    );
  }
  return rows.map(({ name, type, value: selectorValue }) => ({ name, type, value: selectorValue }));
}

/**
 * previewIdentity is the Outputs Preview identity that @local/vibe64-genesis
 * already parsed and validated; its environment names are the app's aliases.
 */
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
  const checked = checkPreviewIdentitySelector(value && typeof value === "object" && !Array.isArray(value) ? value : {});
  if (checked.problem) {
    throw previewIdentityError(PREVIEW_IDENTITY_SELECTOR_MESSAGES[checked.problem.code], checked.problem.code);
  }
  return checked.selector;
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

/**
 * A grant's worker: which of a browser-test run's app servers its identity command signs in on (0, the first, for every
 * other Preview), a whole number. The Preview that executes the grant refuses a worker it does not serve.
 * @param {unknown} worker
 */
function previewIdentityWorker(worker = 0) {
  if (!Number.isSafeInteger(worker) || worker < 0) {
    throw previewIdentityError("A preview identity's worker is a whole number from 0.", "vibe64_preview_identity_worker_invalid");
  }
  return worker;
}

function createPreviewIdentityGrant(previewAuth = {}, selection = {}, options = {}) {
  const {
    nowSeconds = Math.floor(Date.now() / 1000),
    ttlSeconds = PREVIEW_IDENTITY_GRANT_TTL_SECONDS,
    worker = 0
  } = options;
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
    version: 1,
    ...(previewIdentityWorker(worker) > 0 ? { worker } : {})
  })).toString("base64url");
  return `${PREVIEW_IDENTITY_GRANT_PREFIX}.${payloadText}.${previewIdentityGrantSignature(payloadText)}`;
}

function verifyPreviewIdentityGrant(grant = "", previewAuth = {}, options = {}) {
  const {
    nowSeconds = Math.floor(Date.now() / 1000)
  } = options;
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
    selection: normalizePreviewIdentitySelection(payload.selection),
    worker: previewIdentityWorker(payload.worker ?? 0)
  };
}

function samePreviewIdentityGrantScope(left, right) {
  return PREVIEW_IDENTITY_GRANT_SCOPE_KEYS.every(
    (key) => String(left?.[key] || "") === String(right?.[key] || "")
  );
}

function timingSafeTextEqual(left = "", right = "") {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
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
  PREVIEW_IDENTITY_SELECTOR_TYPES,
  PREVIEW_IDENTITY_SUBJECT_SELECTOR,
  createPreviewAuthSecret,
  createPreviewIdentityGrant,
  normalizePreviewApplicationIdentities,
  normalizePreviewAuthKind,
  normalizePreviewIdentitySelection,
  previewAuthEnvironment,
  previewAuthIdentityAvailable,
  previewAuthIdentityTypes,
  previewAuthSecretPath,
  previewIdentityCommandEnvironment,
  readPreviewAuthSecret,
  verifyPreviewIdentityGrant
};
