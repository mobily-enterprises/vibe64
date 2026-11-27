import { sanitizeOperationText, shouldRedactLogField, VIBE64_LOG_REDACTED_VALUE } from "./logging.js";

// The most of a failed command's own words a message carries: enough for a person or an AI to see why.
const COMMAND_FAILURE_DETAIL_LENGTH = 500;
// A secret is redacted only when it is long enough not to be an ordinary word of the output.
const COMMAND_FAILURE_SECRET_MIN_LENGTH = 8;
// eslint-disable-next-line no-control-regex -- a terminal escape is removed: the detail is plain text
const TERMINAL_ESCAPE_PATTERN = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|[@-Z\\-_])/gu;
// eslint-disable-next-line no-control-regex -- control characters other than newline and tab are removed
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/gu;
// A cookie's value never leaves in a message: whatever follows a Set-Cookie or Cookie header, or a cookie word
// followed by a name=value pair, on its line.
const COOKIE_TEXT_PATTERN = /\b(set-?cookies?|cookies?)\b(["']?\s*[:=]\s*|\s+(?=[!#$%&'*+.^_`|~0-9A-Za-z-]+=))[^\r\n]*/giu;

/** A command's stdout or stderr as text, whichever encoding the run captured it in. */
function decodedOutput(result, field) {
  const value = String(result[field] ?? "");
  return result.outputEncoding === "base64" ? Buffer.from(value, "base64").toString("utf8") : value;
}

/**
 * An Env's values long enough to be secrets, for `secrets`: all of them (a command's own small Env), or with
 * `secretNamesOnly` those whose names say secret (a project's whole Env, whose other values say why it failed).
 * @param {Record<string, unknown> | null | undefined} env
 * @param {{ secretNamesOnly?: boolean }} [options]
 */
function commandFailureSecrets(env = {}, { secretNamesOnly = false } = {}) {
  return [...new Set(Object.entries(env && typeof env === "object" && !Array.isArray(env) ? env : {})
    .filter(([name]) => !secretNamesOnly || shouldRedactLogField(name))
    .map(([, value]) => String(value ?? ""))
    .filter((value) => value.length >= COMMAND_FAILURE_SECRET_MIN_LENGTH))];
}

/** Plain text with secrets, credentials and cookie values redacted. */
function redactedPlainText(value = "", secrets = []) {
  const text = String(value ?? "")
    .replace(TERMINAL_ESCAPE_PATTERN, "")
    .replace(/\r\n?/gu, "\n")
    .replace(CONTROL_CHARACTER_PATTERN, "");
  return sanitizeOperationText(text, secrets.filter((secret) => String(secret || "").length >= COMMAND_FAILURE_SECRET_MIN_LENGTH))
    .replace(COOKIE_TEXT_PATTERN, `$1$2${VIBE64_LOG_REDACTED_VALUE}`);
}

/** The text's last lines within the bound, starting on a whole line when one fits. */
function lastLines(text = "", maxLength = COMMAND_FAILURE_DETAIL_LENGTH) {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) return trimmed;
  const tail = trimmed.slice(-maxLength);
  const lineStart = tail.indexOf("\n");
  return `…${lineStart >= 0 && lineStart < tail.length - 1 ? tail.slice(lineStart + 1) : tail}`;
}

/** A protocol answer on stdout: one JSON object, or null. */
function protocolAnswer(stdout = "") {
  try {
    const value = JSON.parse(stdout.trim());
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * What a failed command said: a protocol answer's `code` and `error` when its stdout is one JSON object, otherwise the
 * last lines of its stderr (of its stdout when it wrote no stderr). Plain text, at most COMMAND_FAILURE_DETAIL_LENGTH
 * characters, with credentials, cookie values and the given secrets (its Env values, commandFailureSecrets) redacted.
 * A JSON answer is never quoted whole: it may carry the session cookies it set.
 * @param {{ stdout?: string, stderr?: string, outputEncoding?: string }} result runVibe64Command's result
 * @param {{ secrets?: string[] }} [options]
 */
function commandFailureOutput(result, { secrets = [] } = {}) {
  const record = result ?? {};
  const stdout = decodedOutput(record, "stdout");
  const answer = protocolAnswer(stdout);
  if (answer) {
    const said = [answer.code, answer.error]
      .map((value) => typeof value === "string" ? redactedPlainText(value, secrets).replace(/\s+/gu, " ").trim() : "")
      .filter(Boolean)
      .join(": ");
    if (said) return lastLines(said);
  }
  const stderr = decodedOutput(record, "stderr");
  return lastLines(redactedPlainText(stderr.trim() || (answer ? "" : stdout), secrets));
}

/** How a failed command ended: "timed out", "ended by SIGKILL" or "exit status 1". */
function commandFailureStatus(result) {
  const { exitCode, signal = "", timedOut } = result ?? {};
  if (timedOut === true) return "timed out";
  if (String(signal || "").trim()) return `ended by ${String(signal).trim()}`;
  return Number.isSafeInteger(exitCode) ? `exit status ${exitCode}` : "";
}

/**
 * A failed captured command's message: the caller's words, how the command ended, and what it said
 * (commandFailureOutput), e.g. "Application preview identity command failed (exit status 1): code: why."
 * Every message made from a failed capture keeps the command's own words this way, so a person and an AI can see
 * why it failed (tests/server/commandFailureDetailRule.unit.test.js).
 * @param {string} message
 * @param {object} result runVibe64Command's result
 * @param {{ secrets?: string[] }} [options]
 */
function commandFailureMessage(message, result, options = {}) {
  const base = String(message || "The command failed.").trim().replace(/[.:]$/u, "");
  const status = commandFailureStatus(result);
  const said = commandFailureOutput(result, options);
  return `${base}${status ? ` (${status})` : ""}${said ? `: ${said}` : "."}`;
}

export {
  COMMAND_FAILURE_DETAIL_LENGTH,
  commandFailureMessage,
  commandFailureOutput,
  commandFailureSecrets,
  commandFailureStatus
};
