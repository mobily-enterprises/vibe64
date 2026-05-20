import stripAnsi from "strip-ansi";
import {
  STUDIO_CONTEXT_END_MARKER,
  STUDIO_CONTEXT_START_MARKER,
  hasStudioContextBlock,
  wrapPromptWithStudioContext
} from "../../server/lib/aiStudio/promptMarkers.js";

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
const ESCAPE_TERMINAL_STRING_INTRODUCERS = new Set(["]", "P", "X", "^", "_"]);
const STRING_TERMINATORS = new Set([BELL_CHARACTER, STRING_TERMINATOR_CHARACTER]);

function findEscapedStringEnd(source, startIndex) {
  for (let cursor = startIndex; cursor < source.length; cursor += 1) {
    if (source[cursor] === BELL_CHARACTER) {
      return cursor + 1;
    }
    if (source[cursor] === ESCAPE_CHARACTER && source[cursor + 1] === "\\") {
      return cursor + 2;
    }
  }
  return source.length;
}

function findCsiEnd(source, startIndex) {
  for (let cursor = startIndex; cursor < source.length; cursor += 1) {
    const code = source.charCodeAt(cursor);
    if (code >= 0x40 && code <= 0x7e) {
      return cursor + 1;
    }
  }
  return source.length;
}

function findC1StringEnd(source, startIndex) {
  for (let cursor = startIndex; cursor < source.length; cursor += 1) {
    if (STRING_TERMINATORS.has(source[cursor])) {
      return cursor + 1;
    }
    if (source[cursor] === ESCAPE_CHARACTER && source[cursor + 1] === "\\") {
      return cursor + 2;
    }
  }
  return source.length;
}

function terminalControlSequenceEnd(source, index) {
  const character = source[index] || "";
  if (!character) {
    return index;
  }

  if (character === ESCAPE_CHARACTER) {
    const next = source[index + 1] || "";
    if (ESCAPE_TERMINAL_STRING_INTRODUCERS.has(next)) {
      return findEscapedStringEnd(source, index + 2);
    }
    if (next === "[") {
      return findCsiEnd(source, index + 2);
    }
    return Math.min(index + 2, source.length);
  }

  if (character === C1_CSI_CHARACTER) {
    return findCsiEnd(source, index + 1);
  }

  if (C1_TERMINAL_STRING_START_CHARACTERS.includes(character)) {
    return findC1StringEnd(source, index + 1);
  }

  return index;
}

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

function trailingMarkerPrefixLength(value, marker) {
  const source = String(value || "");
  const maxLength = Math.min(source.length, marker.length - 1);
  for (let length = maxLength; length > 0; length -= 1) {
    if (marker.startsWith(source.slice(source.length - length))) {
      return length;
    }
  }
  return 0;
}

function terminalVisibleTextMap(value) {
  const source = String(value || "");
  let text = "";
  const rawIndexes = [];
  for (let cursor = 0; cursor < source.length;) {
    const controlEnd = terminalControlSequenceEnd(source, cursor);
    if (controlEnd > cursor) {
      cursor = controlEnd;
      continue;
    }
    text += source[cursor];
    rawIndexes.push(cursor);
    cursor += 1;
  }
  return {
    rawIndexes,
    text
  };
}

function rawIndexForVisibleOffset(rawIndexes, visibleOffset, fallbackRawIndex) {
  if (visibleOffset >= rawIndexes.length) {
    return fallbackRawIndex;
  }
  return rawIndexes[visibleOffset];
}

function stripStudioContextBlocksForDisplay(value) {
  const source = String(value || "");
  if (!source) {
    return "";
  }
  if (
    !source.includes(STUDIO_CONTEXT_START_MARKER) &&
    !source.includes(STUDIO_CONTEXT_END_MARKER)
  ) {
    return source;
  }

  const { rawIndexes, text } = terminalVisibleTextMap(source);
  let output = "";
  let rawCursor = 0;
  let visibleCursor = 0;
  while (visibleCursor < text.length) {
    const start = text.indexOf(STUDIO_CONTEXT_START_MARKER, visibleCursor);
    if (start < 0) {
      const tail = text.slice(visibleCursor);
      const partialLength = trailingMarkerPrefixLength(tail, STUDIO_CONTEXT_START_MARKER);
      const rawEnd = partialLength > 0
        ? rawIndexForVisibleOffset(rawIndexes, text.length - partialLength, source.length)
        : source.length;
      return `${output}${source.slice(rawCursor, rawEnd)}`
        .replaceAll(STUDIO_CONTEXT_END_MARKER, "");
    }

    output += source.slice(rawCursor, rawIndexes[start]);
    const end = text.indexOf(STUDIO_CONTEXT_END_MARKER, start + STUDIO_CONTEXT_START_MARKER.length);
    if (end < 0) {
      return output;
    }
    visibleCursor = end + STUDIO_CONTEXT_END_MARKER.length;
    rawCursor = rawIndexForVisibleOffset(rawIndexes, visibleCursor, source.length);
  }

  return `${output}${source.slice(rawCursor)}`.replaceAll(STUDIO_CONTEXT_END_MARKER, "");
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
  STUDIO_CONTEXT_END_MARKER,
  STUDIO_CONTEXT_START_MARKER,
  codexTrustPromptLooksActive,
  extractCodexThreadId,
  hasStudioContextBlock,
  isCodexThreadId,
  stripStudioContextBlocksForDisplay,
  stripTerminalControlSequences,
  wrapPromptWithStudioContext
};
