import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const APPLICATION_COMMAND_PREVIEW_AUTH_KIND = "application-command";
const COOKIE_PROFILE_PREVIEW_AUTH_KIND = "cookie-profile";
const VIBE64_SELF_PREVIEW_AUTH_KIND = "vibe64-self";
const APPLICATION_PREVIEW_IDENTITY_ENABLED_ENV = "VIBE64_PREVIEW_IDENTITY_ENABLED";
const APPLICATION_PREVIEW_IDENTITY_SECRET_ENV = "VIBE64_PREVIEW_IDENTITY_SECRET";
const PREVIEW_IDENTITY_CONTROL_PATH = "/__vibe64/preview-identity";
const PREVIEW_IDENTITY_GRANT_PREFIX = "vibe64-preview-identity-v1";
const PREVIEW_IDENTITY_GRANT_TTL_SECONDS = 60;
const PREVIEW_IDENTITY_GRANT_SECRET = crypto.randomBytes(32);
const PREVIEW_IDENTITY_LOGIN_OPERATION = "login-as";
const PREVIEW_IDENTITY_LOGOUT_OPERATION = "logout";
const PREVIEW_IDENTITY_SUBJECT_SELECTOR = "selector";
const PREVIEW_IDENTITY_SUBJECT_VIEWER = "viewer";
const PREVIEW_IDENTITY_SELECTOR_EMAIL = "email";
const PREVIEW_IDENTITY_SELECTOR_LOGIN = "login";
const PREVIEW_IDENTITY_SELECTOR_USER_ID = "user-id";
const PREVIEW_IDENTITY_SELECTOR_TYPES = Object.freeze([
  PREVIEW_IDENTITY_SELECTOR_EMAIL,
  PREVIEW_IDENTITY_SELECTOR_LOGIN,
  PREVIEW_IDENTITY_SELECTOR_USER_ID
]);
const PREVIEW_IDENTITY_COMMAND_PROTOCOL = "vibe64.preview-identity.command.v1";
const PREVIEW_IDENTITY_COMMAND_DIRECTORY = ".vibe64/bin";
const PREVIEW_IDENTITY_COMMAND_DEFAULT_TIMEOUT_MS = 10_000;
const PREVIEW_IDENTITY_COMMAND_MAX_TIMEOUT_MS = 30_000;
const PREVIEW_IDENTITY_COMMAND_PATH_PATTERN = /^\.vibe64\/bin\/[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const PREVIEW_IDENTITY_COMMAND_ENV_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/u;
const PREVIEW_IDENTITY_COMMAND_RESERVED_ENV_NAMES = new Set([
  "HOME",
  "LOGNAME",
  "NODE_OPTIONS",
  "PATH",
  "TMPDIR",
  "USER",
  APPLICATION_PREVIEW_IDENTITY_ENABLED_ENV,
  APPLICATION_PREVIEW_IDENTITY_SECRET_ENV
]);
const PREVIEW_IDENTITY_GRANT_SCOPE_KEYS = Object.freeze([
  "projectScope",
  "sessionId",
  "targetHref",
  "targetRoot",
  "terminalSessionId"
]);
const COOKIE_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u;
const PREVIEW_AUTH_KINDS = new Set([
  APPLICATION_COMMAND_PREVIEW_AUTH_KIND,
  COOKIE_PROFILE_PREVIEW_AUTH_KIND,
  VIBE64_SELF_PREVIEW_AUTH_KIND
]);

function normalizePreviewAuthKind(value = "") {
  const text = String(value || "").trim();
  return PREVIEW_AUTH_KINDS.has(text) ? text : "";
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
  projectScope = "",
  secret = "",
  sessionId = "",
  targetHref = "",
  targetRoot = "",
  terminalSessionId = ""
} = {}) {
  return previewAuthProvider(kind)?.environment({
    previewIdentity,
    projectScope,
    secret,
    sessionId,
    targetHref,
    targetRoot,
    terminalSessionId
  }) || {};
}

function previewAuthCookieNames({
  kind = "",
  profilePath = ""
} = {}) {
  return previewAuthProvider(kind)?.cookieNames({
    profilePath
  }) || [];
}

function previewAuthCookieHeader({
  kind = "",
  profilePath = "",
  projectScope = "",
  sessionId = "",
  targetHref = "",
  targetRoot = "",
  terminalSessionId = ""
} = {}) {
  return previewAuthProvider(kind)?.cookieHeader({
    profilePath,
    projectScope,
    sessionId,
    targetHref,
    targetRoot,
    terminalSessionId
  }) || "";
}

function previewAuthIdentityAvailable({ kind = "" } = {}) {
  return previewAuthProvider(kind)?.identityCommand === true;
}

function normalizePreviewIdentityTypes(value = []) {
  const values = Array.isArray(value) ? value : [];
  return [...new Set(values
    .map((entry) => String(entry || "").trim())
    .filter((entry) => PREVIEW_IDENTITY_SELECTOR_TYPES.includes(entry)))];
}

function previewIdentityCommandError(message = "") {
  const error = new Error(message || "Preview identity command capability is invalid.");
  error.code = "vibe64_preview_identity_command_invalid";
  return error;
}

function normalizePreviewIdentityCommandEnvironmentName(value = "", label = "environment variable") {
  const name = String(value || "").trim();
  if (!name) {
    return "";
  }
  if (
    !PREVIEW_IDENTITY_COMMAND_ENV_NAME_PATTERN.test(name) ||
    PREVIEW_IDENTITY_COMMAND_RESERVED_ENV_NAMES.has(name) ||
    name.startsWith("XDG_")
  ) {
    throw previewIdentityCommandError(`Preview identity command ${label} is invalid.`);
  }
  return name;
}

function normalizePreviewIdentityCommandCapability(value = null) {
  if (!value) {
    return null;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw previewIdentityCommandError("Preview identity command capability must be an object.");
  }
  const protocol = String(value.protocol || "").trim();
  if (protocol !== PREVIEW_IDENTITY_COMMAND_PROTOCOL) {
    throw previewIdentityCommandError(
      `Preview identity command protocol must be ${PREVIEW_IDENTITY_COMMAND_PROTOCOL}.`
    );
  }
  const command = (Array.isArray(value.command) ? value.command : [])
    .map((entry) => String(entry ?? ""));
  if (
    command.length < 1 ||
    command.length > 64 ||
    command.some((entry) => !entry.trim() || entry.length > 4096 || /[\0\r\n]/u.test(entry))
  ) {
    throw previewIdentityCommandError(
      "Preview identity command must contain between 1 and 64 non-empty arguments."
    );
  }
  if (!PREVIEW_IDENTITY_COMMAND_PATH_PATTERN.test(command[0])) {
    throw previewIdentityCommandError(
      `Preview identity executable must be an app-owned file under ${PREVIEW_IDENTITY_COMMAND_DIRECTORY}.`
    );
  }
  const identityTypes = normalizePreviewIdentityTypes(value.identityTypes);
  if (identityTypes.length < 1) {
    throw previewIdentityCommandError(
      "Preview identity command must advertise at least one supported application user identifier."
    );
  }
  const requestedViewerTypes = Array.isArray(value.viewerIdentityTypes)
    ? normalizePreviewIdentityTypes(value.viewerIdentityTypes)
    : [PREVIEW_IDENTITY_SELECTOR_EMAIL].filter((type) => identityTypes.includes(type));
  const viewerIdentityTypes = requestedViewerTypes.filter((type) => identityTypes.includes(type));
  if (requestedViewerTypes.length !== viewerIdentityTypes.length) {
    throw previewIdentityCommandError(
      "Preview identity command viewer identifiers must also be supported application user identifiers."
    );
  }
  const environment = value.environment && typeof value.environment === "object" && !Array.isArray(value.environment)
    ? value.environment
    : {};
  const enabledEnvironmentName = normalizePreviewIdentityCommandEnvironmentName(
    environment.enabled,
    "enabled environment variable"
  );
  const secretEnvironmentName = normalizePreviewIdentityCommandEnvironmentName(
    environment.secret,
    "secret environment variable"
  );
  if (enabledEnvironmentName && enabledEnvironmentName === secretEnvironmentName) {
    throw previewIdentityCommandError(
      "Preview identity enabled and secret environment variables must be different."
    );
  }
  const timeoutValue = Number(value.timeoutMs);
  const timeoutMs = Number.isSafeInteger(timeoutValue) && timeoutValue > 0
    ? Math.min(timeoutValue, PREVIEW_IDENTITY_COMMAND_MAX_TIMEOUT_MS)
    : PREVIEW_IDENTITY_COMMAND_DEFAULT_TIMEOUT_MS;
  return {
    command,
    environment: {
      enabled: enabledEnvironmentName,
      secret: secretEnvironmentName
    },
    identityTypes,
    protocol,
    runtimes: [...new Set((Array.isArray(value.runtimes) ? value.runtimes : [])
      .map((entry) => String(entry || "").trim())
      .filter(Boolean))],
    timeoutMs,
    viewerIdentityTypes
  };
}

function previewIdentityCommandEnvironment({
  previewIdentity = null,
  secret = ""
} = {}) {
  const capability = normalizePreviewIdentityCommandCapability(previewIdentity);
  if (!capability) {
    return {};
  }
  const normalizedSecret = requirePreviewAuthSecret(secret);
  return {
    [APPLICATION_PREVIEW_IDENTITY_ENABLED_ENV]: "true",
    [APPLICATION_PREVIEW_IDENTITY_SECRET_ENV]: normalizedSecret,
    ...(capability.environment.enabled
      ? { [capability.environment.enabled]: "true" }
      : {}),
    ...(capability.environment.secret
      ? { [capability.environment.secret]: normalizedSecret }
      : {})
  };
}

function previewAuthIdentityTypes({
  identityTypes = [],
  kind = ""
} = {}) {
  const supported = normalizePreviewIdentityTypes(previewAuthProvider(kind)?.identityTypes || []);
  const requested = normalizePreviewIdentityTypes(identityTypes);
  return Array.isArray(identityTypes) && identityTypes.length > 0
    ? requested.filter((type) => supported.includes(type))
    : supported;
}

function previewAuthViewerIdentityTypes({
  identityTypes = [],
  kind = "",
  viewerIdentityTypes = []
} = {}) {
  const provider = previewAuthProvider(kind);
  const supported = normalizePreviewIdentityTypes(
    provider?.viewerIdentityTypes || provider?.identityTypes || []
  );
  const requested = normalizePreviewIdentityTypes(viewerIdentityTypes);
  const applicationTypes = normalizePreviewIdentityTypes(identityTypes);
  return requested.filter((type) => (
    supported.includes(type) && applicationTypes.includes(type)
  ));
}

function previewAuthRequiresIdentitySecret({ kind = "" } = {}) {
  return previewAuthProvider(kind)?.requiresIdentitySecret === true;
}

function previewAuthUsesProfile({ kind = "" } = {}) {
  return previewAuthProvider(kind)?.usesProfile === true;
}

function emptyPreviewAuthEnvironment() {
  return {};
}

function emptyPreviewAuthCookies() {
  return [];
}

function emptyPreviewAuthCookieHeader() {
  return "";
}

function vibe64SelfPreviewAuthCookieNames({
  profilePath = ""
} = {}) {
  const profile = readVibe64SelfPreviewAuthProfile(profilePath);
  return profile ? [profile.cookieName] : [];
}

function vibe64SelfPreviewAuthCookieHeader({
  profilePath = ""
} = {}) {
  const profile = readVibe64SelfPreviewAuthProfile(profilePath);
  return profile
    ? `${profile.cookieName}=${encodeURIComponent(profile.cookieValue)}`
    : "";
}

function cookieProfilePreviewAuthCookieNames({
  profilePath = ""
} = {}) {
  const profile = readCookiePreviewAuthProfile(profilePath);
  return profile ? profile.cookies.map((cookie) => cookie.name) : [];
}

function cookieProfilePreviewAuthCookieHeader({
  profilePath = ""
} = {}) {
  const profile = readCookiePreviewAuthProfile(profilePath);
  return profile
    ? profile.cookies
      .map((cookie) => `${cookie.name}=${encodeURIComponent(cookie.value)}`)
      .join("; ")
    : "";
}

const PREVIEW_AUTH_PROVIDERS = Object.freeze({
  [APPLICATION_COMMAND_PREVIEW_AUTH_KIND]: Object.freeze({
    cookieHeader: emptyPreviewAuthCookieHeader,
    cookieNames: emptyPreviewAuthCookies,
    environment: previewIdentityCommandEnvironment,
    identityCommand: true,
    identityTypes: PREVIEW_IDENTITY_SELECTOR_TYPES,
    requiresIdentitySecret: true,
    viewerIdentityTypes: PREVIEW_IDENTITY_SELECTOR_TYPES
  }),
  [COOKIE_PROFILE_PREVIEW_AUTH_KIND]: Object.freeze({
    cookieHeader: cookieProfilePreviewAuthCookieHeader,
    cookieNames: cookieProfilePreviewAuthCookieNames,
    environment: emptyPreviewAuthEnvironment,
    usesProfile: true
  }),
  [VIBE64_SELF_PREVIEW_AUTH_KIND]: Object.freeze({
    cookieHeader: vibe64SelfPreviewAuthCookieHeader,
    cookieNames: vibe64SelfPreviewAuthCookieNames,
    environment: emptyPreviewAuthEnvironment,
    usesProfile: true
  })
});

function previewAuthProvider(kind = "") {
  return PREVIEW_AUTH_PROVIDERS[normalizePreviewAuthKind(kind)] || null;
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

function normalizePreviewIdentitySubject(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const kind = String(source.kind || PREVIEW_IDENTITY_SUBJECT_SELECTOR).trim();
  if (kind === PREVIEW_IDENTITY_SUBJECT_SELECTOR) {
    return {
      kind,
      selector: normalizePreviewIdentitySelector(source.selector)
    };
  }
  if (kind !== PREVIEW_IDENTITY_SUBJECT_VIEWER) {
    throw previewIdentityError(
      "Preview identity subject kind is invalid.",
      "vibe64_preview_identity_subject_invalid"
    );
  }
  const identifiers = (Array.isArray(source.identifiers) ? source.identifiers : [])
    .map((entry) => normalizePreviewIdentitySelector(entry));
  const uniqueIdentifiers = [...new Map(
    identifiers.map((entry) => [`${entry.type}\0${entry.value}`, entry])
  ).values()];
  if (uniqueIdentifiers.length < 1 || uniqueIdentifiers.length > PREVIEW_IDENTITY_SELECTOR_TYPES.length) {
    throw previewIdentityError(
      "Preview identity viewer requires at least one supported identifier.",
      "vibe64_preview_identity_viewer_missing"
    );
  }
  return {
    displayName: String(source.displayName || "").trim().slice(0, 256),
    identifiers: uniqueIdentifiers,
    kind
  };
}

function previewIdentitySelectionSelectors(selection = {}) {
  if (selection?.subject?.kind === PREVIEW_IDENTITY_SUBJECT_VIEWER) {
    return selection.subject.identifiers || [];
  }
  const selector = selection?.subject?.selector || selection?.selector;
  return selector ? [selector] : [];
}

function normalizePreviewIdentitySelection(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
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
      ? source.subject
        ? { subject: normalizePreviewIdentitySubject(source.subject) }
        : { selector: normalizePreviewIdentitySelector(source.selector) }
      : {})
  };
}

function previewIdentityGrantScope(previewAuth = {}) {
  const scope = {
    projectScope: String(previewAuth.projectScope || "").trim(),
    sessionId: String(previewAuth.sessionId || "").trim(),
    targetHref: String(previewAuth.targetHref || "").trim(),
    targetRoot: String(previewAuth.targetRoot || "").trim(),
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
    const allowedTypes = normalizedSelection.subject?.kind === PREVIEW_IDENTITY_SUBJECT_VIEWER
      ? previewAuthViewerIdentityTypes(previewAuth)
      : previewAuthIdentityTypes(previewAuth);
    if (
      previewIdentitySelectionSelectors(normalizedSelection)
        .some((selector) => !allowedTypes.includes(selector.type))
    ) {
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

function previewAuthProfilePath({
  sessionRoot = "",
  terminalSessionId = ""
} = {}) {
  return previewAuthRuntimePath({
    filename: "profile.json",
    sessionRoot,
    terminalSessionId
  });
}

function readVibe64SelfPreviewAuthProfile(profilePath = "") {
  return normalizeVibe64SelfPreviewAuthProfile(
    readJsonProfile(profilePath, "Vibe64 self preview auth profile")
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

function readCookiePreviewAuthProfile(profilePath = "") {
  return normalizeCookiePreviewAuthProfile(
    readJsonProfile(profilePath, "cookie preview auth profile")
  );
}

function readJsonProfile(profilePath = "", label = "profile") {
  const normalizedPath = String(profilePath || "").trim();
  if (!normalizedPath) {
    return null;
  }
  let payload;
  try {
    payload = JSON.parse(readFileSync(normalizedPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw new Error(`Cannot read ${label}: ${String(error?.message || error)}`);
  }
  return payload;
}

function normalizeVibe64SelfPreviewAuthProfile(value = {}) {
  if (!value) {
    return null;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Vibe64 self preview auth profile must be an object.");
  }
  const profile = {
    cookieName: String(value.cookieName || "").trim(),
    cookieValue: String(value.cookieValue || "").trim()
  };
  if (!profile.cookieName || !profile.cookieValue) {
    throw new Error("Vibe64 self preview auth profile requires cookieName and cookieValue.");
  }
  return profile;
}

function normalizeCookiePreviewAuthProfile(value = {}) {
  if (!value) {
    return null;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Cookie preview auth profile must be an object.");
  }
  if (!Array.isArray(value.cookies)) {
    throw new Error("Cookie preview auth profile requires a cookies array.");
  }
  const seenNames = new Set();
  const cookies = value.cookies.map((cookie, index) => {
    const normalizedCookie = normalizeCookiePreviewAuthCookie(cookie, index);
    if (seenNames.has(normalizedCookie.name)) {
      throw new Error(`Cookie preview auth profile contains duplicate cookie name ${normalizedCookie.name}.`);
    }
    seenNames.add(normalizedCookie.name);
    return normalizedCookie;
  });
  if (cookies.length === 0) {
    throw new Error("Cookie preview auth profile requires at least one cookie.");
  }
  return {
    cookies
  };
}

function normalizeCookiePreviewAuthCookie(value = {}, index = 0) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Cookie preview auth profile cookie ${index + 1} must be an object.`);
  }
  const name = String(value.name || "").trim();
  const cookieValue = String(value.value ?? "").trim();
  if (!COOKIE_NAME_PATTERN.test(name)) {
    throw new Error(`Cookie preview auth profile cookie ${index + 1} has an invalid name.`);
  }
  if (!cookieValue) {
    throw new Error(`Cookie preview auth profile cookie ${index + 1} requires a value.`);
  }
  return {
    name,
    value: cookieValue
  };
}

export {
  APPLICATION_COMMAND_PREVIEW_AUTH_KIND,
  APPLICATION_PREVIEW_IDENTITY_ENABLED_ENV,
  APPLICATION_PREVIEW_IDENTITY_SECRET_ENV,
  COOKIE_PROFILE_PREVIEW_AUTH_KIND,
  PREVIEW_IDENTITY_CONTROL_PATH,
  PREVIEW_IDENTITY_COMMAND_DIRECTORY,
  PREVIEW_IDENTITY_COMMAND_PROTOCOL,
  PREVIEW_IDENTITY_LOGIN_OPERATION,
  PREVIEW_IDENTITY_LOGOUT_OPERATION,
  PREVIEW_IDENTITY_SELECTOR_EMAIL,
  PREVIEW_IDENTITY_SELECTOR_LOGIN,
  PREVIEW_IDENTITY_SELECTOR_TYPES,
  PREVIEW_IDENTITY_SELECTOR_USER_ID,
  PREVIEW_IDENTITY_SUBJECT_SELECTOR,
  PREVIEW_IDENTITY_SUBJECT_VIEWER,
  VIBE64_SELF_PREVIEW_AUTH_KIND,
  createPreviewAuthSecret,
  createPreviewIdentityGrant,
  normalizePreviewAuthKind,
  normalizePreviewIdentityCommandCapability,
  normalizePreviewIdentitySelector,
  normalizePreviewIdentitySelection,
  previewAuthCookieNames,
  previewAuthCookieHeader,
  previewAuthEnvironment,
  previewAuthIdentityAvailable,
  previewAuthIdentityTypes,
  previewAuthViewerIdentityTypes,
  previewAuthRequiresIdentitySecret,
  previewAuthProfilePath,
  previewAuthSecretPath,
  previewAuthUsesProfile,
  previewIdentityCommandEnvironment,
  readPreviewAuthSecret,
  verifyPreviewIdentityGrant
};
