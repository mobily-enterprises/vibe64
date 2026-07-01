function parseLongTextReviewBlocks(value, options = {}) {
  const lines = expandCompactPipeTableLines(String(value || "").replace(/\r\n/gu, "\n").split("\n"));
  const blocks = [];
  let paragraphLines = [];
  let listBlock = null;
  let codeLines = null;
  let detailsBlock = null;
  const preserveParagraphLineBreaks = options.preserveParagraphLineBreaks === true;

  const parseDetailsOpening = (trimmed = "") => {
    if (trimmed === "<details>") {
      return {
        closed: false,
        remainder: "",
        summary: "Details"
      };
    }
    const inlineMatch = trimmed.match(/^<details>\s*<summary>\s*(.*?)\s*<\/summary>\s*(.*)$/u);
    if (!inlineMatch) {
      return null;
    }
    let remainder = inlineMatch[2] || "";
    let closed = false;
    const closingMatch = remainder.match(/^(.*?)\s*<\/details>$/u);
    if (closingMatch) {
      remainder = closingMatch[1] || "";
      closed = true;
    }
    return {
      closed,
      remainder: remainder.trim(),
      summary: inlineMatch[1].trim() || "Details"
    };
  };

  const flushParagraph = () => {
    const text = preserveParagraphLineBreaks
      ? paragraphLines.join("\n").trim()
      : paragraphLines.join(" ").replace(/\s+/gu, " ").trim();
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

  const flushDetails = () => {
    if (detailsBlock) {
      blocks.push({
        blocks: parseLongTextReviewBlocks(detailsBlock.lines.join("\n"), options),
        summary: detailsBlock.summary || "Details",
        type: "details"
      });
    }
    detailsBlock = null;
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const rawLine = lines[lineIndex];
    const line = rawLine.replace(/\s+$/u, "");
    const trimmed = line.trim();

    if (detailsBlock) {
      const summaryMatch = trimmed.match(/^<summary>\s*(.*?)\s*<\/summary>$/u);
      const closingMatch = trimmed.match(/^(.*?)\s*<\/details>$/u);
      if (/^<\/details>$/u.test(trimmed)) {
        flushDetails();
      } else if (closingMatch) {
        const beforeClose = closingMatch[1].trim();
        if (beforeClose) {
          detailsBlock.lines.push(beforeClose);
        }
        flushDetails();
      } else if (summaryMatch) {
        detailsBlock.summary = summaryMatch[1].trim() || detailsBlock.summary;
      } else {
        detailsBlock.lines.push(line);
      }
      continue;
    }

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

    const detailsOpening = parseDetailsOpening(trimmed);
    if (detailsOpening) {
      flushParagraph();
      flushList();
      detailsBlock = {
        lines: detailsOpening.remainder ? [detailsOpening.remainder] : [],
        summary: detailsOpening.summary
      };
      if (detailsOpening.closed) {
        flushDetails();
      }
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    const tableBlock = parsePipeTableAt(lines, lineIndex);
    if (tableBlock) {
      flushParagraph();
      flushList();
      blocks.push(tableBlock.block);
      lineIndex = tableBlock.endIndex;
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

    const unorderedMatch = trimmed.match(/^[-*+•]\s+(.*)$/u);
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
  flushDetails();
  return blocks;
}

function expandCompactPipeTableLines(lines = []) {
  return lines.flatMap((line) => {
    const text = String(line || "");
    const trimmed = text.trim();
    const compactRowBoundaries = text.match(/\|\s+\|/gu) || [];
    if (!trimmed.startsWith("|") || compactRowBoundaries.length < 2) {
      return [line];
    }
    const expandedLines = text.replace(/\|\s+\|/gu, "|\n|").split("\n");
    if (!tableAlignments(parsePipeTableRow(expandedLines[1]))) {
      return [line];
    }
    return expandedLines;
  });
}

function parsePipeTableAt(lines = [], startIndex = 0) {
  const headers = parsePipeTableRow(lines[startIndex]);
  const alignments = tableAlignments(parsePipeTableRow(lines[startIndex + 1]));
  if (!headers || !alignments || headers.length !== alignments.length) {
    return null;
  }
  if (!headers.some((header) => header)) {
    return null;
  }

  const rows = [];
  let rowIndex = startIndex + 2;
  while (rowIndex < lines.length) {
    const row = parsePipeTableRow(lines[rowIndex]);
    if (!row || row.length !== headers.length) {
      break;
    }
    rows.push(row);
    rowIndex += 1;
  }

  return {
    block: {
      alignments,
      headers,
      rows,
      type: "table"
    },
    endIndex: rowIndex - 1
  };
}

function parsePipeTableRow(value = "") {
  const trimmed = String(value || "").trim();
  if (!trimmed.startsWith("|") || !trimmed.includes("|", 1)) {
    return null;
  }
  const cells = trimmed
    .replace(/^\|/u, "")
    .replace(/\|$/u, "")
    .split("|")
    .map((cell) => cell.trim());
  return cells.length >= 2 ? cells : null;
}

function tableAlignments(cells = null) {
  if (!Array.isArray(cells) || !cells.length) {
    return null;
  }
  const alignments = [];
  for (const cell of cells) {
    const marker = String(cell || "").replace(/\s+/gu, "");
    if (!/^:?-{3,}:?$/u.test(marker)) {
      return null;
    }
    if (marker.startsWith(":") && marker.endsWith(":")) {
      alignments.push("center");
    } else if (marker.endsWith(":")) {
      alignments.push("right");
    } else {
      alignments.push("left");
    }
  }
  return alignments;
}

function pushInlineTextPart(parts = [], text = "") {
  if (!text) {
    return;
  }
  const previous = parts.at(-1);
  if (previous?.type === "text") {
    previous.text += text;
    return;
  }
  parts.push({
    text,
    type: "text"
  });
}

function closingMarkdownBracketIndex(text = "", start = 0) {
  let depth = 1;
  for (let index = start + 1; index < text.length; index += 1) {
    const character = text[index];
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (character === "[") {
      depth += 1;
    } else if (character === "]") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function closingMarkdownDestinationIndex(text = "", start = 0) {
  for (let index = start + 1; index < text.length; index += 1) {
    if (text[index] === "\\") {
      index += 1;
      continue;
    }
    if (text[index] === ")") {
      return index;
    }
  }
  return -1;
}

function normalizeMarkdownLinkHref(value = "") {
  return String(value || "").trim().replace(/^<|>$/gu, "");
}

function markdownLinkAt(text = "", start = 0) {
  if (text[start] !== "[") {
    return null;
  }
  const labelEnd = closingMarkdownBracketIndex(text, start);
  if (labelEnd === -1 || text[labelEnd + 1] !== "(") {
    return null;
  }
  const destinationStart = labelEnd + 1;
  const destinationEnd = closingMarkdownDestinationIndex(text, destinationStart);
  if (destinationEnd === -1) {
    return null;
  }
  const label = text.slice(start + 1, labelEnd);
  const href = normalizeMarkdownLinkHref(text.slice(destinationStart + 1, destinationEnd));
  if (!label || !href) {
    return null;
  }
  return {
    end: destinationEnd + 1,
    href,
    text: label
  };
}

function parseLongTextInlineParts(value = "") {
  const text = String(value || "");
  const parts = [];
  let cursor = 0;
  while (cursor < text.length) {
    if (text[cursor] === "[") {
      const link = markdownLinkAt(text, cursor);
      if (link) {
        parts.push({
          href: link.href,
          text: link.text,
          type: "link"
        });
        cursor = link.end;
        continue;
      }
    }

    if (text[cursor] === "`") {
      const end = text.indexOf("`", cursor + 1);
      if (end > cursor + 1) {
        parts.push({
          text: text.slice(cursor + 1, end),
          type: "code"
        });
        cursor = end + 1;
        continue;
      }
    }

    if (text.startsWith("**", cursor)) {
      const end = text.indexOf("**", cursor + 2);
      if (end > cursor + 2) {
        parts.push({
          text: text.slice(cursor + 2, end),
          type: "strong"
        });
        cursor = end + 2;
        continue;
      }
    }

    pushInlineTextPart(parts, text[cursor]);
    cursor += 1;
  }
  return parts.length ? parts : [{ text, type: "text" }];
}

export {
  parseLongTextInlineParts,
  parseLongTextReviewBlocks
};
