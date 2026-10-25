import path from "node:path";

const GIT_HISTORY_RECORD_FORMAT = "%H%x00%P%x00%an%x00%ae%x00%aI%x00%s";
const DEFAULT_CHANGE_FILE_LIMIT = 200;
const MAX_CHANGE_FILE_LIMIT = 500;
const DEFAULT_CHANGE_DIFF_LINE_LIMIT = 800;
const MAX_CHANGE_DIFF_LINE_LIMIT = 5000;

function text(value = "") {
  return String(value || "").trim();
}

function parseGitHistoryRecords(value = "") {
  const fields = String(value || "").split("\0");
  const versions = [];
  for (let index = 0; index + 5 < fields.length; index += 6) {
    const commit = text(fields[index]);
    if (!commit) {
      continue;
    }
    const parents = text(fields[index + 1]).split(/\s+/u).filter(Boolean);
    versions.push({
      author: text(fields[index + 2]),
      authorEmail: text(fields[index + 3]),
      committedAt: text(fields[index + 4]),
      commit,
      isMerge: parents.length > 1,
      message: text(fields[index + 5]),
      parents,
      shortCommit: commit.slice(0, 8)
    });
  }
  return versions;
}

function boundedInteger(value, fallback, maximum) {
  const number = Number.parseInt(String(value ?? ""), 10);
  return Number.isSafeInteger(number) && number > 0
    ? Math.min(number, maximum)
    : fallback;
}

function parseGitNameStatusZ(value = "") {
  const fields = String(value || "").split("\0");
  const files = new Map();
  for (let index = 0; index < fields.length;) {
    const status = text(fields[index++]);
    if (!status) {
      continue;
    }
    const previousPath = /^[CR]/u.test(status) ? fields[index++] : "";
    const filePath = fields[index++];
    if (!filePath) {
      continue;
    }
    files.set(filePath, {
      path: filePath,
      ...(previousPath ? { previousPath } : {}),
      status: status.slice(0, 1)
    });
  }
  return files;
}

function numericStat(value = "") {
  const normalized = text(value);
  if (normalized === "-") {
    return null;
  }
  const number = Number.parseInt(normalized, 10);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function parseGitNumstatZ(value = "") {
  const fields = String(value || "").split("\0");
  const stats = new Map();
  for (let index = 0; index < fields.length;) {
    const record = fields[index++];
    if (!record) {
      continue;
    }
    const firstTab = record.indexOf("\t");
    const secondTab = record.indexOf("\t", firstTab + 1);
    const filePath = record.slice(secondTab + 1);
    const renamed = !filePath;
    if (renamed) {
      index += 1;
    }
    const targetPath = renamed ? fields[index++] : filePath;
    if (!targetPath) {
      continue;
    }
    stats.set(targetPath, {
      added: numericStat(record.slice(0, firstTab)),
      deleted: numericStat(record.slice(firstTab + 1, secondTab))
    });
  }
  return stats;
}

// Merges `diff-tree -M --name-status -z` and `--numstat -z` output of the same
// comparison into path-sorted file records with line stats.
function changedFileRecords(statusOutput = "", numstatOutput = "") {
  const stats = parseGitNumstatZ(numstatOutput);
  return [...parseGitNameStatusZ(statusOutput).values()]
    .map((file) => ({ ...file, ...(stats.get(file.path) || { added: 0, deleted: 0 }) }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function pageRecords(items, { offset = 0, limit, defaultLimit, maxLimit }) {
  const boundedLimit = boundedInteger(limit, defaultLimit, maxLimit);
  const boundedOffset = Math.max(0, Number.parseInt(String(offset ?? ""), 10) || 0);
  return {
    items: items.slice(boundedOffset, boundedOffset + boundedLimit),
    limit: boundedLimit,
    offset: boundedOffset,
    totalCount: items.length,
    truncated: boundedOffset + boundedLimit < items.length
  };
}

function boundedDiff(output = "", lineLimit) {
  const lines = String(output || "").replaceAll("\r\n", "\n").split("\n");
  const boundedLimit = boundedInteger(lineLimit, DEFAULT_CHANGE_DIFF_LINE_LIMIT, MAX_CHANGE_DIFF_LINE_LIMIT);
  return {
    diff: lines.slice(0, boundedLimit).join("\n"),
    lineLimit: boundedLimit,
    shownLines: Math.min(lines.length, boundedLimit),
    totalLines: lines.length,
    truncated: lines.length > boundedLimit
  };
}

function safeChangePath(value = "") {
  const filePath = String(value || "");
  if (
    !filePath ||
    filePath.includes("\0") ||
    path.posix.isAbsolute(filePath) ||
    path.posix.normalize(filePath) !== filePath ||
    filePath === ".." ||
    filePath.startsWith("../")
  ) {
    throw Object.assign(new Error("Choose a changed project file."), {
      code: "vibe64_session_change_path_invalid",
      details: {}
    });
  }
  return filePath;
}

function exactFileDiffPathspecs(filePath) {
  // Literal pathspecs still include descendants; exclude those, not the entry itself.
  const escapedPath = filePath.replace(/[*?[\]\\]/gu, "\\$&");
  return [`:(literal)${filePath}`, `:(glob,exclude)${escapedPath}/**`];
}

export {
  DEFAULT_CHANGE_DIFF_LINE_LIMIT,
  DEFAULT_CHANGE_FILE_LIMIT,
  GIT_HISTORY_RECORD_FORMAT,
  MAX_CHANGE_DIFF_LINE_LIMIT,
  MAX_CHANGE_FILE_LIMIT,
  boundedDiff,
  boundedInteger,
  changedFileRecords,
  exactFileDiffPathspecs,
  pageRecords,
  parseGitHistoryRecords,
  parseGitNameStatusZ,
  parseGitNumstatZ,
  safeChangePath
};
