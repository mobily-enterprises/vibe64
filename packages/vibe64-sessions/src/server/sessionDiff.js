import { execFile } from "node:child_process";
import { lstat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import {
  sessionSourcePath
} from "@local/vibe64-core/server/sessionSourcePath";
import {
  gitSafeDirectoryArgs
} from "@local/studio-terminal-core/server/gitSafeDirectories";

const execFileAsync = promisify(execFile);
const GIT_DIFF_BUFFER_BYTES = 8 * 1024 * 1024;
const MAX_INLINE_UNTRACKED_DIFF_FILE_BYTES = 1024 * 1024;
const GIT_COMMAND_TIMEOUT_MS = 30_000;
const GIT_REVIEW_DIFF_ARGS = ["diff", "--no-ext-diff"];
const DEFAULT_DIFF_FILE_LINE_LIMIT = 400;
const MAX_DIFF_FILE_LINE_LIMIT = 5000;

function normalizeOutput(value = "") {
  return String(value || "").trim();
}

async function gitOutput(cwd, args, {
  allowDiffExit = false
} = {}) {
  try {
    const result = await execFileAsync("git", [
      ...gitSafeDirectoryArgs([cwd]),
      ...args
    ], {
      cwd,
      maxBuffer: GIT_DIFF_BUFFER_BYTES,
      timeout: GIT_COMMAND_TIMEOUT_MS
    });
    return normalizeOutput(result.stdout);
  } catch (error) {
    if (allowDiffExit && error?.code === 1) {
      return normalizeOutput(error.stdout);
    }
    throw new Error(normalizeOutput(error.stderr || error.stdout || error.message));
  }
}

async function untrackedFiles(worktreePath) {
  const output = await gitOutput(worktreePath, [
    "ls-files",
    "--others",
    "--exclude-standard"
  ]);
  return output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

function bytesLabel(bytes = 0) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (value >= 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${value} B`;
}

function quoteGitPath(pathValue = "", prefix = "") {
  const value = prefix ? `${prefix}/${pathValue}` : String(pathValue || "");
  return /^[A-Za-z0-9._/-]+$/u.test(value) ? value : JSON.stringify(value);
}

function syntheticUntrackedFileDiff(relativePath = "", {
  sizeBytes = 0
} = {}) {
  const displaySize = bytesLabel(sizeBytes);
  return [
    `diff --git ${quoteGitPath(relativePath, "a")} ${quoteGitPath(relativePath, "b")}`,
    "new file mode 100644",
    "index 0000000..0000000",
    "--- /dev/null",
    `+++ ${quoteGitPath(relativePath, "b")}`,
    "@@ -0,0 +1 @@",
    `+Vibe64 omitted this untracked file diff because ${quoteGitPath(relativePath)} is ${displaySize}.`
  ].join("\n");
}

function omittedUntrackedFile(relativePath = "", {
  sizeBytes = 0
} = {}) {
  return {
    path: relativePath,
    reason: "large_untracked_file",
    shownLines: 7,
    sizeBytes,
    stage: "untracked",
    totalLines: 7,
    truncated: true
  };
}

function safeWorktreeChildPath(worktreePath = "", relativePath = "") {
  const root = path.resolve(worktreePath);
  const child = path.resolve(root, relativePath);
  if (child !== root && child.startsWith(`${root}${path.sep}`)) {
    return child;
  }
  return "";
}

async function untrackedFileSize(worktreePath, relativePath) {
  const filePath = safeWorktreeChildPath(worktreePath, relativePath);
  if (!filePath) {
    return 0;
  }
  try {
    const stats = await lstat(filePath);
    return stats.isFile() ? stats.size : 0;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return 0;
    }
    throw error;
  }
}

async function untrackedFileDiff(worktreePath, relativePath) {
  const sizeBytes = await untrackedFileSize(worktreePath, relativePath);
  if (sizeBytes > MAX_INLINE_UNTRACKED_DIFF_FILE_BYTES) {
    return {
      diff: syntheticUntrackedFileDiff(relativePath, {
        sizeBytes
      }),
      omittedFiles: [
        omittedUntrackedFile(relativePath, {
          sizeBytes
        })
      ]
    };
  }
  return gitOutput(worktreePath, [
    ...GIT_REVIEW_DIFF_ARGS,
    "--no-index",
    "--",
    "/dev/null",
    relativePath
  ], {
    allowDiffExit: true
  }).then((diff) => ({
    diff,
    omittedFiles: []
  }));
}

async function untrackedDiff(worktreePath) {
  const files = await untrackedFiles(worktreePath);
  const results = await Promise.all(files.map((relativePath) => {
    return untrackedFileDiff(worktreePath, relativePath);
  }));
  return {
    diff: results.map((result) => result.diff).filter(Boolean).join("\n"),
    omittedFiles: results.flatMap((result) => result.omittedFiles || [])
  };
}

function normalizeDiffLineLimit(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    return DEFAULT_DIFF_FILE_LINE_LIMIT;
  }
  return Math.min(number, MAX_DIFF_FILE_LINE_LIMIT);
}

function diffStagePath(line = "") {
  const normalized = String(line || "").trim();
  if (!normalized.startsWith("diff --git ")) {
    return "";
  }
  const parts = normalized.slice("diff --git ".length).split(/\s+/u);
  const target = parts[1] || parts[0] || "";
  return target.replace(/^[ab]\//u, "");
}

function splitGitDiffText(diff = "") {
  const text = String(diff || "").replace(/\r\n/gu, "\n").trim();
  if (!text) {
    return [];
  }
  const sections = [];
  let current = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) {
      if (current.length > 0) {
        sections.push(current.join("\n"));
      }
      current = [line];
      continue;
    }
    if (current.length > 0) {
      current.push(line);
    }
  }
  if (current.length > 0) {
    sections.push(current.join("\n"));
  }
  return sections.length ? sections : [text];
}

function truncateDiffStage(diff = "", {
  lineLimit = DEFAULT_DIFF_FILE_LINE_LIMIT,
  stage = ""
} = {}) {
  const limit = normalizeDiffLineLimit(lineLimit);
  const files = [];
  const sections = splitGitDiffText(diff).map((sectionDiff, index) => {
    const lines = sectionDiff.split("\n");
    const totalLines = lines.length;
    const path = diffStagePath(lines[0]) || `${stage || "diff"} file ${index + 1}`;
    if (totalLines <= limit) {
      files.push({
        path,
        shownLines: totalLines,
        stage,
        totalLines,
        truncated: false
      });
      return sectionDiff;
    }
    files.push({
      path,
      shownLines: limit,
      stage,
      totalLines,
      truncated: true
    });
    return lines.slice(0, limit).join("\n");
  });
  const shownLines = files.reduce((sum, file) => sum + file.shownLines, 0);
  const totalLines = files.reduce((sum, file) => sum + file.totalLines, 0);
  return {
    diff: sections.filter(Boolean).join("\n"),
    files,
    shownLines,
    totalLines,
    truncated: files.some((file) => file.truncated)
  };
}

function truncateSessionDiffPayload(stagedDiff = "", unstagedDiff = "", extraDiff = "", options = {}) {
  const full = options.full === true || String(options.full || "") === "1" || String(options.full || "").toLowerCase() === "true";
  const lineLimit = normalizeDiffLineLimit(options.lineLimit);
  const omittedFiles = Array.isArray(options.omittedFiles) ? options.omittedFiles : [];
  if (full) {
    return {
      diffLineLimit: 0,
      diffShownLines: omittedFiles.reduce((sum, file) => sum + Number(file.shownLines || 0), 0),
      diffTotalLines: omittedFiles.reduce((sum, file) => sum + Number(file.totalLines || 0), 0),
      diffTruncated: omittedFiles.length > 0,
      stagedDiff,
      truncatedFiles: omittedFiles,
      unstagedDiff,
      untrackedDiff: extraDiff
    };
  }
  const stages = [
    truncateDiffStage(stagedDiff, {
      lineLimit,
      stage: "staged"
    }),
    truncateDiffStage(unstagedDiff, {
      lineLimit,
      stage: "unstaged"
    }),
    truncateDiffStage(extraDiff, {
      lineLimit,
      stage: "untracked"
    })
  ];
  const truncatedFiles = [
    ...stages.flatMap((stage) => stage.files.filter((file) => file.truncated)),
    ...omittedFiles
  ];
  return {
    diffLineLimit: lineLimit,
    diffShownLines: stages.reduce((sum, stage) => sum + stage.shownLines, 0),
    diffTotalLines: stages.reduce((sum, stage) => sum + stage.totalLines, 0),
    diffTruncated: truncatedFiles.length > 0,
    stagedDiff: stages[0].diff,
    truncatedFiles,
    unstagedDiff: stages[1].diff,
    untrackedDiff: stages[2].diff
  };
}

async function inspectSessionDiff(session = {}, options = {}) {
  const worktreePath = sessionSourcePath(session);
  if (!worktreePath) {
    return {
      error: "Create the session clone before reviewing changes.",
      ok: false
    };
  }

  const [gitStatus, stagedDiff, unstagedDiff, extraDiff] = await Promise.all([
    gitOutput(worktreePath, ["status", "--short"]),
    gitOutput(worktreePath, [...GIT_REVIEW_DIFF_ARGS, "--cached"]),
    gitOutput(worktreePath, GIT_REVIEW_DIFF_ARGS),
    untrackedDiff(worktreePath)
  ]);
  const diffPayload = truncateSessionDiffPayload(stagedDiff, unstagedDiff, extraDiff.diff, {
    ...options,
    omittedFiles: extraDiff.omittedFiles
  });
  const hasChanges = Boolean(gitStatus || stagedDiff || unstagedDiff || extraDiff.diff);

  return {
    ...diffPayload,
    gitStatus,
    hasChanges,
    ok: true,
    worktreePath
  };
}

export {
  DEFAULT_DIFF_FILE_LINE_LIMIT,
  MAX_INLINE_UNTRACKED_DIFF_FILE_BYTES,
  inspectSessionDiff
};
