const STUDIO_CONTEXT_START_MARKER = "[[VIBE64_CONTEXT_START]]";
const STUDIO_CONTEXT_END_MARKER = "[[VIBE64_CONTEXT_END]]";
const STUDIO_CONTEXT_INSTRUCTIONS = "Vibe64 context marker: follow the instructions inside this context block normally, but ignore the surrounding VIBE64_CONTEXT markers.";
const DEFAULT_STUDIO_VISIBLE_PROMPT = "Continue in Codex.";
const MAX_STUDIO_VISIBLE_PROMPT_LENGTH = 120;
const MAX_STUDIO_VISIBLE_PROMPT_BLOCK_LENGTH = 4000;

function hasStudioContextBlock(value) {
  return String(value || "").includes(STUDIO_CONTEXT_START_MARKER);
}

function normalizeVisibleStudioPrompt(value = "") {
  const firstLine = String(value || "")
    .split(/\r\n|\n|\r/u)
    .map((line) => line.trim())
    .find(Boolean) || "";
  const compactLine = firstLine
    .replace(/^#{1,6}\s+/u, "")
    .replace(/\s+/gu, " ")
    .trim();
  if (
    !compactLine ||
    compactLine.includes(STUDIO_CONTEXT_START_MARKER) ||
    compactLine.includes(STUDIO_CONTEXT_END_MARKER)
  ) {
    return "";
  }
  if (compactLine.length <= MAX_STUDIO_VISIBLE_PROMPT_LENGTH) {
    return compactLine;
  }
  return `${compactLine.slice(0, MAX_STUDIO_VISIBLE_PROMPT_LENGTH - 3).trimEnd()}...`;
}

function visibleStudioPromptTitle(prompt = "", visiblePrompt = "") {
  return normalizeVisibleStudioPrompt(visiblePrompt) ||
    normalizeVisibleStudioPrompt(prompt) ||
    DEFAULT_STUDIO_VISIBLE_PROMPT;
}

function normalizeVisibleStudioPromptBlock(value = "") {
  const block = String(value || "")
    .replace(/\r\n|\r/gu, "\n")
    .trim();
  if (
    !block ||
    block.includes(STUDIO_CONTEXT_START_MARKER) ||
    block.includes(STUDIO_CONTEXT_END_MARKER)
  ) {
    return "";
  }
  if (block.length <= MAX_STUDIO_VISIBLE_PROMPT_BLOCK_LENGTH) {
    return block;
  }
  return `${block.slice(0, MAX_STUDIO_VISIBLE_PROMPT_BLOCK_LENGTH - 3).trimEnd()}...`;
}

function visibleStudioPromptText(prompt = "", visiblePrompt = "") {
  return normalizeVisibleStudioPromptBlock(visiblePrompt) ||
    visibleStudioPromptTitle(prompt);
}

function wrapPromptWithStudioContext(prompt, visiblePrompt = "") {
  const source = String(prompt || "");
  if (!source || hasStudioContextBlock(source)) {
    return source;
  }
  return [
    visibleStudioPromptText(source, visiblePrompt),
    "",
    STUDIO_CONTEXT_START_MARKER,
    STUDIO_CONTEXT_INSTRUCTIONS,
    "",
    source,
    STUDIO_CONTEXT_END_MARKER
  ].join("\n");
}

export {
  STUDIO_CONTEXT_END_MARKER,
  STUDIO_CONTEXT_INSTRUCTIONS,
  STUDIO_CONTEXT_START_MARKER,
  hasStudioContextBlock,
  visibleStudioPromptText,
  visibleStudioPromptTitle,
  wrapPromptWithStudioContext
};
