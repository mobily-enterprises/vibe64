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
  const match = text.match(/^(.*?)(?::(\d+))(?::(\d+))?$/u);
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

function sourceEditorLinkTarget({
  href = "",
  sourceRoot = "",
  text = ""
} = {}) {
  const root = normalizeSourceRoot(sourceRoot);
  if (!root) {
    return null;
  }
  const candidate = safeDecodePath(stripFileUrl(href || text))
    .replace(/^<|>$/gu, "")
    .trim();
  if (!candidate || /^(https?:|mailto:|#)/iu.test(candidate)) {
    return null;
  }

  const withLocation = splitLineSuffix(candidate);
  const normalizedPath = withLocation.path.replace(/\/+$/u, "");
  if (normalizedPath === root || normalizedPath.startsWith(`${root}/`)) {
    return {
      column: withLocation.column,
      line: withLocation.line,
      path: normalizedPath.slice(root.length + 1)
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

export {
  sourceEditorLinkTarget
};
