import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

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
const SOURCE_EDITOR_EXPLANATION_SCHEMA = "vibe64.source_editor.explanation.v1";
const SOURCE_EDITOR_EXPLANATION_SCHEMA_VERSION = 1;
const SOURCE_EDITOR_EXPLANATIONS_DIR = "source-explanations";
const SOURCE_EDITOR_EXPLANATIONS_INDEX = "index.json";
const SOURCE_EDITOR_EXPLANATION_CONTEXT_LINES = 6;
const SOURCE_EDITOR_EXPLANATION_MAX_LINES = 240;
const SOURCE_EDITOR_FOLLOWUP_MAX_LENGTH = 2000;

function createService({
  explanationFollowupGenerator = null,
  explanationGenerator = null,
  projectService
} = {}) {
  if (!projectService || typeof projectService.createRuntime !== "function") {
    throw new TypeError("createService requires feature.vibe64-project.service.");
  }
  const sourceExplanationGenerator = typeof explanationGenerator === "function"
    ? explanationGenerator
    : generateSourceEditorExplanation;
  const sourceExplanationFollowupGenerator = typeof explanationFollowupGenerator === "function"
    ? explanationFollowupGenerator
    : generateSourceEditorExplanationFollowupAnswer;

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
          tree: await sourceEditorTree(context)
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

    async listExplanations(input = {}) {
      return runSourceEditorOperation(async () => {
        const context = await sourceEditorContext(input.sessionId);
        return {
          explanations: await listSourceEditorExplanations(context),
          ok: true
        };
      });
    },

    async explainSelection(input = {}) {
      return runSourceEditorOperation(async () => {
        const context = await sourceEditorContext(input.sessionId);
        return {
          explanation: await createSourceEditorExplanation(context, input, {
            explanationGenerator: sourceExplanationGenerator
          }),
          ok: true
        };
      });
    },

    async readExplanation(input = {}) {
      return runSourceEditorOperation(async () => {
        const context = await sourceEditorContext(input.sessionId);
        return {
          explanation: await readSourceEditorExplanation(context, input.explanationId),
          ok: true
        };
      });
    },

    async addExplanationFollowup(input = {}) {
      return runSourceEditorOperation(async () => {
        const context = await sourceEditorContext(input.sessionId);
        return {
          explanation: await addSourceEditorExplanationFollowup(context, input, {
            explanationFollowupGenerator: sourceExplanationFollowupGenerator
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
    maxTreeEntries: policy.maxTreeEntries
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

async function sourceEditorTree(context = {}) {
  const counter = {
    truncated: false,
    value: 0
  };
  const rootNode = await sourceEditorDirectoryNode(context, "", 0, counter);
  return {
    ...rootNode,
    truncated: counter.truncated
  };
}

async function sourceEditorDirectoryNode(context = {}, relativePath = "", depth = 0, counter = {}) {
  const {
    policy,
    sourceRoot
  } = context;
  const absolutePath = absoluteSourceEditorPath(sourceRoot, relativePath);
  const children = [];
  if (depth >= policy.maxTreeDepth || counter.value >= policy.maxTreeEntries) {
    counter.truncated = true;
    return directoryNode(relativePath, children);
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

  for (const entry of entries) {
    if (counter.value >= policy.maxTreeEntries) {
      counter.truncated = true;
      break;
    }
    const childRelativePath = relativePath
      ? `${relativePath}/${entry.name}`
      : entry.name;
    if (sourceEditorPathExcluded(policy, childRelativePath) || entry.isSymbolicLink()) {
      continue;
    }
    if (entry.isDirectory()) {
      counter.value += 1;
      children.push(await sourceEditorDirectoryNode(context, childRelativePath, depth + 1, counter));
      continue;
    }
    if (entry.isFile()) {
      counter.value += 1;
      children.push(await sourceEditorFileNode(sourceRoot, childRelativePath));
    }
  }
  return directoryNode(relativePath, children);
}

function directoryNode(relativePath = "", children = []) {
  return {
    children,
    name: relativePath ? path.posix.basename(relativePath) : "",
    path: relativePath,
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

function sourceEditorExplanationRoot(context = {}) {
  const sessionRoot = normalizeText(context.session?.sessionRoot);
  if (!sessionRoot) {
    throw sourceEditorError("Source explanations require a session root.", "vibe64_source_explanation_session_root_missing", {}, 409);
  }
  return path.join(sessionRoot, SOURCE_EDITOR_EXPLANATIONS_DIR);
}

function sourceEditorExplanationIndexPath(context = {}) {
  return path.join(sourceEditorExplanationRoot(context), SOURCE_EDITOR_EXPLANATIONS_INDEX);
}

function sourceEditorExplanationRecordPath(context = {}, explanationId = "") {
  const id = normalizeSourceEditorExplanationId(explanationId);
  return path.join(sourceEditorExplanationRoot(context), `${id}.json`);
}

function normalizeSourceEditorExplanationId(value = "") {
  const id = normalizeText(value);
  if (!/^[a-z0-9_-]+$/u.test(id)) {
    throw sourceEditorError("Invalid source explanation id.", "vibe64_source_explanation_id_invalid");
  }
  return id;
}

async function readSourceEditorExplanationIndex(context = {}) {
  try {
    const index = JSON.parse(await readFile(sourceEditorExplanationIndexPath(context), "utf8"));
    return {
      explanationIds: Array.isArray(index.explanationIds)
        ? index.explanationIds.map(normalizeText).filter(Boolean)
        : [],
      schema: SOURCE_EDITOR_EXPLANATION_SCHEMA,
      schemaVersion: SOURCE_EDITOR_EXPLANATION_SCHEMA_VERSION
    };
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      return {
        explanationIds: [],
        schema: SOURCE_EDITOR_EXPLANATION_SCHEMA,
        schemaVersion: SOURCE_EDITOR_EXPLANATION_SCHEMA_VERSION
      };
    }
    throw error;
  }
}

async function writeSourceEditorExplanationIndex(context = {}, explanationIds = []) {
  const root = sourceEditorExplanationRoot(context);
  await mkdir(root, {
    recursive: true
  });
  const nextIds = [...new Set((Array.isArray(explanationIds) ? explanationIds : [])
    .map(normalizeText)
    .filter(Boolean))];
  await atomicWriteJsonFile(sourceEditorExplanationIndexPath(context), {
    explanationIds: nextIds,
    schema: SOURCE_EDITOR_EXPLANATION_SCHEMA,
    schemaVersion: SOURCE_EDITOR_EXPLANATION_SCHEMA_VERSION,
    updatedAt: new Date().toISOString()
  });
}

async function readStoredSourceEditorExplanation(context = {}, explanationId = "") {
  try {
    return normalizeStoredSourceEditorExplanation(JSON.parse(
      await readFile(sourceEditorExplanationRecordPath(context, explanationId), "utf8")
    ));
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      throw sourceEditorError("Source explanation was not found.", "vibe64_source_explanation_not_found", {
        explanationId
      }, 404);
    }
    throw error;
  }
}

async function writeSourceEditorExplanation(context = {}, explanation = {}) {
  const root = sourceEditorExplanationRoot(context);
  await mkdir(root, {
    recursive: true
  });
  const record = normalizeStoredSourceEditorExplanation({
    ...explanation,
    updatedAt: new Date().toISOString()
  });
  await atomicWriteJsonFile(sourceEditorExplanationRecordPath(context, record.id), record);
  const index = await readSourceEditorExplanationIndex(context);
  await writeSourceEditorExplanationIndex(context, [
    record.id,
    ...index.explanationIds.filter((id) => id !== record.id)
  ]);
  return record;
}

function normalizeStoredSourceEditorExplanation(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const sourceRange = source.sourceRange && typeof source.sourceRange === "object" && !Array.isArray(source.sourceRange)
    ? source.sourceRange
    : {};
  return {
    body: String(source.body || ""),
    cacheKey: normalizeText(source.cacheKey),
    createdAt: normalizeText(source.createdAt),
    followups: normalizeSourceEditorFollowups(source.followups),
    id: normalizeSourceEditorExplanationId(source.id),
    model: normalizeText(source.model || "vibe64-local-explainer"),
    promptVersion: normalizeText(source.promptVersion || "source-explanation-v1"),
    schema: SOURCE_EDITOR_EXPLANATION_SCHEMA,
    schemaVersion: SOURCE_EDITOR_EXPLANATION_SCHEMA_VERSION,
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

function sourceEditorExplanationCacheKey({
  path: filePath = "",
  selectedTextHash = "",
  promptVersion = "source-explanation-v1"
} = {}) {
  return sourceEditorTextHash([
    normalizeSourceEditorRelativePath(filePath),
    normalizeText(selectedTextHash),
    normalizeText(promptVersion)
  ].join("\n"));
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
  const promptVersion = "source-explanation-v1";
  const cacheKey = sourceEditorExplanationCacheKey({
    path: file.path,
    promptVersion,
    selectedTextHash
  });
  return {
    cacheKey,
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
  explanationGenerator = generateSourceEditorExplanation
} = {}) {
  const explanationInput = await sourceEditorExplanationInput(context, input);
  if (input.force !== true) {
    const cached = await findCachedSourceEditorExplanation(context, explanationInput.cacheKey);
    if (cached) {
      return withSourceEditorExplanationFreshness(context, cached);
    }
  }
  const generated = normalizeGeneratedSourceEditorExplanation(
    await explanationGenerator(explanationInput, {
      context
    })
  );
  return withSourceEditorExplanationFreshness(context, await writeSourceEditorExplanation(context, {
    ...generated,
    cacheKey: explanationInput.cacheKey,
    createdAt: new Date().toISOString(),
    followups: [],
    id: sourceEditorExplanationId(),
    model: generated.model || "vibe64-local-explainer",
    promptVersion: explanationInput.promptVersion,
    sourceRange: explanationInput.range,
    status: "ready"
  }));
}

function normalizeGeneratedSourceEditorExplanation(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    body: String(source.body || ""),
    model: normalizeText(source.model),
    summary: String(source.summary || ""),
    title: normalizeText(source.title || "Code explanation")
  };
}

async function findCachedSourceEditorExplanation(context = {}, cacheKey = "") {
  const normalizedCacheKey = normalizeText(cacheKey);
  if (!normalizedCacheKey) {
    return null;
  }
  const index = await readSourceEditorExplanationIndex(context);
  for (const explanationId of index.explanationIds) {
    try {
      const explanation = await readStoredSourceEditorExplanation(context, explanationId);
      if (explanation.cacheKey === normalizedCacheKey) {
        return explanation;
      }
    } catch {
      // Ignore stale index entries; a later write will refresh the index order.
    }
  }
  return null;
}

async function listSourceEditorExplanations(context = {}) {
  const index = await readSourceEditorExplanationIndex(context);
  const explanations = [];
  for (const explanationId of index.explanationIds) {
    try {
      explanations.push(await withSourceEditorExplanationFreshness(
        context,
        await readStoredSourceEditorExplanation(context, explanationId)
      ));
    } catch {
      // Missing records should not make the whole explanation index unusable.
    }
  }
  return explanations.sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")));
}

async function readSourceEditorExplanation(context = {}, explanationId = "") {
  return withSourceEditorExplanationFreshness(
    context,
    await readStoredSourceEditorExplanation(context, explanationId)
  );
}

async function withSourceEditorExplanationFreshness(context = {}, explanation = {}) {
  const record = normalizeStoredSourceEditorExplanation(explanation);
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

function generateSourceEditorExplanation({
  contextWindow = "",
  file = {},
  range = {},
  selectedText = ""
} = {}) {
  const lineCount = range.endLine - range.startLine + 1;
  const title = `${path.posix.basename(file.path)} lines ${range.startLine}-${range.endLine}`;
  const signature = firstInterestingCodeLine(selectedText);
  const summary = signature
    ? `This ${lineCount === 1 ? "line" : `${lineCount} line range`} centers on \`${signature}\`.`
    : `This ${lineCount === 1 ? "line" : `${lineCount} line range`} is from ${file.path}.`;
  const body = [
    `This explanation is attached to \`${file.path}:${range.startLine}-${range.endLine}\`.`,
    "",
    "What this section contains:",
    ...sourceEditorExplanationBullets(selectedText),
    "",
    "Nearby context used:",
    "```",
    contextWindow,
    "```"
  ].join("\n");
  return {
    body,
    summary,
    title
  };
}

function firstInterestingCodeLine(text = "") {
  return String(text || "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("//") && !line.startsWith("#"))
    ?.slice(0, 120) || "";
}

function sourceEditorExplanationBullets(text = "") {
  const lines = String(text || "").split(/\r?\n/u);
  const nonEmpty = lines.map((line) => line.trim()).filter(Boolean);
  const importCount = nonEmpty.filter((line) => /^(import|require\()/u.test(line)).length;
  const functionCount = nonEmpty.filter((line) => /\b(function|async function|=>)\b/u.test(line)).length;
  const branchCount = nonEmpty.filter((line) => /\b(if|else|switch|case|for|while|try|catch)\b/u.test(line)).length;
  const bullets = [
    `- It spans ${lines.length} source line${lines.length === 1 ? "" : "s"} with ${nonEmpty.length} non-empty line${nonEmpty.length === 1 ? "" : "s"}.`
  ];
  if (importCount) {
    bullets.push(`- It includes ${importCount} dependency/import line${importCount === 1 ? "" : "s"}.`);
  }
  if (functionCount) {
    bullets.push(`- It defines or passes around function-shaped behavior.`);
  }
  if (branchCount) {
    bullets.push(`- It contains control-flow branches or loops, so behavior depends on runtime state.`);
  }
  if (bullets.length === 1) {
    bullets.push("- Read it together with the surrounding file context shown below.");
  }
  return bullets;
}

async function addSourceEditorExplanationFollowup(context = {}, input = {}, {
  explanationFollowupGenerator = generateSourceEditorExplanationFollowupAnswer
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
  const explanation = await readSourceEditorExplanation(context, input.explanationId);
  const createdAt = new Date().toISOString();
  const answer = String(await explanationFollowupGenerator(explanation, message, {
    context
  }) || "").trim() || generateSourceEditorExplanationFollowupAnswer(explanation, message);
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
  return withSourceEditorExplanationFreshness(context, await writeSourceEditorExplanation(context, {
    ...explanation,
    followups: nextFollowups
  }));
}

function generateSourceEditorExplanationFollowupAnswer(explanation = {}, message = "") {
  return [
    `For \`${explanation.sourceRange.path}:${explanation.sourceRange.startLine}-${explanation.sourceRange.endLine}\`, your question was: ${message}`,
    "",
    explanation.stale
      ? `This explanation is marked stale: ${explanation.staleReason || "the source changed"}. Regenerate it before relying on details.`
      : "The saved explanation still matches the selected source range.",
    "",
    explanation.summary
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

async function atomicWriteJsonFile(absolutePath = "", value = {}) {
  await atomicWriteTextFile(absolutePath, `${JSON.stringify(value, null, 2)}\n`);
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
