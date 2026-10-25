import stripAnsi from "strip-ansi";

// Login CLI output as both the server and the browser read it: plain text,
// the device user code it shows, and a redacted tail for debug logs.
const AUTH_DEBUG_OUTPUT_TAIL_LENGTH = 1200;
const DEVICE_USER_CODE_PATTERN = /\b([A-Z0-9]{4}-[A-Z0-9]{4,8})\b/iu;
const DEVICE_USER_CODE_REDACTION_PATTERN = /\b[A-Z0-9]{4}-[A-Z0-9]{4,8}\b/gu;
const OPENAI_API_KEY_REDACTION_PATTERN = /\bsk-[A-Za-z0-9_-]{16,}\b/gu;
// An escape sequence whose ESC byte reached the terminal as a visible "¤".
const VISIBLE_ANSI_ESCAPE_PATTERN = /¤\[[0-?]*[ -/]*[@-~]/gu;

function cleanAuthOutput(output = "") {
  return stripAnsi(String(output || "")).replace(VISIBLE_ANSI_ESCAPE_PATTERN, "");
}

function deviceUserCode(output = "") {
  return cleanAuthOutput(output).match(DEVICE_USER_CODE_PATTERN)?.[1]?.toUpperCase() || "";
}

function redactedAuthOutputTail(output = "") {
  return cleanAuthOutput(output).slice(-AUTH_DEBUG_OUTPUT_TAIL_LENGTH)
    .replace(/https:\/\/[^\s"'<>]+/gu, (url) => {
      try {
        const parsed = new URL(url.replace(/[),.;]+$/u, ""));
        return `${parsed.origin}${parsed.pathname}`;
      } catch {
        return "https://[redacted-url]";
      }
    })
    .replace(DEVICE_USER_CODE_REDACTION_PATTERN, "[redacted-code]")
    .replace(OPENAI_API_KEY_REDACTION_PATTERN, "[redacted-openai-api-key]");
}

export { cleanAuthOutput, deviceUserCode, OPENAI_API_KEY_REDACTION_PATTERN, redactedAuthOutputTail };
