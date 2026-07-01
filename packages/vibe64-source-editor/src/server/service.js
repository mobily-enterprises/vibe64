import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { lstat, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  normalizeText,
  pathExists,
  vibe64Error
} from "@local/vibe64-core/server/core";
import {
  sessionSourcePath
} from "@local/vibe64-core/server/sessionSourcePath";
import {
  pathInsideOrEqual
} from "@local/vibe64-core/server/studioProjectContext";
import {
  vibe64ErrorResponse
} from "@local/vibe64-core/server/serverResponses";
import {
  sourceEditorFilePolicy
} from "@local/vibe64-adapters/server/sourceEditorFilePolicy";

const SOURCE_EDITOR_CONFLICT_CODE = "vibe64_source_editor_conflict";
const SOURCE_EDITOR_FILE_MATCH_LIMIT = 80;
const SOURCE_EDITOR_SEARCH_RESULT_LIMIT = 120;
const SOURCE_EDITOR_SEARCH_TIMEOUT_MS = 6000;
const SOURCE_EDITOR_QUERY_MAX_LENGTH = 240;
const SOURCE_EDITOR_TREE_PAGE_LIMIT = 20;
const SOURCE_EDITOR_EXPLANATION_CONTEXT_LINES = 6;
const SOURCE_EDITOR_EXPLANATION_MAX_LINES = 240;
const SOURCE_EDITOR_FOLLOWUP_MAX_LENGTH = 2000;
const SOURCE_EDITOR_EXPLANATION_CHAT_TIMEOUT_MS = 180_000;
const SOURCE_EDITOR_EXPLANATION_PROMPT_VERSION = "source-explanation-chat-v1";

function createService({
  explanationFollowupGenerator = null,
  explanationGenerator = null,
  projectService,
  terminalService = null
} = {}) {
  if (!projectService || typeof projectService.createRuntime !== "function") {
    throw new TypeError("createService requires feature.vibe64-project.service.");
  }
  const sourceExplanationGenerator = typeof explanationGenerator === "function"
    ? explanationGenerator
    : (input, options = {}) => generateSourceEditorExplanationWithAppServer(input, {
      ...options,
      terminalService
    });
  const sourceExplanationFollowupGenerator = typeof explanationFollowupGenerator === "function"
    ? explanationFollowupGenerator
    : (explanation, message, options = {}) => generateSourceEditorExplanationFollowupWithAppServer(explanation, message, {
      ...options,
      terminalService
    });
  const explanationChats = new Map();

  async function sourceEditorContext(sessionId = "") {
    const normalizedSessionId = normalizeText(sessionId);
    if (!normalizedSessionId) {
      throw sourceEditorError("Missing Vibe64 session id.", "vibe64_invalid_session_id");
    }

    const runtime = await projectService.createRuntime({
      sessionId: normalizedSessionId
    });
    const session = await runtime.getSession(normalizedSessionId);
    const sourceRoot = sessionSourcePath(session);
    if (!sourceRoot || !await pathExists(sourceRoot)) {
      throw sourceEditorError(
        "Create the session source before opening the editor.",
        "vibe64_source_editor_source_unavailable",
        { sessionId: normalizedSessionId },
        409
      );
    }

    return {
      policy: await adapterSourceEditorFilePolicy(runtime.adapter, {
        session,
        sourceRoot
      }),
      runtime,
      session,
      sessionId: normalizedSessionId,
      sourceRoot
    };
  }

  return Object.freeze({
    async readTree(input = {}) {
      return runSourceEditorOperation(async () => {
        const context = await sourceEditorContext(input.sessionId);
        return {
          ok: true,
          policy: publicSourceEditorPolicy(context.policy),
          root: "",
          tree: await sourceEditorTree(context, input)
        };
      });
    },

    async readFile(input = {}) {
      return runSourceEditorOperation(async () => {
        const context = await sourceEditorContext(input.sessionId);
        return {
          file: await readSourceEditorFile(context, input.path),
          ok: true
        };
      });
    },

    async saveFile(input = {}) {
      return runSourceEditorOperation(async () => {
        const context = await sourceEditorContext(input.sessionId);
        return {
          file: await saveSourceEditorFile(context, input),
          ok: true
        };
      });
    },

    async listFiles(input = {}) {
      return runSourceEditorOperation(async () => {
        const context = await sourceEditorContext(input.sessionId);
        return {
          ok: true,
          ...await sourceEditorFileMatches(context, input)
        };
      });
    },

    async search(input = {}) {
      return runSourceEditorOperation(async () => {
        const context = await sourceEditorContext(input.sessionId);
        return {
          ok: true,
          ...await sourceEditorSearch(context, input)
        };
      });
    },

    async explainSelection(input = {}) {
      return runSourceEditorOperation(async () => {
        const context = await sourceEditorContext(input.sessionId);
        return {
          explanation: await createSourceEditorExplanation(context, input, {
            explanationChats,
            explanationGenerator: sourceExplanationGenerator
          }),
          ok: true
        };
      });
    },

    async addExplanationFollowup(input = {}) {
      return runSourceEditorOperation(async () => {
        const context = await sourceEditorContext(input.sessionId);
        return {
          explanation: await addSourceEditorExplanationFollowup(context, input, {
            explanationChats,
            explanationFollowupGenerator: sourceExplanationFollowupGenerator
          }),
          ok: true
        };
      });
    },

    async deleteExplanation(input = {}) {
      return runSourceEditorOperation(async () => {
        const context = await sourceEditorContext(input.sessionId);
        return {
          ...await deleteSourceEditorExplanation(context, input.explanationId, {
            explanationChats,
            terminalService
          }),
          ok: true
        };
      });
    }
  });
}

async function runSourceEditorOperation(operation) {
  try {
    return await operation();
  } catch (error) {
    return sourceEditorErrorResponse(error);
  }
}

async function adapterSourceEditorFilePolicy(adapter, context = {}) {
  if (adapter && typeof adapter.sourceEditorFilePolicy === "function") {
    return sourceEditorFilePolicy(await adapter.sourceEditorFilePolicy(context));
  }
  return sourceEditorFilePolicy({
    adapterId: adapter?.id || ""
  });
}

function sourceEditorError(message, code, details = {}, statusCode = 400) {
  const error = vibe64Error(message, code);
  error.details = details;
  error.statusCode = statusCode;
  return error;
}

function sourceEditorErrorResponse(error) {
  return {
    ...vibe64ErrorResponse(error, {
      fallbackCode: "vibe64_source_editor_failed",
      fallbackMessage: "Source editor operation failed."
    }),
    statusCode: error?.statusCode || 400
  };
}

function publicSourceEditorPolicy(policy = {}) {
  return {
    adapterId: normalizeText(policy.adapterId),
    defaultOpenFiles: Array.isArray(policy.defaultOpenFiles) ? policy.defaultOpenFiles : [],
    exclude: Array.isArray(policy.exclude) ? policy.exclude : [],
    maxFileBytes: policy.maxFileBytes,
    maxTreeDepth: policy.maxTreeDepth,
    maxTreeEntries: policy.maxTreeEntries,
    preexpandedDirectories: Array.isArray(policy.preexpandedDirectories) ? policy.preexpandedDirectories : [],
    preloadDirectories: Array.isArray(policy.preloadDirectories) ? policy.preloadDirectories : []
  };
}

function normalizeSourceEditorRelativePath(value = "") {
  const raw = normalizeText(value).replaceAll("\\", "/");
  if (!raw || raw === "." || raw === "/") {
    return "";
  }
  if (raw.startsWith("/") || /^[A-Za-z]:\//u.test(raw)) {
    throw sourceEditorError("Source editor paths must be relative to the session source.", "vibe64_invalid_source_editor_path");
  }
  const normalized = path.posix.normalize(raw).replace(/^\.\/+/u, "");
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw sourceEditorError("Source editor path escapes the session source.", "vibe64_invalid_source_editor_path");
  }
  return normalized;
}

function absoluteSourceEditorPath(sourceRoot = "", relativePath = "") {
  const absolutePath = path.resolve(sourceRoot, relativePath);
  if (!pathInsideOrEqual(sourceRoot, absolutePath)) {
    throw sourceEditorError("Source editor path escapes the session source.", "vibe64_invalid_source_editor_path");
  }
  return absolutePath;
}

function normalizeSourceEditorPolicyPath(value = "") {
  return normalizeText(value)
    .replaceAll("\\", "/")
    .replace(/^\.\/+/u, "")
    .replace(/\/+$/u, "");
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
  const normalizedPath = normalizeSourceEditorPolicyPath(relativePath);
  const normalizedPattern = normalizeSourceEditorPolicyPath(pattern);
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

function sourceEditorPathExcluded(policy = {}, relativePath = "") {
  return (Array.isArray(policy.exclude) ? policy.exclude : [])
    .some((pattern) => pathMatchesPolicyPattern(relativePath, pattern));
}

function normalizeSourceEditorQuery(value = "") {
  return normalizeText(value).slice(0, SOURCE_EDITOR_QUERY_MAX_LENGTH);
}

function sourceEditorFileQueryTokens(value = "") {
  return normalizeSourceEditorQuery(value)
    .toLowerCase()
    .split(/\s+/u)
    .filter(Boolean);
}

function sourceEditorResultLimit(value, fallback) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    return fallback;
  }
  return Math.min(number, fallback);
}

function sourceEditorResultOffset(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

function sourceEditorPolicyExcludeGlobs(policy = {}) {
  const globs = [];
  const seen = new Set();
  function add(pattern = "") {
    const normalized = normalizeSourceEditorPolicyPath(pattern);
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    globs.push("--glob", `!${normalized}`);
  }

  for (const pattern of Array.isArray(policy.exclude) ? policy.exclude : []) {
    const normalized = normalizeSourceEditorPolicyPath(pattern);
    if (!normalized) {
      continue;
    }
    add(normalized);
    if (!normalized.includes("/")) {
      add(`**/${normalized}`);
      add(`**/${normalized}/**`);
    } else if (!normalized.endsWith("/**")) {
      add(`${normalized}/**`);
    }
  }
  return globs;
}

function sourceEditorRipgrepBaseArgs(policy = {}) {
  return [
    "--hidden",
    "--no-ignore",
    "--no-messages",
    "--sort",
    "path",
    ...sourceEditorPolicyExcludeGlobs(policy)
  ];
}

function normalizeRipgrepPath(value = "") {
  return normalizeSourceEditorPolicyPath(value);
}

function orderedTokenIndexes(text = "", tokens = []) {
  const normalizedText = String(text || "").toLowerCase();
  const indexes = [];
  let cursor = 0;
  for (const token of tokens) {
    const index = normalizedText.indexOf(token, cursor);
    if (index < 0) {
      return null;
    }
    indexes.push(index);
    cursor = index + token.length;
  }
  return indexes;
}

function filePathMatchesQuery(filePath = "", tokens = []) {
  return !tokens.length || orderedTokenIndexes(filePath, tokens) !== null;
}

function fileMatchScore(filePath = "", queryTokens = []) {
  const tokens = Array.isArray(queryTokens)
    ? queryTokens
    : sourceEditorFileQueryTokens(queryTokens);
  const lowerPath = filePath.toLowerCase();
  const lowerQuery = tokens.join(" ");
  const lowerName = path.posix.basename(lowerPath);
  if (!tokens.length) {
    return 5;
  }
  const pathIndexes = orderedTokenIndexes(lowerPath, tokens);
  if (!pathIndexes) {
    return 99;
  }
  if (tokens.length > 1) {
    const nameIndexes = orderedTokenIndexes(lowerName, tokens);
    const firstIndex = pathIndexes[0];
    const span = pathIndexes[pathIndexes.length - 1] - firstIndex;
    if (nameIndexes?.[0] === 0) {
      return 1 + span / 1000;
    }
    if (nameIndexes) {
      return 2 + span / 1000;
    }
    if (firstIndex === 0) {
      return 3 + span / 1000;
    }
    return 4 + firstIndex / 1000 + span / 1000000;
  }
  if (lowerName === lowerQuery) {
    return 0;
  }
  if (lowerName.startsWith(lowerQuery)) {
    return 1;
  }
  if (lowerName.includes(lowerQuery)) {
    return 2;
  }
  if (lowerPath.startsWith(lowerQuery)) {
    return 3;
  }
  return lowerPath.includes(lowerQuery) ? 4 : 99;
}

function sortFileMatches(matches = [], query = "") {
  const queryTokens = sourceEditorFileQueryTokens(query);
  return [...matches].sort((left, right) => {
    const scoreDiff = fileMatchScore(left.path, queryTokens) - fileMatchScore(right.path, queryTokens);
    return scoreDiff || left.path.localeCompare(right.path);
  });
}

async function sourceEditorFileMatches(context = {}, input = {}) {
  const query = normalizeSourceEditorQuery(input.query || input.q);
  const queryTokens = sourceEditorFileQueryTokens(query);
  const limit = sourceEditorResultLimit(input.limit, SOURCE_EDITOR_FILE_MATCH_LIMIT);
  const matches = [];
  let truncated = false;
  const ripgrepRun = await runRipgrepLines([
    "--files",
    ...sourceEditorRipgrepBaseArgs(context.policy)
  ], {
    cwd: context.sourceRoot,
    onLine(line = "") {
      const relativePath = normalizeRipgrepPath(line);
      if (
        !relativePath ||
        sourceEditorPathExcluded(context.policy, relativePath) ||
        !filePathMatchesQuery(relativePath, queryTokens)
      ) {
        return true;
      }
      matches.push({
        language: sourceEditorLanguageForPath(relativePath),
        name: path.posix.basename(relativePath),
        path: relativePath
      });
      if (matches.length >= limit + 1) {
        truncated = true;
        return false;
      }
      return true;
    }
  });
  truncated ||= ripgrepRun.truncated || ripgrepRun.timedOut;
  return {
    files: sortFileMatches(matches.slice(0, limit), query),
    query,
    truncated
  };
}

async function sourceEditorSearch(context = {}, input = {}) {
  const query = normalizeSourceEditorQuery(input.query || input.q);
  const limit = sourceEditorResultLimit(input.limit, SOURCE_EDITOR_SEARCH_RESULT_LIMIT);
  const results = [];
  let truncated = false;
  if (!query) {
    return {
      query,
      results,
      truncated
    };
  }

  const ripgrepRun = await runRipgrepLines([
    "--json",
    "--fixed-strings",
    "--smart-case",
    "--line-number",
    "--column",
    "--max-columns",
    "240",
    "--max-columns-preview",
    ...sourceEditorRipgrepBaseArgs(context.policy),
    "--",
    query
  ], {
    cwd: context.sourceRoot,
    onLine(line = "") {
      const match = sourceEditorSearchMatchFromRipgrepLine(line);
      if (!match || sourceEditorPathExcluded(context.policy, match.path)) {
        return true;
      }
      results.push(match);
      if (results.length >= limit + 1) {
        truncated = true;
        return false;
      }
      return true;
    }
  });
  truncated ||= ripgrepRun.truncated || ripgrepRun.timedOut;

  return {
    query,
    results: results.slice(0, limit),
    truncated
  };
}

function sourceEditorSearchMatchFromRipgrepLine(line = "") {
  let event = null;
  try {
    event = JSON.parse(line);
  } catch {
    return null;
  }
  if (event?.type !== "match") {
    return null;
  }
  const data = event.data || {};
  const relativePath = normalizeRipgrepPath(data.path?.text || "");
  if (!relativePath) {
    return null;
  }
  const firstSubmatch = Array.isArray(data.submatches) ? data.submatches[0] : null;
  return {
    column: Math.max(1, Number(firstSubmatch?.start || 0) + 1),
    line: Math.max(1, Number(data.line_number || 1)),
    path: relativePath,
    preview: String(data.lines?.text || "").replace(/\r?\n$/u, "")
  };
}

async function runRipgrepLines(args = [], {
  cwd = "",
  onLine = () => true,
  timeoutMs = SOURCE_EDITOR_SEARCH_TIMEOUT_MS
} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("rg", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let buffer = "";
    let stderr = "";
    let settled = false;
    let stopped = false;
    let timedOut = false;
    const timeout = setTimeout(() => {
      stopped = true;
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    function finishResolve(result = {}) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    }

    function finishReject(error) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      reject(error);
    }

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/u, "");
        buffer = buffer.slice(newlineIndex + 1);
        if (onLine(line) === false) {
          stopped = true;
          child.kill("SIGTERM");
          return;
        }
        newlineIndex = buffer.indexOf("\n");
      }
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      if (error?.code === "ENOENT") {
        finishReject(sourceEditorError("Source search requires ripgrep (rg) on the Vibe64 host.", "vibe64_source_editor_rg_missing", {}, 500));
        return;
      }
      finishReject(error);
    });

    child.on("close", (code) => {
      if (settled) {
        return;
      }
      if (buffer && !stopped) {
        onLine(buffer.replace(/\r$/u, ""));
      }
      if (stopped || code === 0 || code === 1) {
        finishResolve({
          timedOut,
          truncated: stopped
        });
        return;
      }
      finishReject(sourceEditorError(
        stderr.trim() || "Source search failed.",
        "vibe64_source_editor_rg_failed",
        { exitCode: code },
        500
      ));
    });
  });
}

async function sourceEditorTree(context = {}, input = {}) {
  return sourceEditorDirectoryPage(context, {
    limit: input.limit,
    offset: input.offset,
    path: input.path
  });
}

async function sourceEditorDirectoryPage(context = {}, {
  limit = SOURCE_EDITOR_TREE_PAGE_LIMIT,
  offset = 0,
  path: relativePathValue = ""
} = {}) {
  const {
    policy,
    sourceRoot
  } = context;
  const relativePath = normalizeSourceEditorRelativePath(relativePathValue);
  if (relativePath && sourceEditorPathExcluded(policy, relativePath)) {
    throw sourceEditorError("The selected directory is excluded by the project adapter.", "vibe64_source_editor_directory_excluded", {
      path: relativePath
    }, 403);
  }
  const absolutePath = absoluteSourceEditorPath(sourceRoot, relativePath);
  const stats = await lstat(absolutePath);
  if (stats.isSymbolicLink()) {
    throw sourceEditorError("Source editor does not browse symbolic links.", "vibe64_source_editor_symlink", {
      path: relativePath
    }, 403);
  }
  if (!stats.isDirectory()) {
    throw sourceEditorError("Choose a source directory.", "vibe64_invalid_source_editor_path", {
      path: relativePath
    });
  }

  const depth = relativePath ? relativePath.split("/").length : 0;
  const normalizedLimit = sourceEditorResultLimit(limit, SOURCE_EDITOR_TREE_PAGE_LIMIT);
  const normalizedOffset = sourceEditorResultOffset(offset);
  if (depth >= policy.maxTreeDepth) {
    return directoryNode(relativePath, [], {
      hasMore: false,
      limit: normalizedLimit,
      loaded: true,
      nextOffset: normalizedOffset,
      offset: normalizedOffset,
      total: 0,
      truncated: true
    });
  }

  const entries = await readdir(absolutePath, {
    withFileTypes: true
  });
  entries.sort((left, right) => {
    if (left.isDirectory() !== right.isDirectory()) {
      return left.isDirectory() ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });

  const visibleEntries = [];
  for (const entry of entries) {
    const childRelativePath = relativePath
      ? `${relativePath}/${entry.name}`
      : entry.name;
    if (sourceEditorPathExcluded(policy, childRelativePath) || entry.isSymbolicLink()) {
      continue;
    }
    if (entry.isDirectory() || entry.isFile()) {
      visibleEntries.push({
        entry,
        relativePath: childRelativePath
      });
    }
  }

  const total = Math.min(visibleEntries.length, policy.maxTreeEntries);
  const pageEntries = visibleEntries.slice(normalizedOffset, Math.min(total, normalizedOffset + normalizedLimit));
  const children = await Promise.all(pageEntries.map(async ({ entry, relativePath: childRelativePath }) => {
    if (entry.isDirectory()) {
      return directoryNode(childRelativePath, [], {
        loaded: false
      });
    }
    return sourceEditorFileNode(sourceRoot, childRelativePath);
  }));
  const nextOffset = Math.min(total, normalizedOffset + children.length);
  return directoryNode(relativePath, children, {
    hasMore: nextOffset < total,
    limit: normalizedLimit,
    loaded: true,
    nextOffset,
    offset: normalizedOffset,
    total,
    truncated: visibleEntries.length > total
  });
}

function directoryNode(relativePath = "", children = [], metadata = {}) {
  return {
    children,
    hasMore: metadata.hasMore === true,
    limit: Number.isInteger(metadata.limit) ? metadata.limit : SOURCE_EDITOR_TREE_PAGE_LIMIT,
    loaded: metadata.loaded === true,
    name: relativePath ? path.posix.basename(relativePath) : "",
    nextOffset: Number.isInteger(metadata.nextOffset) ? metadata.nextOffset : children.length,
    offset: Number.isInteger(metadata.offset) ? metadata.offset : 0,
    path: relativePath,
    total: Number.isInteger(metadata.total) ? metadata.total : children.length,
    truncated: metadata.truncated === true,
    type: "directory"
  };
}

async function sourceEditorFileNode(sourceRoot = "", relativePath = "") {
  const stats = await lstat(absoluteSourceEditorPath(sourceRoot, relativePath));
  return {
    language: sourceEditorLanguageForPath(relativePath),
    name: path.posix.basename(relativePath),
    path: relativePath,
    size: stats.size,
    type: "file"
  };
}

async function sourceEditorExistingFile(context = {}, relativePathValue = "") {
  const relativePath = normalizeSourceEditorRelativePath(relativePathValue);
  if (!relativePath) {
    throw sourceEditorError("Choose a file before editing.", "vibe64_invalid_source_editor_path");
  }
  if (sourceEditorPathExcluded(context.policy, relativePath)) {
    throw sourceEditorError("The selected file is excluded by the project adapter.", "vibe64_source_editor_file_excluded", {
      path: relativePath
    }, 403);
  }

  const absolutePath = absoluteSourceEditorPath(context.sourceRoot, relativePath);
  const stats = await lstat(absolutePath);
  if (stats.isSymbolicLink()) {
    throw sourceEditorError("Source editor does not edit symbolic links.", "vibe64_source_editor_symlink", {
      path: relativePath
    }, 403);
  }
  if (!stats.isFile()) {
    throw sourceEditorError("Choose a source file, not a directory.", "vibe64_invalid_source_editor_path", {
      path: relativePath
    });
  }
  if (stats.size > context.policy.maxFileBytes) {
    throw sourceEditorError("The selected file is too large for the source editor.", "vibe64_source_editor_file_too_large", {
      maxFileBytes: context.policy.maxFileBytes,
      path: relativePath,
      size: stats.size
    }, 413);
  }
  return {
    absolutePath,
    relativePath,
    stats
  };
}

async function readSourceEditorFile(context = {}, relativePathValue = "") {
  const file = await sourceEditorExistingFile(context, relativePathValue);
  const buffer = await readFile(file.absolutePath);
  assertTextBuffer(buffer, file.relativePath);
  return sourceEditorFilePayload(file.relativePath, buffer, file.stats);
}

function normalizeSourceEditorExplanationId(value = "") {
  const id = normalizeText(value);
  if (!/^[a-z0-9_-]+$/u.test(id)) {
    throw sourceEditorError("Invalid source explanation id.", "vibe64_source_explanation_id_invalid");
  }
  return id;
}

function sourceEditorExplanationMemoryKey(context = {}, explanationId = "") {
  return `${normalizeText(context.sessionId)}:${normalizeSourceEditorExplanationId(explanationId)}`;
}

function sourceEditorExplanationStore(explanationChats = null) {
  return explanationChats instanceof Map ? explanationChats : new Map();
}

async function readSourceEditorExplanationRecord(context = {}, explanationId = "", {
  explanationChats = null
} = {}) {
  const store = sourceEditorExplanationStore(explanationChats);
  const record = store.get(sourceEditorExplanationMemoryKey(context, explanationId));
  if (!record) {
    throw sourceEditorError("Source explanation was not found.", "vibe64_source_explanation_not_found", {
      explanationId
    }, 404);
  }
  return normalizeSourceEditorExplanation(record);
}

async function writeSourceEditorExplanation(context = {}, explanation = {}, {
  explanationChats = null
} = {}) {
  const store = sourceEditorExplanationStore(explanationChats);
  const record = normalizeSourceEditorExplanation({
    ...explanation,
    updatedAt: new Date().toISOString()
  });
  store.set(sourceEditorExplanationMemoryKey(context, record.id), record);
  return record;
}

function normalizeSourceEditorExplanation(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const sourceRange = source.sourceRange && typeof source.sourceRange === "object" && !Array.isArray(source.sourceRange)
    ? source.sourceRange
    : {};
  return {
    body: String(source.body || ""),
    codexSessionId: normalizeText(source.codexSessionId),
    createdAt: normalizeText(source.createdAt),
    engine: normalizeText(source.engine || (source.codexSessionId ? "codex-app-server" : "")),
    followups: normalizeSourceEditorFollowups(source.followups),
    id: normalizeSourceEditorExplanationId(source.id),
    messages: normalizeSourceEditorMessages(source.messages),
    model: normalizeText(source.model || "codex-app-server"),
    promptVersion: normalizeText(source.promptVersion || SOURCE_EDITOR_EXPLANATION_PROMPT_VERSION),
    sourceRange: {
      endColumn: positiveInteger(sourceRange.endColumn, 1),
      endLine: positiveInteger(sourceRange.endLine, 1),
      fileHash: normalizeText(sourceRange.fileHash),
      language: normalizeText(sourceRange.language || sourceEditorLanguageForPath(sourceRange.path)),
      path: normalizeSourceEditorRelativePath(sourceRange.path),
      selectedTextHash: normalizeText(sourceRange.selectedTextHash),
      startColumn: positiveInteger(sourceRange.startColumn, 1),
      startLine: positiveInteger(sourceRange.startLine, 1)
    },
    stale: source.stale === true,
    staleReason: normalizeText(source.staleReason),
    status: normalizeText(source.status || "ready"),
    summary: String(source.summary || ""),
    title: normalizeText(source.title || "Code explanation"),
    updatedAt: normalizeText(source.updatedAt)
  };
}

function normalizeSourceEditorFollowups(value = []) {
  return (Array.isArray(value) ? value : [])
    .map((entry) => {
      const role = normalizeText(entry?.role);
      const text = String(entry?.text || "");
      if (!["assistant", "user"].includes(role) || !text.trim()) {
        return null;
      }
      return {
        createdAt: normalizeText(entry.createdAt),
        id: normalizeText(entry.id) || sourceEditorExplanationMessageId(),
        role,
        text
      };
    })
    .filter(Boolean);
}

function normalizeSourceEditorMessages(value = []) {
  return (Array.isArray(value) ? value : [])
    .map((entry) => {
      const role = normalizeText(entry?.role);
      const text = String(entry?.text || "");
      if (!["assistant", "user"].includes(role) || !text.trim()) {
        return null;
      }
      return {
        createdAt: normalizeText(entry.createdAt),
        id: normalizeText(entry.id) || sourceEditorExplanationMessageId(),
        role,
        status: normalizeText(entry.status || "complete"),
        text
      };
    })
    .filter(Boolean);
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function sourceEditorExplanationId() {
  return `exp_${crypto.randomUUID().replaceAll("-", "").slice(0, 18)}`;
}

function sourceEditorExplanationMessageId() {
  return `msg_${crypto.randomUUID().replaceAll("-", "").slice(0, 18)}`;
}

function sourceEditorTextHash(text = "") {
  return sourceEditorHash(Buffer.from(String(text ?? ""), "utf8"));
}

function normalizeSourceEditorLineRange(input = {}, lineCount = 1) {
  const boundedLineCount = Math.max(1, Number(lineCount || 1));
  const startLine = Math.min(boundedLineCount, positiveInteger(input.startLine, 1));
  const endLine = Math.min(boundedLineCount, positiveInteger(input.endLine, startLine));
  return {
    endColumn: positiveInteger(input.endColumn, 1),
    endLine: Math.max(startLine, endLine),
    startColumn: positiveInteger(input.startColumn, 1),
    startLine
  };
}

function sourceEditorRangeWithSelectionColumns(range = {}, input = {}, lines = []) {
  const lastLine = lines[range.endLine - 1] || "";
  const hasEndColumn = Number.isSafeInteger(Number(input.endColumn)) && Number(input.endColumn) > 0;
  const hasStartColumn = Number.isSafeInteger(Number(input.startColumn)) && Number(input.startColumn) > 0;
  const startColumn = hasStartColumn ? range.startColumn : 1;
  const endColumn = hasEndColumn ? range.endColumn : lastLine.length + 1;
  return {
    ...range,
    endColumn: range.startLine === range.endLine
      ? Math.max(startColumn, endColumn)
      : endColumn,
    startColumn
  };
}

function sourceEditorLines(text = "") {
  return String(text ?? "").split(/\r?\n/u);
}

function sourceEditorSelectionForRange(text = "", range = {}) {
  const lines = sourceEditorLines(text);
  const selectedLines = lines
    .slice(range.startLine - 1, range.endLine)
    .map((line, index, selected) => {
      const firstLine = index === 0;
      const lastLine = index === selected.length - 1;
      const startIndex = firstLine
        ? sourceEditorColumnIndex(line, range.startColumn, 0)
        : 0;
      const endIndex = lastLine
        ? sourceEditorColumnIndex(line, range.endColumn, line.length)
        : line.length;
      return line.slice(startIndex, Math.max(startIndex, endIndex));
    });
  return selectedLines.join("\n");
}

function sourceEditorColumnIndex(line = "", column = 1, fallback = 0) {
  const index = positiveInteger(column, fallback + 1) - 1;
  return Math.min(String(line || "").length, Math.max(0, index));
}

function sourceEditorContextWindow(text = "", range = {}) {
  const lines = sourceEditorLines(text);
  const startLine = Math.max(1, range.startLine - SOURCE_EDITOR_EXPLANATION_CONTEXT_LINES);
  const endLine = Math.min(lines.length, range.endLine + SOURCE_EDITOR_EXPLANATION_CONTEXT_LINES);
  return lines
    .slice(startLine - 1, endLine)
    .map((line, index) => `${startLine + index}: ${line}`)
    .join("\n");
}

async function sourceEditorExplanationInput(context = {}, input = {}) {
  const file = await readSourceEditorFile(context, input.path);
  const lines = sourceEditorLines(file.text);
  const range = sourceEditorRangeWithSelectionColumns(
    normalizeSourceEditorLineRange(input, lines.length),
    input,
    lines
  );
  const selectedText = sourceEditorSelectionForRange(file.text, range);
  if (!selectedText.trim()) {
    throw sourceEditorError("Select code before asking for an explanation.", "vibe64_source_explanation_empty_selection");
  }
  const selectedLineCount = range.endLine - range.startLine + 1;
  if (selectedLineCount > SOURCE_EDITOR_EXPLANATION_MAX_LINES) {
    throw sourceEditorError("Select a smaller code range before asking for an explanation.", "vibe64_source_explanation_selection_too_large", {
      maxLines: SOURCE_EDITOR_EXPLANATION_MAX_LINES,
      selectedLineCount
    }, 413);
  }
  const selectedTextHash = sourceEditorTextHash(selectedText);
  const promptVersion = SOURCE_EDITOR_EXPLANATION_PROMPT_VERSION;
  return {
    contextWindow: sourceEditorContextWindow(file.text, range),
    file,
    promptVersion,
    range: {
      ...range,
      fileHash: file.hash,
      language: file.language,
      path: file.path,
      selectedTextHash
    },
    selectedText
  };
}

async function createSourceEditorExplanation(context = {}, input = {}, {
  explanationChats = null,
  explanationGenerator = generateSourceEditorExplanationWithAppServer
} = {}) {
  const explanationInput = await sourceEditorExplanationInput(context, input);
  const generated = normalizeGeneratedSourceEditorExplanation(
    await explanationGenerator(explanationInput, {
      context
    })
  );
  return withSourceEditorExplanationFreshness(context, await writeSourceEditorExplanation(context, {
    ...generated,
    codexSessionId: generated.codexSessionId,
    createdAt: new Date().toISOString(),
    engine: generated.engine,
    followups: [],
    id: sourceEditorExplanationId(),
    messages: generated.messages,
    model: generated.model || "codex-app-server",
    promptVersion: explanationInput.promptVersion,
    sourceRange: explanationInput.range,
    status: "ready"
  }, {
    explanationChats
  }));
}

function normalizeGeneratedSourceEditorExplanation(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    body: String(source.body || ""),
    codexSessionId: normalizeText(source.codexSessionId),
    engine: normalizeText(source.engine),
    messages: normalizeSourceEditorMessages(source.messages),
    model: normalizeText(source.model),
    summary: String(source.summary || ""),
    title: normalizeText(source.title || "Code explanation")
  };
}

async function readSourceEditorExplanation(context = {}, explanationId = "", {
  explanationChats = null
} = {}) {
  return withSourceEditorExplanationFreshness(
    context,
    await readSourceEditorExplanationRecord(context, explanationId, {
      explanationChats
    })
  );
}

async function withSourceEditorExplanationFreshness(context = {}, explanation = {}) {
  const record = normalizeSourceEditorExplanation(explanation);
  try {
    const file = await readSourceEditorFile(context, record.sourceRange.path);
    const range = normalizeSourceEditorLineRange(record.sourceRange, sourceEditorLines(file.text).length);
    const selectedTextHash = sourceEditorTextHash(sourceEditorSelectionForRange(file.text, range));
    const sameFileHash = file.hash === record.sourceRange.fileHash;
    const sameSelectionHash = selectedTextHash === record.sourceRange.selectedTextHash;
    return {
      ...record,
      stale: !sameFileHash || !sameSelectionHash,
      staleReason: sameFileHash && sameSelectionHash
        ? ""
        : (sameSelectionHash ? "The file changed around this explanation." : "The selected code changed.")
    };
  } catch {
    return {
      ...record,
      stale: true,
      staleReason: "The source file is no longer available."
    };
  }
}

async function generateSourceEditorExplanationWithAppServer(explanationInput = {}, {
  context = {},
  terminalService = null
} = {}) {
  if (!terminalService || typeof terminalService.runDetachedCodexChatTurn !== "function") {
    throw sourceEditorError("Codex app-server chat is not available for source explanations.", "vibe64_source_explanation_codex_unavailable", {}, 409);
  }
  const displayPrompt = sourceEditorExplanationDisplayPrompt(explanationInput);
  const result = await terminalService.runDetachedCodexChatTurn(context.sessionId || context.session?.sessionId || context.session?.id, {
    prompt: sourceEditorExplanationPrompt(explanationInput),
    promptLabel: "Source code explanation",
    timeoutMs: SOURCE_EDITOR_EXPLANATION_CHAT_TIMEOUT_MS
  });
  if (result?.ok === false) {
    throw sourceEditorError(
      result.error || "Codex could not explain this code.",
      result.code || "vibe64_source_explanation_codex_failed",
      result,
      result.statusCode || 502
    );
  }
  const body = String(result?.text || "").trim();
  if (!body) {
    throw sourceEditorError("Codex returned an empty source explanation.", "vibe64_source_explanation_codex_empty", {}, 502);
  }
  const createdAt = new Date().toISOString();
  return {
    body,
    codexSessionId: normalizeText(result.threadId),
    engine: "codex-app-server",
    messages: [
      sourceEditorExplanationMessage("user", displayPrompt, createdAt),
      sourceEditorExplanationMessage("assistant", body)
    ],
    model: "codex-app-server",
    summary: sourceEditorExplanationSummary(body),
    title: sourceEditorExplanationTitle(explanationInput)
  };
}

function sourceEditorExplanationTitle({
  file = {},
  range = {}
} = {}) {
  return `${path.posix.basename(file.path || "Source")} lines ${range.startLine}-${range.endLine}`;
}

function sourceEditorExplanationSummary(text = "") {
  const firstParagraph = String(text || "")
    .split(/\n\s*\n/u)
    .map((line) => line.trim())
    .find(Boolean) || "";
  return firstParagraph.slice(0, 280);
}

function sourceEditorExplanationDisplayPrompt({
  file = {},
  range = {}
} = {}) {
  return `Explain ${file.path}:${range.startLine}-${range.endLine}.`;
}

function sourceEditorExplanationMessage(role = "", text = "", createdAt = new Date().toISOString()) {
  return {
    createdAt,
    id: sourceEditorExplanationMessageId(),
    role,
    status: "complete",
    text: String(text || "")
  };
}

function sourceEditorExplanationMessagesForAppend(explanation = {}) {
  const existing = normalizeSourceEditorMessages(explanation.messages);
  if (existing.length) {
    return existing;
  }
  return normalizeSourceEditorMessages([
    ...(explanation.body
      ? [{
          id: "body",
          role: "assistant",
          text: explanation.body
        }]
      : []),
    ...normalizeSourceEditorFollowups(explanation.followups)
  ]);
}

function sourceEditorExplanationPrompt({
  contextWindow = "",
  file = {},
  range = {},
  selectedText = ""
} = {}) {
  return [
    "You are Vibe64's source-code explainer.",
    "Explain the selected code range for a developer reading this project.",
    "Use the selected text and nearby context below. You may inspect the repository read-only if needed.",
    "Do not edit files. Do not suggest unrelated rewrites. Be concrete about what the code does and how it fits nearby code.",
    "Return a clear plain-text or Markdown response. No JSON. No Vibe64 result envelope.",
    "",
    `File: ${file.path}`,
    `Selected range: lines ${range.startLine}-${range.endLine}, columns ${range.startColumn}-${range.endColumn}`,
    `Language: ${range.language || file.language || sourceEditorLanguageForPath(file.path)}`,
    "",
    "Selected code:",
    "```",
    selectedText,
    "```",
    "",
    "Nearby context:",
    "```",
    contextWindow,
    "```"
  ].join("\n");
}

async function addSourceEditorExplanationFollowup(context = {}, input = {}, {
  explanationChats = null,
  explanationFollowupGenerator = generateSourceEditorExplanationFollowupWithAppServer
} = {}) {
  const message = String(input.message || "").trim();
  if (!message) {
    throw sourceEditorError("Enter a question before sending a follow-up.", "vibe64_source_explanation_followup_empty");
  }
  if (message.length > SOURCE_EDITOR_FOLLOWUP_MAX_LENGTH) {
    throw sourceEditorError("Follow-up question is too long.", "vibe64_source_explanation_followup_too_large", {
      maxLength: SOURCE_EDITOR_FOLLOWUP_MAX_LENGTH
    }, 413);
  }
  const explanation = await readSourceEditorExplanation(context, input.explanationId, {
    explanationChats
  });
  const createdAt = new Date().toISOString();
  const generated = await explanationFollowupGenerator(explanation, message, {
    context
  });
  const followupAnswer = normalizeGeneratedSourceEditorFollowup(generated);
  const answer = followupAnswer.answer;
  if (!answer) {
    throw sourceEditorError("Codex returned an empty source explanation answer.", "vibe64_source_explanation_codex_invalid", {}, 502);
  }
  const nextFollowups = [
    ...explanation.followups,
    {
      createdAt,
      id: sourceEditorExplanationMessageId(),
      role: "user",
      text: message
    },
    {
      createdAt: new Date().toISOString(),
      id: sourceEditorExplanationMessageId(),
      role: "assistant",
      text: answer
    }
  ];
  const nextMessages = [
    ...sourceEditorExplanationMessagesForAppend(explanation),
    sourceEditorExplanationMessage("user", message, createdAt),
    sourceEditorExplanationMessage("assistant", answer)
  ];
  return withSourceEditorExplanationFreshness(context, await writeSourceEditorExplanation(context, {
    ...explanation,
    body: answer,
    codexSessionId: followupAnswer.codexSessionId || explanation.codexSessionId,
    engine: followupAnswer.engine || explanation.engine,
    model: followupAnswer.model || explanation.model,
    followups: nextFollowups,
    messages: nextMessages,
    summary: sourceEditorExplanationSummary(answer)
  }, {
    explanationChats
  }));
}

async function deleteSourceEditorExplanation(context = {}, explanationId = "", {
  explanationChats = null,
  terminalService = null
} = {}) {
  const store = sourceEditorExplanationStore(explanationChats);
  const key = sourceEditorExplanationMemoryKey(context, explanationId);
  const explanation = store.get(key);
  if (!explanation) {
    return {
      codexCleanup: {
        ok: true,
        status: "notFound"
      },
      deleted: false
    };
  }
  const threadId = normalizeText(explanation.codexSessionId);
  if (!threadId) {
    store.delete(key);
    return {
      codexCleanup: {
        ok: true,
        status: "notFound",
        threadId
      },
      deleted: true
    };
  }
  if (typeof terminalService?.deleteDetachedCodexChatThread !== "function") {
    throw sourceEditorError(
      "Codex app-server chat cleanup is not available.",
      "vibe64_source_explanation_codex_cleanup_unavailable",
      { threadId },
      409
    );
  }
  const codexCleanup = await terminalService.deleteDetachedCodexChatThread(context.sessionId, {
    threadId
  });
  if (codexCleanup?.ok === false) {
    throw sourceEditorError(
      codexCleanup.error || "Codex app-server could not delete the temporary source explanation chat.",
      codexCleanup.code || "vibe64_source_explanation_codex_cleanup_failed",
      codexCleanup,
      codexCleanup.statusCode || 502
    );
  }
  store.delete(key);
  return {
    codexCleanup,
    deleted: true
  };
}

function normalizeGeneratedSourceEditorFollowup(value = "") {
  if (typeof value === "string") {
    return {
      answer: value.trim()
    };
  }
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    answer: String(source.answer || source.text || "").trim(),
    codexSessionId: normalizeText(source.codexSessionId),
    engine: normalizeText(source.engine),
    model: normalizeText(source.model)
  };
}

async function generateSourceEditorExplanationFollowupWithAppServer(explanation = {}, message = "", {
  context = {},
  terminalService = null
} = {}) {
  if (!terminalService || typeof terminalService.runDetachedCodexChatTurn !== "function") {
    throw sourceEditorError("Codex app-server chat is not available for source explanations.", "vibe64_source_explanation_codex_unavailable", {}, 409);
  }
  const codexSessionId = normalizeText(explanation.codexSessionId);
  if (!codexSessionId) {
    throw sourceEditorError(
      "Regenerate this explanation before asking follow-up questions. It was created before source explanation chat was available.",
      "vibe64_source_explanation_codex_session_missing",
      {},
      409
    );
  }
  const result = await terminalService.runDetachedCodexChatTurn(context.sessionId || context.session?.sessionId || context.session?.id, {
    prompt: sourceEditorExplanationFollowupPrompt(explanation, message),
    promptLabel: "Source code explanation follow-up",
    threadId: codexSessionId,
    timeoutMs: SOURCE_EDITOR_EXPLANATION_CHAT_TIMEOUT_MS
  });
  if (result?.ok === false) {
    throw sourceEditorError(
      result.error || "Codex could not answer this source explanation follow-up.",
      result.code || "vibe64_source_explanation_codex_failed",
      result,
      result.statusCode || 502
    );
  }
  const answer = String(result?.text || "").trim();
  if (!answer) {
    throw sourceEditorError("Codex returned an empty source explanation answer.", "vibe64_source_explanation_codex_empty", {}, 502);
  }
  return {
    answer,
    codexSessionId: normalizeText(result.threadId) || codexSessionId,
    engine: "codex-app-server",
    model: "codex-app-server"
  };
}

function sourceEditorExplanationFollowupPrompt(explanation = {}, message = "") {
  const range = explanation.sourceRange || {};
  return [
    "Continue the Vibe64 source-code explanation thread.",
    "Answer the user's follow-up about the same selected source range. You may inspect the repository read-only if needed.",
    "Do not edit files. If the current explanation is stale, say so plainly before answering.",
    "Return a clear plain-text or Markdown response. No JSON. No Vibe64 result envelope.",
    "",
    `File: ${range.path}`,
    `Selected range: lines ${range.startLine}-${range.endLine}, columns ${range.startColumn}-${range.endColumn}`,
    explanation.stale ? `Stale status: ${explanation.staleReason || "The source changed."}` : "Stale status: current",
    "",
    "Current explanation summary:",
    explanation.summary || "(none)",
    "",
    "Current explanation body:",
    explanation.body || "(none)",
    "",
    "User follow-up:",
    message
  ].join("\n");
}

async function saveSourceEditorFile(context = {}, input = {}) {
  const file = await sourceEditorExistingFile(context, input.path);
  const currentBuffer = await readFile(file.absolutePath);
  assertTextBuffer(currentBuffer, file.relativePath);
  const currentHash = sourceEditorHash(currentBuffer);
  const baseHash = normalizeText(input.baseHash);
  if (baseHash && baseHash !== currentHash) {
    throw sourceEditorError("This file changed on disk. Reload it before saving.", SOURCE_EDITOR_CONFLICT_CODE, {
      currentHash,
      path: file.relativePath
    }, 409);
  }

  const nextText = String(input.text ?? "");
  const nextBuffer = Buffer.from(nextText, "utf8");
  if (nextBuffer.byteLength > context.policy.maxFileBytes) {
    throw sourceEditorError("The edited file is too large for the source editor.", "vibe64_source_editor_file_too_large", {
      maxFileBytes: context.policy.maxFileBytes,
      path: file.relativePath,
      size: nextBuffer.byteLength
    }, 413);
  }
  assertTextBuffer(nextBuffer, file.relativePath);
  await atomicWriteTextFile(file.absolutePath, nextText);
  const savedBuffer = await readFile(file.absolutePath);
  const savedStats = await lstat(file.absolutePath);
  return sourceEditorFilePayload(file.relativePath, savedBuffer, savedStats, {
    text: undefined
  });
}

function assertTextBuffer(buffer, relativePath = "") {
  if (buffer.includes(0)) {
    throw sourceEditorError("The selected file appears to be binary.", "vibe64_source_editor_binary_file", {
      path: relativePath
    }, 415);
  }
}

async function atomicWriteTextFile(absolutePath = "", text = "") {
  const temporaryPath = path.join(
    path.dirname(absolutePath),
    `.vibe64-editor-${process.pid}-${Date.now()}-${path.basename(absolutePath)}`
  );
  try {
    await writeFile(temporaryPath, text, "utf8");
    await rename(temporaryPath, absolutePath);
  } finally {
    await rm(temporaryPath, {
      force: true
    }).catch(() => null);
  }
}

function sourceEditorHash(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function sourceEditorFilePayload(relativePath = "", buffer, stats, overrides = {}) {
  return {
    hash: sourceEditorHash(buffer),
    language: sourceEditorLanguageForPath(relativePath),
    mtimeMs: stats.mtimeMs,
    path: relativePath,
    size: buffer.byteLength,
    text: buffer.toString("utf8"),
    ...overrides
  };
}

function sourceEditorLanguageForPath(filePath = "") {
  const basename = path.posix.basename(String(filePath || "")).toLowerCase();
  const extension = path.posix.extname(basename);
  if ([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".vue"].includes(extension)) {
    return "javascript";
  }
  if (extension === ".json") {
    return "json";
  }
  if ([".c", ".cc", ".cpp", ".cxx", ".h", ".hh", ".hpp", ".hxx"].includes(extension)) {
    return "cpp";
  }
  if ([".sh", ".bash", ".zsh", ".fish"].includes(extension) || ["bashrc", "zshrc"].includes(basename)) {
    return "shell";
  }
  if ([".md", ".markdown", ".todo"].includes(extension) || basename === "todo") {
    return "markdown";
  }
  return "text";
}

export {
  SOURCE_EDITOR_CONFLICT_CODE,
  createService,
  normalizeSourceEditorRelativePath,
  pathMatchesPolicyPattern,
  sourceEditorLanguageForPath
};
