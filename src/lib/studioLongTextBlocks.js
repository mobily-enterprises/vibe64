function parseLongTextReviewBlocks(value) {
  const lines = String(value || "").replace(/\r\n/gu, "\n").split("\n");
  const blocks = [];
  let paragraphLines = [];
  let listBlock = null;
  let codeLines = null;

  const flushParagraph = () => {
    const text = paragraphLines.join(" ").replace(/\s+/gu, " ").trim();
    paragraphLines = [];
    if (text) {
      blocks.push({
        text,
        type: "paragraph"
      });
    }
  };

  const flushList = () => {
    if (listBlock?.items.length) {
      blocks.push(listBlock);
    }
    listBlock = null;
  };

  const flushCode = () => {
    if (codeLines) {
      blocks.push({
        text: codeLines.join("\n").replace(/\n+$/u, ""),
        type: "code"
      });
    }
    codeLines = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/u, "");
    const trimmed = line.trim();

    if (codeLines) {
      if (/^```/u.test(trimmed)) {
        flushCode();
      } else {
        codeLines.push(line);
      }
      continue;
    }

    if (/^```/u.test(trimmed)) {
      flushParagraph();
      flushList();
      codeLines = [];
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/u);
    if (headingMatch) {
      flushParagraph();
      flushList();
      blocks.push({
        level: headingMatch[1].length,
        text: headingMatch[2].trim(),
        type: "heading"
      });
      continue;
    }

    const unorderedMatch = trimmed.match(/^[-*+]\s+(.*)$/u);
    const orderedMatch = trimmed.match(/^\d+[.)]\s+(.*)$/u);
    if (unorderedMatch || orderedMatch) {
      flushParagraph();
      const type = orderedMatch ? "ol" : "ul";
      if (!listBlock || listBlock.type !== type) {
        flushList();
        listBlock = {
          items: [],
          type
        };
      }
      listBlock.items.push({
        text: (orderedMatch?.[1] || unorderedMatch?.[1] || "").trim()
      });
      continue;
    }

    flushList();
    paragraphLines.push(trimmed);
  }

  flushParagraph();
  flushList();
  flushCode();
  return blocks;
}

function parseLongTextInlineParts(value = "") {
  const text = String(value || "");
  const parts = [];
  const pattern = /(`([^`]+)`)|(\*\*([^*]+)\*\*)/gu;
  let cursor = 0;
  let match = pattern.exec(text);
  while (match) {
    if (match.index > cursor) {
      parts.push({
        text: text.slice(cursor, match.index),
        type: "text"
      });
    }
    parts.push({
      text: match[2] || match[4] || "",
      type: match[2] ? "code" : "strong"
    });
    cursor = match.index + match[0].length;
    match = pattern.exec(text);
  }
  if (cursor < text.length) {
    parts.push({
      text: text.slice(cursor),
      type: "text"
    });
  }
  return parts.length ? parts : [{ text, type: "text" }];
}

export {
  parseLongTextInlineParts,
  parseLongTextReviewBlocks
};
