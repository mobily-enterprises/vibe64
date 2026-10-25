function normalizeSourceRoot(value = "") {
  return String(value || "").trim().replace(/\/+$/u, "");
}

function safeDecodePath(value = "") {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return String(value || "");
  }
}

function stripFileUrl(value = "") {
  const text = String(value || "").trim();
  if (!text.startsWith("file://")) {
    return text;
  }
  try {
    return new URL(text).pathname;
  } catch {
    return text.replace(/^file:\/\//u, "");
  }
}

function splitLineSuffix(value = "") {
  const text = String(value || "").trim();
  const match = text.match(/^(.*?)(?::(\d+)(?:-\d+)?)(?::(\d+))?$/u);
  if (!match) {
    return {
      column: 0,
      line: 0,
      path: text
    };
  }
  return {
    column: Number(match[3] || 0) || 0,
    line: Number(match[2] || 0) || 0,
    path: match[1]
  };
}

function normalizeRelativeSourcePath(value = "") {
  const normalized = String(value || "")
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\.\/+/u, "")
    .replace(/\/+/gu, "/");
  if (
    !normalized ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.startsWith("/") ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(normalized)
  ) {
    return "";
  }
  return normalized;
}

function sessionRelativeSourcePath(value = "") {
  const normalized = String(value || "")
    .trim()
    .replaceAll("\\", "/")
    .replace(/\/+/gu, "/");
  const match = normalized.match(/(?:^|\/)sessions\/active\/[^/]+\/(?:source|worktree)\/(.+)$/u);
  return match ? normalizeRelativeSourcePath(match[1]) : "";
}

function sourceEditorLinkTarget({
  href = "",
  sourceRoot = "",
  text = ""
} = {}) {
  const root = normalizeSourceRoot(sourceRoot);
  const candidate = safeDecodePath(stripFileUrl(href || text))
    .replace(/^<|>$/gu, "")
    .trim();
  if (!candidate || /^(https?:|mailto:|#)/iu.test(candidate)) {
    return null;
  }

  const withLocation = splitLineSuffix(candidate);
  const normalizedPath = withLocation.path.replace(/\/+$/u, "");
  if (root && (normalizedPath === root || normalizedPath.startsWith(`${root}/`))) {
    return {
      column: withLocation.column,
      line: withLocation.line,
      path: normalizedPath.slice(root.length + 1)
    };
  }

  const sessionRelativePath = sessionRelativeSourcePath(withLocation.path);
  if (sessionRelativePath) {
    return {
      column: withLocation.column,
      line: withLocation.line,
      path: sessionRelativePath
    };
  }

  const relativePath = normalizeRelativeSourcePath(withLocation.path);
  if (!relativePath) {
    return null;
  }
  return {
    column: withLocation.column,
    line: withLocation.line,
    path: relativePath
  };
}

// A link inside a Markdown document names another file relative to that
// document, or to the source root when it starts with "/". It never leaves the
// source tree; external URLs, other schemes and in-page anchors return "".
function markdownDocumentLinkTarget(documentPath = "", href = "") {
  const [linkPath] = String(href || "").trim().split(/[?#]/u);
  if (!linkPath || /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(linkPath)) {
    return "";
  }
  const base = linkPath.startsWith("/") ? [] : String(documentPath || "").split("/").slice(0, -1);
  const parts = [];
  for (const part of [...base, ...safeDecodePath(linkPath).split("/")]) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return "";
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join("/");
}

function sourcePathReferenceAtLineColumn(lineText = "", column = 0) {
  return sourcePathReferencesInLine(lineText)
    .find((reference) => column >= reference.from && column <= reference.to) || null;
}

function sourcePathReferencesInLine(lineText = "") {
  const references = [];
  collectQuotedSourcePathReferences(lineText, references);
  collectUrlSourcePathReferences(lineText, references);
  return references;
}

function collectQuotedSourcePathReferences(lineText = "", references = []) {
  for (let index = 0; index < lineText.length; index += 1) {
    const quote = lineText[index];
    if (!["\"", "'", "`"].includes(quote)) {
      continue;
    }
    let cursor = index + 1;
    let value = "";
    while (cursor < lineText.length) {
      const character = lineText[cursor];
      if (character === "\\") {
        value += lineText[cursor + 1] || "";
        cursor += 2;
        continue;
      }
      if (character === quote) {
        const target = sourcePathReferenceTarget(value);
        if (target) {
          references.push({
            from: index + 1,
            target,
            to: cursor
          });
        }
        index = cursor;
        break;
      }
      value += character;
      cursor += 1;
    }
  }
}

function collectUrlSourcePathReferences(lineText = "", references = []) {
  const urlPattern = /url\(\s*([^"'`\s)]+)\s*\)/giu;
  for (const match of lineText.matchAll(urlPattern)) {
    const rawTarget = match[1] || "";
    const target = sourcePathReferenceTarget(rawTarget);
    if (!target) {
      continue;
    }
    const from = Number(match.index || 0) + match[0].indexOf(rawTarget);
    references.push({
      from,
      target,
      to: from + rawTarget.length
    });
  }
}

function sourcePathReferenceTarget(value = "") {
  const target = String(value || "").trim();
  if (!target || target.startsWith("//") || /^[a-z][a-z0-9+.-]*:/iu.test(target)) {
    return "";
  }
  if (target.startsWith("./") || target.startsWith("../") || target.startsWith("/")) {
    return target;
  }
  return "";
}

export {
  markdownDocumentLinkTarget,
  sourceEditorLinkTarget,
  sourcePathReferenceAtLineColumn
};
