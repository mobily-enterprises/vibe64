import stripAnsi from "strip-ansi";

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

const ESCAPE_CHARACTER = String.fromCharCode(27);
const BELL_CHARACTER = String.fromCharCode(7);
const STRING_TERMINATOR_CHARACTER = String.fromCharCode(156);
const C1_CSI_CHARACTER = String.fromCharCode(155);
const C1_TERMINAL_STRING_START_CHARACTERS = [
  144,
  152,
  157,
  158,
  159
].map((code) => String.fromCharCode(code)).join("");
const STANDALONE_TERMINAL_CONTROL_CHARACTERS = [
  `${String.fromCharCode(0)}-${String.fromCharCode(8)}`,
  String.fromCharCode(11),
  String.fromCharCode(12),
  `${String.fromCharCode(14)}-${String.fromCharCode(31)}`,
  `${String.fromCharCode(127)}-${String.fromCharCode(159)}`
].join("");
const OSC_PATTERN = new RegExp(`${ESCAPE_CHARACTER}\\][\\s\\S]*?(?:${BELL_CHARACTER}|${ESCAPE_CHARACTER}\\\\)`, "gu");
const TERMINAL_STRING_PATTERN = new RegExp(`${ESCAPE_CHARACTER}[PX^_][\\s\\S]*?(?:${BELL_CHARACTER}|${ESCAPE_CHARACTER}\\\\)`, "gu");
const CSI_PATTERN = new RegExp(`${ESCAPE_CHARACTER}\\[[0-?]*[ -/]*[@-~]`, "gu");
const C1_TERMINAL_STRING_PATTERN = new RegExp(`[${C1_TERMINAL_STRING_START_CHARACTERS}][\\s\\S]*?(?:${BELL_CHARACTER}|${STRING_TERMINATOR_CHARACTER}|${ESCAPE_CHARACTER}\\\\)`, "gu");
const C1_CSI_PATTERN = new RegExp(`${C1_CSI_CHARACTER}[0-?]*[ -/]*[@-~]`, "gu");
const ESCAPE_SEQUENCE_PATTERN = new RegExp(`${ESCAPE_CHARACTER}[ -/]*[@-~]`, "gu");
const STANDALONE_TERMINAL_CONTROL_PATTERN = new RegExp(`[${STANDALONE_TERMINAL_CONTROL_CHARACTERS}]`, "gu");
const CODEX_THREAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const CODEX_THREAD_ID_TOKEN_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu;
const CODEX_TRUST_PROMPT_PATTERN = /Do you trust the contents of this directory\?/u;
const CODEX_STATUS_LINE_TEXT_PATTERN = /^(?:[>›]\s*)?.*?(?:gpt-[\w.-]+|o\d(?:-[\w.-]+)?)[^\n]*\s·\s(?:\/|[A-Za-z]:\\)[^\n]*?\s{2,}(.+)$/u;
const CODEX_WORKTREE_STATUS_TEXT_PATTERN = /^.*?(?:\/|[A-Za-z]:\\)[^\n]*?\.jskit[^\n]*?\s{2,}(.+)$/u;
const CODEX_INLINE_STATUS_TRAILER_PATTERN = /[>›][^\r\n]*?(?:gpt-[\w.-]+|o\d(?:-[\w.-]+)?)[^\r\n]*\s·\s(?:\/|[A-Za-z]:\\)[^\r\n]*$/u;
const CODEX_MARKER_LINE_PREFIX_PATTERN = "[^\\S\\r\\n]*(?:[•>›]\\s*)?";

function stripTerminalControlSequences(value) {
  const source = String(value || "")
    .replace(OSC_PATTERN, "")
    .replace(TERMINAL_STRING_PATTERN, "")
    .replace(CSI_PATTERN, "")
    .replace(C1_TERMINAL_STRING_PATTERN, "")
    .replace(C1_CSI_PATTERN, "")
    .replace(ESCAPE_SEQUENCE_PATTERN, "");
  return stripAnsi(source)
    .replace(STANDALONE_TERMINAL_CONTROL_PATTERN, "");
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
  const source = String(value || "");
  const fullLineCleaned = source
    .replace(CODEX_STATUS_LINE_TEXT_PATTERN, "$1")
    .replace(CODEX_WORKTREE_STATUS_TEXT_PATTERN, "$1");
  if (fullLineCleaned !== source) {
    return fullLineCleaned;
  }
  return source.replace(CODEX_INLINE_STATUS_TRAILER_PATTERN, "");
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

function markedOutputLinePattern(marker) {
  const escapedMarker = escapeRegExp(marker);
  return new RegExp(
    `(^|\\n)${CODEX_MARKER_LINE_PREFIX_PATTERN}\\[(/?)${escapedMarker}\\][^\\S\\r\\n]*(?=\\r?\\n|$)`,
    "gu"
  );
}

function normalizeMarkedOutputSource(value, marker) {
  const escapedMarker = escapeRegExp(marker);
  const markerLine = new RegExp(
    `^${CODEX_MARKER_LINE_PREFIX_PATTERN}\\[(/?)${escapedMarker}\\][^\\r\\n]*$`,
    "u"
  );
  return stripTerminalControlSequences(value)
    .split(/\r?\n/u)
    .map((line) => line.replace(markerLine, (_match, slash) => `[${slash || ""}${marker}]`))
    .join("\n");
}

function nextLineStartIndex(source, markerLineEndIndex) {
  if (source.slice(markerLineEndIndex, markerLineEndIndex + 2) === "\r\n") {
    return markerLineEndIndex + 2;
  }
  if (source[markerLineEndIndex] === "\n") {
    return markerLineEndIndex + 1;
  }
  return markerLineEndIndex;
}

function extractMarkedOutputBlocks(value, marker, options = {}) {
  const normalizedMarker = String(marker || "").trim();
  if (!normalizedMarker) {
    return [];
  }

  const source = normalizeMarkedOutputSource(value, normalizedMarker);
  const pattern = markedOutputLinePattern(normalizedMarker);
  const blocks = [];
  let currentOpen = null;
  for (const match of source.matchAll(pattern)) {
    const markerLineStart = match.index + match[1].length;
    const markerLineEnd = match.index + match[0].length;
    const markerIsClosing = match[2] === "/";
    if (!markerIsClosing) {
      currentOpen = {
        contentStart: nextLineStartIndex(source, markerLineEnd),
        markerStart: markerLineStart
      };
      continue;
    }
    if (!currentOpen) {
      continue;
    }
    const contentEnd = markerLineStart - match[1].length;
    const nextValue = normalizeMarkedOutput(source.slice(currentOpen.contentStart, contentEnd), options);
    if (nextValue && !isPlaceholderMarkedOutput(nextValue)) {
      blocks.push({
        signature: `${currentOpen.markerStart}:${markerLineEnd - currentOpen.markerStart}`,
        value: nextValue
      });
    }
    currentOpen = null;
  }
  return blocks;
}

function extractMarkedOutputDetails(value, marker, options = {}) {
  const blocks = extractMarkedOutputBlocks(value, marker, options);
  const latestBlock = blocks.at(-1);
  if (latestBlock) {
    return latestBlock;
  }
  return {
    signature: "",
    value: ""
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
  extractMarkedOutputBlocks,
  extractMarkedOutputDetails,
  extractMarkedOutput,
  isPlaceholderMarkedOutput,
  isCodexThreadId,
  outputAfterPromptStart,
  suffixPrefixOverlapLength,
  stripTerminalControlSequences
};
