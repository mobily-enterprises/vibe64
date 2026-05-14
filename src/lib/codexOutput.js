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
const CODEX_STATUS_LINE_TEXT_PATTERN = /^(?:[>›]\s*)?.*?(?:gpt-[\w.-]+|o\d(?:-[\w.-]+)?)[^\n]*\s·\s(?:\/|[A-Za-z]:\\)[^\n]*?\s{2,}(.+)$/u;
const CODEX_WORKTREE_STATUS_TEXT_PATTERN = /^.*?(?:\/|[A-Za-z]:\\)[^\n]*?\.jskit[^\n]*?\s{2,}(.+)$/u;
const CODEX_MARKER_LINE_PREFIX_PATTERN = "[^\\S\\r\\n]*(?:[•>›]\\s*)?";

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
  return cleanCodexTerminalChromeLine(candidate)
    .trim();
}

function cleanCodexTerminalChromeLine(value) {
  return String(value || "")
    .replace(CODEX_STATUS_LINE_TEXT_PATTERN, "$1")
    .replace(CODEX_WORKTREE_STATUS_TEXT_PATTERN, "$1");
}

function cleanMultilineCodexOutput(value) {
  return String(value || "")
    .split(/\r?\n/u)
    .map(cleanCodexTerminalChromeLine)
    .join("\n")
    .trim();
}

function normalizeMarkedOutput(value, options = {}) {
  const output = String(value || "").trim();
  if (options.singleLine === true || options.formatHint === "text") {
    return cleanSingleLineCodexOutput(output);
  }
  return cleanMultilineCodexOutput(output);
}

function isPlaceholderMarkedOutput(value) {
  return /^<[^>\r\n]+>$/u.test(String(value || "").trim());
}

function markedOutputBlockPattern(marker) {
  const escapedMarker = escapeRegExp(marker);
  return new RegExp(
    `(^|\\n)${CODEX_MARKER_LINE_PREFIX_PATTERN}\\[${escapedMarker}\\][^\\S\\r\\n]*(?:\\r?\\n)([\\s\\S]*?)(?:\\r?\\n)${CODEX_MARKER_LINE_PREFIX_PATTERN}\\[/${escapedMarker}\\][^\\S\\r\\n]*(?=\\r?\\n|$)`,
    "gu"
  );
}

function extractMarkedOutputDetails(value, marker, options = {}) {
  const normalizedMarker = String(marker || "").trim();
  if (!normalizedMarker) {
    return {
      signature: "",
      value: ""
    };
  }

  const source = stripTerminalControlSequences(value);
  const pattern = markedOutputBlockPattern(normalizedMarker);
  let extracted = "";
  let signature = "";
  for (const match of source.matchAll(pattern)) {
    const nextValue = normalizeMarkedOutput(match[2], options);
    if (nextValue && !isPlaceholderMarkedOutput(nextValue)) {
      extracted = nextValue;
      signature = `${match.index}:${match[0].length}`;
    }
  }
  return {
    signature,
    value: extracted
  };
}

function extractMarkedOutput(value, marker, options = {}) {
  return extractMarkedOutputDetails(value, marker, options).value;
}

function suffixPrefixOverlapLength(previousOutput, nextOutput) {
  const previous = String(previousOutput || "");
  const next = String(nextOutput || "");
  const maxLength = Math.min(previous.length, next.length);
  if (maxLength <= 0) {
    return 0;
  }

  const source = `${next.slice(0, maxLength)}\0${previous.slice(previous.length - maxLength)}`;
  const table = new Array(source.length).fill(0);
  for (let index = 1; index < source.length; index += 1) {
    let candidateLength = table[index - 1];
    while (candidateLength > 0 && source[index] !== source[candidateLength]) {
      candidateLength = table[candidateLength - 1];
    }
    if (source[index] === source[candidateLength]) {
      candidateLength += 1;
    }
    table[index] = candidateLength;
  }
  return Math.min(table[table.length - 1] || 0, maxLength);
}

function normalizePromptEcho(value) {
  return stripTerminalControlSequences(value)
    .replace(/\r\n?/gu, "\n")
    .trim();
}

function removeEchoedPromptFromWindow(value, prompt) {
  const source = String(value || "");
  const promptText = String(prompt || "");
  if (!source || !promptText) {
    return source;
  }

  const promptCandidates = [
    promptText,
    promptText.trimEnd(),
    promptText.trim()
  ].filter(Boolean);

  for (const candidate of promptCandidates) {
    if (source.startsWith(candidate)) {
      return source.slice(candidate.length);
    }
    const index = source.indexOf(candidate);
    if (index >= 0 && index <= 2000) {
      return source.slice(index + candidate.length);
    }
  }

  const normalizedSource = normalizePromptEcho(source);
  const normalizedPrompt = normalizePromptEcho(promptText);
  if (!normalizedPrompt) {
    return source;
  }
  if (normalizedSource.startsWith(normalizedPrompt)) {
    return normalizedSource.slice(normalizedPrompt.length);
  }
  const normalizedIndex = normalizedSource.indexOf(normalizedPrompt);
  return normalizedIndex >= 0 && normalizedIndex <= 2000
    ? normalizedSource.slice(normalizedIndex + normalizedPrompt.length)
    : source;
}

function outputAfterPromptStart({
  output = "",
  prompt = "",
  promptOutputSnapshot = "",
  promptStart = null
} = {}) {
  const source = String(output || "");
  const start = Number(promptStart);
  if (Number.isInteger(start) && start >= 0 && start < source.length) {
    return removeEchoedPromptFromWindow(source.slice(start), prompt);
  }

  const snapshot = String(promptOutputSnapshot || "");
  if (snapshot) {
    const overlapLength = suffixPrefixOverlapLength(snapshot, source);
    if (overlapLength > 0) {
      return removeEchoedPromptFromWindow(source.slice(overlapLength), prompt);
    }
  }

  const promptText = String(prompt || "");
  if (!promptText) {
    return source;
  }
  const promptIndex = source.lastIndexOf(promptText);
  return promptIndex >= 0 ? source.slice(promptIndex + promptText.length) : source;
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
  extractMarkedOutputDetails,
  extractMarkedOutput,
  isPlaceholderMarkedOutput,
  isCodexThreadId,
  outputAfterPromptStart,
  suffixPrefixOverlapLength,
  stripTerminalControlSequences
};
