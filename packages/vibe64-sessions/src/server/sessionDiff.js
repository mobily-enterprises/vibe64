import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  sessionSourcePath
} from "@local/vibe64-core/server/sessionSourcePath";

const execFileAsync = promisify(execFile);
const GIT_DIFF_BUFFER_BYTES = 8 * 1024 * 1024;
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
    const result = await execFileAsync("git", args, {
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

async function untrackedFileDiff(worktreePath, relativePath) {
  return gitOutput(worktreePath, [
    ...GIT_REVIEW_DIFF_ARGS,
    "--no-index",
    "--",
    "/dev/null",
    relativePath
  ], {
    allowDiffExit: true
  });
}

async function untrackedDiff(worktreePath) {
  const files = await untrackedFiles(worktreePath);
  const diffs = await Promise.all(files.map((relativePath) => {
    return untrackedFileDiff(worktreePath, relativePath);
  }));
  return diffs.filter(Boolean).join("\n");
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
  if (full) {
    return {
      diffLineLimit: 0,
      diffShownLines: 0,
      diffTotalLines: 0,
      diffTruncated: false,
      stagedDiff,
      truncatedFiles: [],
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
  const truncatedFiles = stages.flatMap((stage) => stage.files.filter((file) => file.truncated));
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
  const diffPayload = truncateSessionDiffPayload(stagedDiff, unstagedDiff, extraDiff, options);
  const hasChanges = Boolean(gitStatus || stagedDiff || unstagedDiff || extraDiff);

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
  inspectSessionDiff
};
