function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

const ESCAPE_CHARACTER = String.fromCharCode(27);
const BELL_CHARACTER = String.fromCharCode(7);
const OSC_PATTERN = new RegExp(`${ESCAPE_CHARACTER}\\][\\s\\S]*?(?:${BELL_CHARACTER}|${ESCAPE_CHARACTER}\\\\)`, "gu");
const CSI_PATTERN = new RegExp(`${ESCAPE_CHARACTER}\\[[0-?]*[ -/]*[@-~]`, "gu");
const CODEX_THREAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const CODEX_THREAD_ID_TOKEN_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu;
const CODEX_TRUST_PROMPT_PATTERN = /Do you trust the contents of this directory\?/u;
const CODEX_STATUS_LINE_TEXT_PATTERN = /^(?:[>›]\s*)?.*?\b(?:gpt-[\w.-]+|o\d(?:-[\w.-]+)?)\b[^\n]*\s·\s(?:\/|[A-Za-z]:\\)[^\n]*?\s{2,}(.+)$/u;
const CODEX_WORKTREE_STATUS_TEXT_PATTERN = /^.*?(?:\/|[A-Za-z]:\\)[^\n]*?\.jskit[^\n]*?\s{2,}(.+)$/u;

function stripTerminalControlSequences(value) {
  return String(value || "")
    .replace(OSC_PATTERN, "")
    .replace(CSI_PATTERN, "");
}

function cleanSingleLineCodexOutput(value) {
  const candidate = String(value || "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1) || "";
  return candidate
    .replace(CODEX_STATUS_LINE_TEXT_PATTERN, "$1")
    .replace(CODEX_WORKTREE_STATUS_TEXT_PATTERN, "$1")
    .trim();
}

function normalizeMarkedOutput(value, options = {}) {
  const output = String(value || "").trim();
  if (options.singleLine === true || options.formatHint === "text") {
    return cleanSingleLineCodexOutput(output);
  }
  return output;
}

function extractMarkedOutput(value, marker, options = {}) {
  const normalizedMarker = String(marker || "").trim();
  if (!normalizedMarker) {
    return "";
  }

  const source = stripTerminalControlSequences(value);
  const pattern = new RegExp(
    `\\[${escapeRegExp(normalizedMarker)}\\]([\\s\\S]*?)\\[/${escapeRegExp(normalizedMarker)}\\]`,
    "gu"
  );
  let extracted = "";
  for (const match of source.matchAll(pattern)) {
    const nextValue = normalizeMarkedOutput(match[1], options);
    if (nextValue) {
      extracted = nextValue;
    }
  }
  return extracted;
}

function isCodexThreadId(value) {
  return CODEX_THREAD_ID_PATTERN.test(String(value || "").trim());
}

function codexTrustPromptLooksActive(output) {
  const source = stripTerminalControlSequences(output);
  const promptIndex = source.search(CODEX_TRUST_PROMPT_PATTERN);
  if (promptIndex < 0) {
    return false;
  }
  const promptTail = source.slice(promptIndex);
  return promptTail.includes("Yes, continue") &&
    promptTail.includes("No, quit") &&
    promptTail.includes("Press enter to continue");
}

function extractCodexThreadId(output) {
  const lines = stripTerminalControlSequences(output)
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let lineIndex = lines.length - 1; lineIndex >= 0; lineIndex -= 1) {
    if (!lines[lineIndex].includes("CODEX_THREAD_ID")) {
      continue;
    }
    for (const nextLine of lines.slice(lineIndex + 1, lineIndex + 8)) {
      CODEX_THREAD_ID_TOKEN_PATTERN.lastIndex = 0;
      const token = [...nextLine.matchAll(CODEX_THREAD_ID_TOKEN_PATTERN)]
        .map((match) => match[0])
        .find(isCodexThreadId);
      if (token) {
        return token.toLowerCase();
      }
    }
  }

  return "";
}

export {
  cleanSingleLineCodexOutput,
  codexTrustPromptLooksActive,
  extractCodexThreadId,
  extractMarkedOutput,
  isCodexThreadId,
  stripTerminalControlSequences
};
