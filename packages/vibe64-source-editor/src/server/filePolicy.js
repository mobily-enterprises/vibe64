const DEFAULT_SOURCE_EDITOR_MAX_FILE_BYTES = 1024 * 1024;
const DEFAULT_SOURCE_EDITOR_MAX_TREE_DEPTH = 16;
const DEFAULT_SOURCE_EDITOR_MAX_TREE_ENTRIES = 5000;
const VIBE64_SOURCE_CONTRACT_DIR = ".vibe64";
const VIBE64_SOURCE_CONTRACT_PREFIX = `${VIBE64_SOURCE_CONTRACT_DIR}/`;

const BASE_SOURCE_EDITOR_EXCLUDE_PATTERNS = Object.freeze([
  ".git",
  ".git/**"
]);

// The one source-editor path policy. The tree, file finder, reads, writes and
// the content-search worker all decide exclusion through sourceEditorPathExcluded.
function normalizePolicyPath(value = "") {
  return String(value ?? "")
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\.\/+/u, "")
    .replace(/\/+$/u, "");
}

function sourceEditorSourceContractPathExcluded(value = "") {
  const label = normalizePolicyPath(value);
  return label === VIBE64_SOURCE_CONTRACT_DIR || label.startsWith(VIBE64_SOURCE_CONTRACT_PREFIX);
}

function wildcardPattern(pattern = "") {
  let source = "^";
  const text = String(pattern || "");
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === "*") {
      if (text[index + 1] === "*") {
        source += ".*";
        index += 1;
      } else {
        source += "[^/]*";
      }
      continue;
    }
    source += character.replace(/[\\^$+?.()|{}[\]]/gu, "\\$&");
  }
  source += "$";
  return new RegExp(source, "u");
}

function pathMatchesPolicyPattern(relativePath = "", pattern = "") {
  const normalizedPath = normalizePolicyPath(relativePath);
  const normalizedPattern = normalizePolicyPath(pattern);
  if (!normalizedPath || !normalizedPattern) {
    return false;
  }
  if (!normalizedPattern.includes("/") && !normalizedPattern.includes("*")) {
    return normalizedPath.split("/").includes(normalizedPattern);
  }
  if (!normalizedPattern.includes("/") && normalizedPattern.includes("*")) {
    const segmentPattern = wildcardPattern(normalizedPattern);
    return normalizedPath.split("/").some((segment) => segmentPattern.test(segment));
  }
  const subtreePattern = normalizedPattern.endsWith("/**")
    ? normalizedPattern.slice(0, -3)
    : normalizedPattern;
  if (
    !subtreePattern.includes("*") &&
    (normalizedPath === subtreePattern || normalizedPath.startsWith(`${subtreePattern}/`))
  ) {
    return true;
  }
  return wildcardPattern(normalizedPattern).test(normalizedPath);
}

// Protected names also match in any letter case: a case-insensitive
// filesystem opens `.GIT/hooks` as `.git/hooks`.
function sourceEditorPathExcluded(policy = {}, relativePath = "") {
  const spellings = [relativePath, String(relativePath ?? "").toLowerCase()];
  if (policy.protectSourceContract !== false && spellings.some(sourceEditorSourceContractPathExcluded)) {
    return true;
  }
  return (Array.isArray(policy.exclude) ? policy.exclude : [])
    .some((pattern) => spellings.some((spelling) => pathMatchesPolicyPattern(spelling, pattern)));
}

function sourceEditorFilePolicy() {
  return {
    exclude: [...BASE_SOURCE_EDITOR_EXCLUDE_PATTERNS],
    maxFileBytes: DEFAULT_SOURCE_EDITOR_MAX_FILE_BYTES,
    maxTreeDepth: DEFAULT_SOURCE_EDITOR_MAX_TREE_DEPTH,
    maxTreeEntries: DEFAULT_SOURCE_EDITOR_MAX_TREE_ENTRIES
  };
}

export {
  normalizePolicyPath,
  pathMatchesPolicyPattern,
  sourceEditorFilePolicy,
  sourceEditorPathExcluded
};
