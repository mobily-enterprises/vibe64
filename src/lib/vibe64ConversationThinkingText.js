const THINKING_HEADING_PATTERN = /^thinking(?:\.{3}|…|:)?$/iu;

function normalizeThinkingMessageText(value = "") {
  const lines = String(value || "").trim().split(/\r?\n/u);
  while (lines.length && THINKING_HEADING_PATTERN.test(lines[0].trim())) {
    lines.shift();
  }
  return lines.join("\n").trim();
}

export {
  normalizeThinkingMessageText
};
