import {
  DEFAULT_VIBE64_LOG_LEVEL,
  resolveVibe64LogLevel
} from "../shared/logging.js";

const VIBE64_LOG_REDACT_PATHS = Object.freeze([
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers['set-cookie']",
  "res.headers['set-cookie']",
  "*.authorization",
  "*.cookie",
  "*.credential",
  "*.credentials",
  "*.databaseUrl",
  "*.database_url",
  "*.dsn",
  "*.password",
  "*.secret",
  "*.token",
  "*.apiToken",
  "*.api_token",
  "*.apiKey",
  "*.api_key",
  "*.accessToken",
  "*.access_token",
  "*.refreshToken",
  "*.refresh_token"
]);
const VIBE64_LOG_REDACTED_VALUE = "[redacted]";
const VIBE64_LOG_SECRET_FIELD_PATTERN = /(?:authorization|password|passphrase|token|secret|credential|api[_-]?key|api[_-]?token|access[_-]?token|refresh[_-]?token|database[_-]?url|dsn)/iu;
const VIBE64_LOG_SECRET_ASSIGNMENT_PATTERN = /\b((?:DATABASE[_-]?URL|DSN)|(?:[A-Za-z_][A-Za-z0-9_-]*?)?(?:PASSWORD|PASS|PASSPHRASE|TOKEN|SECRET|CREDENTIAL|API[_-]?KEY|API[_-]?TOKEN|ACCESS[_-]?TOKEN|REFRESH[_-]?TOKEN|DSN)[A-Za-z0-9_-]*)\b(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu;
const VIBE64_LOG_AUTH_VALUE_PATTERN = /\b(authorization|proxy-authorization)\b(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|(?:Bearer|Basic)\s+[^\s,;]+|[^\s,;]+)/giu;
const VIBE64_LOG_BEARER_PATTERN = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/giu;
const VIBE64_LOG_URL_CREDENTIALS_PATTERN = /\b([a-z][a-z0-9+.-]*:\/\/)([^/@\s:]+):([^/@\s]+)@/giu;
const VIBE64_STREAM_REDACTION_PENDING_LIMIT = 65536;

function createVibe64FastifyLoggerOptions({
  defaultLevel = DEFAULT_VIBE64_LOG_LEVEL,
  env = globalThis?.process?.env || {},
  level = ""
} = {}) {
  const resolved = resolveVibe64LogLevel({
    defaultLevel,
    env,
    level
  });
  const warnings = resolved.valid
    ? []
    : [
        {
          defaultLevel: resolved.defaultLevel,
          requestedLevel: resolved.requestedLevel,
          source: resolved.source
        }
      ];
  const logger = resolved.level === "silent"
    ? false
    : {
        level: resolved.level,
        redact: {
          censor: "[redacted]",
          paths: [...VIBE64_LOG_REDACT_PATHS]
        }
      };

  return {
    level: resolved.level,
    logger,
    warnings
  };
}

function normalizeLogEventName(value = "", fallback = "vibe64.operational_event") {
  const normalized = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_.:-]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
  return normalized || fallback;
}

function shouldRedactLogField(key = "") {
  return VIBE64_LOG_SECRET_FIELD_PATTERN.test(String(key || ""));
}

function sanitizeLogText(value = "") {
  return String(value || "")
    .replace(VIBE64_LOG_AUTH_VALUE_PATTERN, `$1$2${VIBE64_LOG_REDACTED_VALUE}`)
    .replace(VIBE64_LOG_BEARER_PATTERN, `$1 ${VIBE64_LOG_REDACTED_VALUE}`)
    .replace(VIBE64_LOG_SECRET_ASSIGNMENT_PATTERN, `$1$2${VIBE64_LOG_REDACTED_VALUE}`)
    .replace(VIBE64_LOG_URL_CREDENTIALS_PATTERN, `$1${VIBE64_LOG_REDACTED_VALUE}@`);
}

function createStreamingLogSanitizer({
  pendingLimit = VIBE64_STREAM_REDACTION_PENDING_LIMIT,
  secrets = []
} = {}) {
  const exactSecrets = normalizedRedactionSecrets(secrets);
  const maxSecretLength = exactSecrets.reduce((maximum, secret) => (
    Math.max(maximum, secret.length)
  ), 0);
  const maximumPending = Math.max(
    1024,
    Number.isSafeInteger(pendingLimit) ? pendingLimit : VIBE64_STREAM_REDACTION_PENDING_LIMIT,
    maxSecretLength * 2
  );
  let pending = "";

  function push(value = "") {
    pending += String(value || "");
    const completeLineEnd = pending.lastIndexOf("\n") + 1;
    let cut = completeLineEnd;
    if (cut === 0 && pending.length > maximumPending) {
      cut = pending.length - Math.max(512, maxSecretLength - 1);
    }
    cut = safeRedactionCut(pending, cut, exactSecrets);
    if (cut <= 0) {
      return "";
    }
    const output = sanitizeOperationText(pending.slice(0, cut), exactSecrets);
    pending = pending.slice(cut);
    return output;
  }

  function flush() {
    const output = sanitizeOperationText(pending, exactSecrets);
    pending = "";
    return output;
  }

  return Object.freeze({
    flush,
    push
  });
}

function normalizedRedactionSecrets(secrets = []) {
  return [...new Set((Array.isArray(secrets) ? secrets : [])
    .map((secret) => String(secret || ""))
    .filter((secret) => secret.length >= 4))]
    .sort((left, right) => right.length - left.length);
}

function safeRedactionCut(value = "", requestedCut = 0, secrets = []) {
  let cut = Math.max(0, Math.min(String(value).length, Number(requestedCut) || 0));
  for (const secret of secrets) {
    const occurrence = String(value).lastIndexOf(secret, cut - 1);
    if (occurrence >= 0 && occurrence < cut && occurrence + secret.length > cut) {
      cut = occurrence;
    }
  }
  return cut;
}

function sanitizeOperationText(value = "", secrets = []) {
  let output = sanitizeLogText(value);
  for (const secret of secrets) {
    output = output.split(secret).join(VIBE64_LOG_REDACTED_VALUE);
  }
  return output;
}

function redactLogValue(value, {
  field = "",
  seen = new WeakSet()
} = {}) {
  if (shouldRedactLogField(field)) {
    return VIBE64_LOG_REDACTED_VALUE;
  }
  if (typeof value === "string") {
    return sanitizeLogText(value);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  if (value instanceof Error) {
    return {
      code: String(value.code || ""),
      message: sanitizeLogText(value.message),
      name: String(value.name || "Error")
    };
  }
  if (seen.has(value)) {
    return "[circular]";
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((entry) => redactLogValue(entry, {
      seen
    }));
  }
  return Object.fromEntries(Object.entries(value)
    .map(([key, entry]) => [key, redactLogValue(entry, {
      field: key,
      seen
    })]));
}

function operationalLogFields(fields = {}) {
  const source = fields && typeof fields === "object" && !Array.isArray(fields)
    ? fields
    : {};
  return redactLogValue({
    ...source,
    component: normalizeLogEventName(source.component, "vibe64"),
    event: normalizeLogEventName(source.event, "vibe64.operational_event")
  });
}

function logOperationalEvent(logger, level = "info", fields = {}, message = "") {
  const log = logger?.[level];
  if (typeof log !== "function") {
    return false;
  }
  log.call(logger, operationalLogFields(fields), message);
  return true;
}

export {
  createVibe64FastifyLoggerOptions,
  createStreamingLogSanitizer,
  DEFAULT_VIBE64_LOG_LEVEL,
  logOperationalEvent,
  operationalLogFields,
  redactLogValue,
  sanitizeLogText,
  sanitizeOperationText,
  shouldRedactLogField,
  VIBE64_LOG_REDACT_PATHS,
  VIBE64_LOG_REDACTED_VALUE,
  VIBE64_LOG_SECRET_ASSIGNMENT_PATTERN,
  VIBE64_LOG_SECRET_FIELD_PATTERN
};
