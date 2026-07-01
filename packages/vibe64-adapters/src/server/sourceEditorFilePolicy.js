const DEFAULT_SOURCE_EDITOR_MAX_FILE_BYTES = 1024 * 1024;
const DEFAULT_SOURCE_EDITOR_MAX_TREE_DEPTH = 16;
const DEFAULT_SOURCE_EDITOR_MAX_TREE_ENTRIES = 5000;

const BASE_SOURCE_EDITOR_EXCLUDE_PATTERNS = Object.freeze([
  ".git",
  ".git/**",
  ".vibe64",
  ".vibe64/**",
  ".vibe64-editor-*"
]);

function normalizePolicyText(value = "") {
  return String(value || "").trim();
}

function normalizePolicyPath(value = "") {
  return normalizePolicyText(value)
    .replaceAll("\\", "/")
    .replace(/^\.\/+/u, "")
    .replace(/\/+$/u, "");
}

function normalizePatternList(values = []) {
  const seen = new Set();
  const patterns = [];
  for (const value of Array.isArray(values) ? values : []) {
    const pattern = normalizePolicyPath(value);
    if (!pattern || seen.has(pattern)) {
      continue;
    }
    seen.add(pattern);
    patterns.push(pattern);
  }
  return patterns;
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function sourceEditorFilePolicy({
  adapterId = "",
  defaultOpenFiles = [],
  exclude = [],
  maxFileBytes = DEFAULT_SOURCE_EDITOR_MAX_FILE_BYTES,
  maxTreeDepth = DEFAULT_SOURCE_EDITOR_MAX_TREE_DEPTH,
  maxTreeEntries = DEFAULT_SOURCE_EDITOR_MAX_TREE_ENTRIES,
  preexpandedDirectories = [],
  preloadDirectories = []
} = {}) {
  return {
    adapterId: normalizePolicyText(adapterId),
    defaultOpenFiles: normalizePatternList(defaultOpenFiles),
    exclude: normalizePatternList([
      ...BASE_SOURCE_EDITOR_EXCLUDE_PATTERNS,
      ...exclude
    ]),
    maxFileBytes: positiveInteger(maxFileBytes, DEFAULT_SOURCE_EDITOR_MAX_FILE_BYTES),
    maxTreeDepth: positiveInteger(maxTreeDepth, DEFAULT_SOURCE_EDITOR_MAX_TREE_DEPTH),
    maxTreeEntries: positiveInteger(maxTreeEntries, DEFAULT_SOURCE_EDITOR_MAX_TREE_ENTRIES),
    preexpandedDirectories: normalizePatternList(preexpandedDirectories),
    preloadDirectories: normalizePatternList(preloadDirectories)
  };
}

function sourceEditorFilePolicyFromAdapterExclusions({
  adapterId = "",
  defaultOpenFiles = [],
  exclude = [],
  preexpandedDirectories = [],
  preloadDirectories = [],
  worktreeArchiveExclusions = []
} = {}) {
  return sourceEditorFilePolicy({
    adapterId,
    defaultOpenFiles,
    exclude: [
      ...worktreeArchiveExclusions,
      ...exclude
    ],
    preexpandedDirectories,
    preloadDirectories
  });
}

export {
  BASE_SOURCE_EDITOR_EXCLUDE_PATTERNS,
  DEFAULT_SOURCE_EDITOR_MAX_FILE_BYTES,
  DEFAULT_SOURCE_EDITOR_MAX_TREE_DEPTH,
  DEFAULT_SOURCE_EDITOR_MAX_TREE_ENTRIES,
  sourceEditorFilePolicy,
  sourceEditorFilePolicyFromAdapterExclusions
};
