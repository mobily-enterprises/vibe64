const STUDIO_CONTEXT_START_MARKER = "[[AI_STUDIO_CONTEXT_START]]";
const STUDIO_CONTEXT_END_MARKER = "[[AI_STUDIO_CONTEXT_END]]";
const STUDIO_CONTEXT_INSTRUCTIONS = "AI Studio context marker: follow the instructions inside this context block normally, but ignore the surrounding AI_STUDIO_CONTEXT markers.";

function hasStudioContextBlock(value) {
  return String(value || "").includes(STUDIO_CONTEXT_START_MARKER);
}

function wrapPromptWithStudioContext(prompt, visiblePrompt = "") {
  const source = String(prompt || "");
  if (!source || hasStudioContextBlock(source)) {
    return source;
  }
  const visible = String(visiblePrompt || "Run Codex prompt.").trim() || "Run Codex prompt.";
  return [
    visible,
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
  wrapPromptWithStudioContext
};
