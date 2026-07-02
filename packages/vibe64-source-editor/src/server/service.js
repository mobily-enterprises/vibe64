import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { lstat, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  isMissingPathError,
  normalizeText,
  pathExists,
  vibe64Error
} from "@local/vibe64-core/server/core";
import {
  sessionSourcePath
} from "@local/vibe64-core/server/sessionSourcePath";
import {
  writeSessionUiSyncSourceEditorOpen
} from "@local/vibe64-core/server/sessionUiSyncState";
import {
  pathInsideOrEqual
} from "@local/vibe64-core/server/studioProjectContext";
import {
  vibe64ErrorResponse
} from "@local/vibe64-core/server/serverResponses";
import {
  sourceEditorFilePolicy
} from "@local/vibe64-adapters/server/sourceEditorFilePolicy";
import {
  defaultVibe64SourceExplanationAgentSettings,
  effectiveVibe64AgentSettings,
  normalizeVibe64AgentSettings
} from "@local/vibe64-runtime/shared";

const SOURCE_EDITOR_CONFLICT_CODE = "vibe64_source_editor_conflict";
const SOURCE_EDITOR_FILE_MATCH_LIMIT = 80;
const SOURCE_EDITOR_SEARCH_RESULT_LIMIT = 120;
const SOURCE_EDITOR_SEARCH_TIMEOUT_MS = 6000;
const SOURCE_EDITOR_QUERY_MAX_LENGTH = 240;
const SOURCE_EDITOR_TREE_PAGE_LIMIT = 20;
const SOURCE_EDITOR_RESOLVE_EXTENSIONS = [
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".vue",
  ".json",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".html",
  ".md"
];
const SOURCE_EDITOR_EXPLANATION_CONTEXT_LINES = 6;
const SOURCE_EDITOR_EXPLANATION_MAX_LINES = 240;
const SOURCE_EDITOR_FOLLOWUP_MAX_LENGTH = 2000;
const SOURCE_EDITOR_EXPLANATION_CHAT_TIMEOUT_MS = 180_000;
const SOURCE_EDITOR_EXPLANATION_PROMPT_VERSION = "source-explanation-chat-v2";

function isPlainObject(value = null) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function sourceEditorExplanationAgentSettings(input = {}, fallback = null) {
  const explicitSettings = isPlainObject(input?.agentSettings) && Object.keys(input.agentSettings).length > 0
    ? input.agentSettings
    : null;
  const source = explicitSettings
    ? input.agentSettings
    : (isPlainObject(fallback) ? fallback : null);
  return source
    ? normalizeVibe64AgentSettings(source)
    : defaultVibe64SourceExplanationAgentSettings();
}

function sourceEditorExplanationEffectiveAgentSettings(agentSettings = {}) {
  return effectiveVibe64AgentSettings(agentSettings);
}

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
    : (input, options = {}) => generateSourceEditorExplanationWithAgentService(input, {
      ...options,
      terminalService
    });
  const sourceExplanationFollowupGenerator = typeof explanationFollowupGenerator === "function"
    ? explanationFollowupGenerator
    : (explanation, message, options = {}) => generateSourceEditorExplanationFollowupWithAgentService(explanation, message, {
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

    async broadcastOpenFile(input = {}) {
      return runSourceEditorOperation(async () => {
        const context = await sourceEditorContext(input.sessionId);
        const file = await sourceEditorExistingFile(context, input.path);
        const fileOpen = sourceEditorFileOpen(context, input, file);
        writeSessionUiSyncSourceEditorOpen(fileOpen);
        return {
          fileOpen,
          ok: true
        };
      });
    },

    async saveFile(input = {}) {
      return runSourceEditorOperation(async () => {
        const context = await sourceEditorContext(input.sessionId);
        const file = await saveSourceEditorFile(context, input);
        return {
          file,
          fileChange: sourceEditorFileChange(context, input, file),
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

    async resolvePath(input = {}) {
      return runSourceEditorOperation(async () => {
        const context = await sourceEditorContext(input.sessionId);
        return {
          ok: true,
          ...await resolveSourceEditorPath(context, input)
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

    async streamExplanation(input = {}, stream = {}) {
      await streamSourceEditorOperation(async () => {
        const context = await sourceEditorContext(input.sessionId);
        await streamSourceEditorExplanation(context, input, {
          emit: stream.emit,
          explanationChats,
          isClosed: stream.isClosed,
          terminalService
        });
      }, stream);
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

    async streamExplanationFollowup(input = {}, stream = {}) {
      await streamSourceEditorOperation(async () => {
        const context = await sourceEditorContext(input.sessionId);
        await streamSourceEditorExplanationFollowup(context, input, {
          emit: stream.emit,
          explanationChats,
          isClosed: stream.isClosed,
          terminalService
        });
      }, stream);
    },

    async stopExplanation(input = {}) {
      return runSourceEditorOperation(async () => {
        const context = await sourceEditorContext(input.sessionId);
        return {
          explanation: await stopSourceEditorExplanation(context, input.explanationId, {
            explanationChats,
            terminalService
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

async function streamSourceEditorOperation(operation, {
  emit = null
} = {}) {
  try {
    await operation();
  } catch (error) {
    const response = sourceEditorErrorResponse(error);
    if (typeof emit === "function") {
      emit({
        ...response,
        type: "source-explanation.error"
      });
    }
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

function fuzzyCharacterIndexes(text = "", token = "") {
  const normalizedText = String(text || "").toLowerCase();
  const normalizedToken = String(token || "").toLowerCase();
  const indexes = [];
  let cursor = 0;
  for (const character of normalizedToken) {
    const index = normalizedText.indexOf(character, cursor);
    if (index < 0) {
      return null;
    }
    indexes.push(index);
    cursor = index + 1;
  }
  return indexes;
}

function textTokenMatchScore(text = "", token = "") {
  const normalizedText = String(text || "").toLowerCase();
  const normalizedToken = String(token || "").toLowerCase();
  if (!normalizedToken) {
    return 0;
  }
  if (normalizedText === normalizedToken) {
    return 0;
  }
  if (normalizedText.startsWith(normalizedToken)) {
    return 1;
  }
  const substringIndex = normalizedText.indexOf(normalizedToken);
  if (substringIndex >= 0) {
    return 2 + substringIndex / 1000;
  }
  const fuzzyIndexes = fuzzyCharacterIndexes(normalizedText, normalizedToken);
  if (!fuzzyIndexes) {
    return null;
  }
  const span = fuzzyIndexes.at(-1) - fuzzyIndexes[0];
  return 6 + fuzzyIndexes[0] / 1000 + span / 1000000;
}

function filePathTokenMatchScore(filePath = "", token = "") {
  const lowerPath = filePath.toLowerCase();
  const lowerName = path.posix.basename(lowerPath);
  const lowerStem = lowerName.replace(/\.[^.]*$/u, "");
  const nameScore = Math.min(
    textTokenMatchScore(lowerName, token) ?? Number.POSITIVE_INFINITY,
    textTokenMatchScore(lowerStem, token) ?? Number.POSITIVE_INFINITY
  );
  if (Number.isFinite(nameScore)) {
    return nameScore;
  }
  const pathScore = textTokenMatchScore(lowerPath, token);
  return pathScore === null ? null : 10 + pathScore;
}

function filePathMatchesQuery(filePath = "", tokens = []) {
  return !tokens.length || tokens.every((token) => filePathTokenMatchScore(filePath, token) !== null);
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
  if (tokens.length > 1) {
    const tokenScores = tokens.map((token) => filePathTokenMatchScore(lowerPath, token));
    if (tokenScores.some((score) => score === null)) {
      return 99;
    }
    const pathIndexes = orderedTokenIndexes(lowerPath, tokens);
    const nameIndexes = orderedTokenIndexes(lowerName, tokens);
    const allInName = tokens.every((token) => textTokenMatchScore(lowerName, token) !== null);
    const basenameTokenCount = tokens
      .filter((token) => textTokenMatchScore(lowerName, token) !== null)
      .length;
    const firstIndex = pathIndexes?.[0] ?? Math.min(...tokens
      .map((token) => lowerPath.indexOf(token))
      .filter((index) => index >= 0));
    const lastIndex = pathIndexes?.at(-1) ?? Math.max(...tokens
      .map((token) => lowerPath.indexOf(token))
      .filter((index) => index >= 0));
    const span = Number.isFinite(firstIndex) && Number.isFinite(lastIndex)
      ? lastIndex - firstIndex
      : lowerPath.length;
    if (nameIndexes?.[0] === 0) {
      return 1 + span / 1000;
    }
    if (nameIndexes) {
      return 2 + span / 1000;
    }
    if (allInName) {
      return 2.5 + tokenScores.reduce((sum, score) => sum + score, 0) / 100;
    }
    if (pathIndexes && firstIndex === 0) {
      return 3 + span / 1000;
    }
    if (pathIndexes) {
      return 4 + firstIndex / 1000 + span / 1000000;
    }
    return 6 - basenameTokenCount + tokenScores.reduce((sum, score) => sum + score, 0) / 100;
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
      if (!queryTokens.length && matches.length >= limit + 1) {
        truncated = true;
        return false;
      }
      return true;
    }
  });
  truncated ||= ripgrepRun.truncated || ripgrepRun.timedOut;
  truncated ||= matches.length > limit;
  return {
    files: sortFileMatches(matches, query).slice(0, limit),
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

function normalizeSourceEditorImportTarget(value = "") {
  const target = normalizeText(value)
    .replaceAll("\\", "/")
    .split(/[?#]/u)[0]
    .trim();
  if (!target || target.startsWith("//") || /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(target)) {
    return "";
  }
  if (target.startsWith("./") || target.startsWith("../") || target.startsWith("/")) {
    return target;
  }
  return "";
}

function resolveSourceEditorTargetPath(fromPath = "", target = "") {
  const fromRelativePath = normalizeSourceEditorRelativePath(fromPath);
  const normalizedTarget = normalizeSourceEditorImportTarget(target);
  if (!fromRelativePath || !normalizedTarget) {
    return "";
  }
  const baseDirectory = path.posix.dirname(fromRelativePath);
  const joined = normalizedTarget.startsWith("/")
    ? normalizedTarget.slice(1)
    : path.posix.join(baseDirectory === "." ? "" : baseDirectory, normalizedTarget);
  return normalizeSourceEditorRelativePath(joined);
}

function sourceEditorResolveCandidates(relativePath = "") {
  const normalizedPath = normalizeSourceEditorRelativePath(relativePath);
  if (!normalizedPath) {
    return [];
  }
  const extension = path.posix.extname(normalizedPath);
  const candidates = [normalizedPath];
  if (!extension) {
    candidates.push(...SOURCE_EDITOR_RESOLVE_EXTENSIONS.map((suffix) => `${normalizedPath}${suffix}`));
  }
  const directoryPath = normalizedPath.replace(/\/+$/u, "");
  candidates.push(...SOURCE_EDITOR_RESOLVE_EXTENSIONS.map((suffix) => `${directoryPath}/index${suffix}`));
  return [...new Set(candidates)];
}

async function sourceEditorResolvableFile(context = {}, relativePath = "") {
  if (sourceEditorPathExcluded(context.policy, relativePath)) {
    return null;
  }
  const absolutePath = absoluteSourceEditorPath(context.sourceRoot, relativePath);
  let stats = null;
  try {
    stats = await lstat(absolutePath);
  } catch (error) {
    if (isMissingPathError(error)) {
      return null;
    }
    throw error;
  }
  if (stats.isSymbolicLink()) {
    return null;
  }
  if (stats.isFile()) {
    return {
      language: sourceEditorLanguageForPath(relativePath),
      path: relativePath
    };
  }
  return null;
}

async function resolveSourceEditorPath(context = {}, input = {}) {
  let basePath = "";
  try {
    basePath = resolveSourceEditorTargetPath(input.fromPath, input.target);
  } catch {
    return {
      resolved: false,
      target: normalizeText(input.target)
    };
  }
  if (!basePath) {
    return {
      resolved: false,
      target: normalizeText(input.target)
    };
  }
  for (const candidatePath of sourceEditorResolveCandidates(basePath)) {
    const file = await sourceEditorResolvableFile(context, candidatePath);
    if (file) {
      return {
        file,
        path: file.path,
        resolved: true,
        target: normalizeText(input.target)
      };
    }
  }
  return {
    resolved: false,
    target: normalizeText(input.target)
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
  const relativePath = normalizeSourceEditorRelativePath(input.path);
  const offset = sourceEditorResultOffset(input.offset);
  const tree = await sourceEditorDirectoryPage(context, {
    limit: input.limit,
    offset,
    path: relativePath
  });
  if (relativePath || offset > 0) {
    return tree;
  }
  return sourceEditorTreeWithPolicyDirectories(context, tree);
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

async function sourceEditorTreeWithPolicyDirectories(context = {}, root = null) {
  const policy = context.policy || {};
  const preloadDirectories = sourceEditorPolicyDirectoryList(policy.preloadDirectories);
  const preexpandedDirectories = sourceEditorPolicyDirectoryList(policy.preexpandedDirectories);
  const preexpandedSet = new Set(preexpandedDirectories);
  let tree = root;

  for (const directoryPath of preloadDirectories) {
    if (preexpandedSet.has(directoryPath)) {
      continue;
    }
    tree = mergeSourceEditorDirectoryNode(
      tree,
      await sourceEditorPolicyDirectoryNode(context, directoryPath)
    );
  }

  const visited = new Set();
  for (const directoryPath of preexpandedDirectories) {
    tree = mergeSourceEditorDirectoryNode(
      tree,
      await sourceEditorPolicyDirectoryNode(context, directoryPath, {
        complete: true,
        recursive: true,
        visited
      })
    );
  }

  return tree;
}

function sourceEditorPolicyDirectoryList(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => normalizeSourceEditorPolicyPath(value))
    .filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

async function sourceEditorPolicyDirectoryNode(context = {}, directoryPath = "", {
  complete = false,
  recursive = false,
  visited = new Set()
} = {}) {
  const relativePath = normalizeSourceEditorPolicyPath(directoryPath);
  if (!relativePath || visited.has(relativePath)) {
    return null;
  }
  visited.add(relativePath);

  let node = null;
  try {
    node = await sourceEditorDirectoryPage(context, {
      path: relativePath
    });
    while (complete && node?.hasMore) {
      const page = await sourceEditorDirectoryPage(context, {
        offset: node.nextOffset,
        path: relativePath
      });
      node = {
        ...page,
        children: mergeSourceEditorChildren(node.children, page.children)
      };
    }
  } catch (error) {
    if (isMissingPathError(error) || error?.code === "vibe64_invalid_source_editor_path") {
      return null;
    }
    throw error;
  }

  if (!recursive || !node) {
    return node;
  }

  for (const child of Array.isArray(node.children) ? node.children : []) {
    if (child?.type !== "directory") {
      continue;
    }
    node = mergeSourceEditorDirectoryNode(
      node,
      await sourceEditorPolicyDirectoryNode(context, child.path, {
        complete: true,
        recursive: true,
        visited
      })
    );
  }
  return node;
}

function mergeSourceEditorDirectoryNode(root = null, directory = null) {
  if (!root || !directory || directory.type !== "directory") {
    return root;
  }
  const directoryPath = normalizeSourceEditorPolicyPath(directory.path);
  if (!directoryPath) {
    return {
      ...root,
      ...directory,
      children: mergeSourceEditorChildren(root.children, directory.children)
    };
  }
  const parts = directoryPath.split("/").filter(Boolean);
  const rootPath = normalizeSourceEditorPolicyPath(root.path);
  const rootPartCount = rootPath && (directoryPath === rootPath || directoryPath.startsWith(`${rootPath}/`))
    ? rootPath.split("/").filter(Boolean).length
    : 0;

  function mergeAt(node = null, depth = 0) {
    if (!node || node.type !== "directory") {
      return node;
    }
    if (depth === parts.length) {
      return {
        ...node,
        ...directory,
        children: mergeSourceEditorChildren(node.children, directory.children)
      };
    }

    const childPath = parts.slice(0, depth + 1).join("/");
    const children = Array.isArray(node.children) ? node.children : [];
    let matched = false;
    const nextChildren = children.map((child) => {
      if (child?.type === "directory" && normalizeSourceEditorPolicyPath(child.path) === childPath) {
        matched = true;
        return mergeAt(child, depth + 1);
      }
      return child;
    });
    if (!matched) {
      nextChildren.push(mergeAt(directoryNode(childPath, [], {
        loaded: false
      }), depth + 1));
    }
    return {
      ...node,
      children: sortSourceEditorChildren(nextChildren)
    };
  }

  return mergeAt(root, rootPartCount);
}

function mergeSourceEditorChildren(existingChildren = [], incomingChildren = []) {
  const byPath = new Map();
  for (const child of Array.isArray(existingChildren) ? existingChildren : []) {
    byPath.set(`${child?.type || ""}:${normalizeSourceEditorPolicyPath(child?.path || child?.name || "")}`, child);
  }
  for (const child of Array.isArray(incomingChildren) ? incomingChildren : []) {
    byPath.set(`${child?.type || ""}:${normalizeSourceEditorPolicyPath(child?.path || child?.name || "")}`, child);
  }
  return sortSourceEditorChildren([...byPath.values()]);
}

function sortSourceEditorChildren(children = []) {
  return [...children].sort((left, right) => {
    if (left?.type !== right?.type) {
      return left?.type === "directory" ? -1 : 1;
    }
    return String(left?.name || "").localeCompare(String(right?.name || ""));
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

async function readStoppedSourceEditorExplanation(context = {}, explanationId = "", {
  explanationChats = null
} = {}) {
  try {
    const record = await readSourceEditorExplanationRecord(context, explanationId, {
      explanationChats
    });
    return record.status === "stopped" ? record : null;
  } catch {
    return null;
  }
}

function normalizeSourceEditorExplanation(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const sourceRange = source.sourceRange && typeof source.sourceRange === "object" && !Array.isArray(source.sourceRange)
    ? source.sourceRange
    : {};
  return {
    agentThreadId: normalizeText(source.agentThreadId),
    agentSettings: sourceEditorExplanationAgentSettings({
      agentSettings: source.agentSettings
    }),
    agentTurnId: normalizeText(source.agentTurnId),
    body: String(source.body || ""),
    createdAt: normalizeText(source.createdAt),
    engine: normalizeText(source.engine || (source.agentThreadId ? "agent-chat" : "")),
    followups: normalizeSourceEditorFollowups(source.followups),
    id: normalizeSourceEditorExplanationId(source.id),
    messages: normalizeSourceEditorMessages(source.messages),
    model: normalizeText(source.model || "agent-chat"),
    promptVersion: normalizeText(source.promptVersion || SOURCE_EDITOR_EXPLANATION_PROMPT_VERSION),
    sourceRange: {
      endColumn: positiveInteger(sourceRange.endColumn, 1),
      endLine: positiveInteger(sourceRange.endLine, 1),
      fileHash: normalizeText(sourceRange.fileHash),
      language: normalizeText(sourceRange.language || sourceEditorLanguageForPath(sourceRange.path)),
      path: normalizeSourceEditorRelativePath(sourceRange.path),
      scope: normalizeText(sourceRange.scope || "selection"),
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
      const status = normalizeText(entry.status || "complete");
      if (!["assistant", "user"].includes(role) || (!text.trim() && status === "complete")) {
        return null;
      }
      return {
        createdAt: normalizeText(entry.createdAt),
        id: normalizeText(entry.id) || sourceEditorExplanationMessageId(),
        role,
        status,
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

function sourceEditorExplanationPromptCode({
  range = {},
  selectedText = ""
} = {}) {
  const text = String(selectedText || "");
  const lines = sourceEditorLines(text);
  if (range.scope !== "file" || lines.length <= SOURCE_EDITOR_EXPLANATION_MAX_LINES) {
    return {
      label: range.scope === "file" ? "File contents" : "Selected code",
      note: "",
      text
    };
  }

  const headLineCount = Math.ceil(SOURCE_EDITOR_EXPLANATION_MAX_LINES * 0.6);
  const tailLineCount = SOURCE_EDITOR_EXPLANATION_MAX_LINES - headLineCount;
  const omittedLineCount = Math.max(0, lines.length - headLineCount - tailLineCount);
  return {
    label: "File excerpt",
    note: `The whole file has ${lines.length} lines, so only an excerpt is inlined here. Inspect the repository file path above for the complete file before explaining its system role.`,
    text: [
      ...lines.slice(0, headLineCount),
      "",
      `... ${omittedLineCount} lines omitted from the middle ...`,
      "",
      ...lines.slice(-tailLineCount)
    ].join("\n")
  };
}

async function sourceEditorExplanationInput(context = {}, input = {}) {
  const file = await readSourceEditorFile(context, input.path);
  const lines = sourceEditorLines(file.text);
  const scope = normalizeText(input.scope) === "file" ? "file" : "selection";
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
  if (scope !== "file" && selectedLineCount > SOURCE_EDITOR_EXPLANATION_MAX_LINES) {
    throw sourceEditorError("Select a smaller code range before asking for an explanation.", "vibe64_source_explanation_selection_too_large", {
      maxLines: SOURCE_EDITOR_EXPLANATION_MAX_LINES,
      selectedLineCount
    }, 413);
  }
  const selectedTextHash = sourceEditorTextHash(selectedText);
  const promptVersion = SOURCE_EDITOR_EXPLANATION_PROMPT_VERSION;
  const promptCode = sourceEditorExplanationPromptCode({
    range: {
      ...range,
      scope
    },
    selectedText
  });
  return {
    contextWindow: scope === "file" ? "" : sourceEditorContextWindow(file.text, range),
    file,
    promptCode,
    promptVersion,
    range: {
      ...range,
      fileHash: file.hash,
      language: file.language,
      path: file.path,
      scope,
      selectedTextHash
    },
    selectedText
  };
}

async function createSourceEditorExplanation(context = {}, input = {}, {
  explanationChats = null,
  explanationGenerator = generateSourceEditorExplanationWithAgentService
} = {}) {
  const explanationInput = await sourceEditorExplanationInput(context, input);
  const agentSettings = sourceEditorExplanationAgentSettings(input);
  const effectiveAgentSettings = sourceEditorExplanationEffectiveAgentSettings(agentSettings);
  const generated = normalizeGeneratedSourceEditorExplanation(
    await explanationGenerator(explanationInput, {
      agentSettings,
      context
    })
  );
  return withSourceEditorExplanationFreshness(context, await writeSourceEditorExplanation(context, {
    ...generated,
    agentSettings,
    agentThreadId: generated.agentThreadId,
    agentTurnId: generated.agentTurnId,
    createdAt: new Date().toISOString(),
    engine: generated.engine,
    followups: [],
    id: sourceEditorExplanationId(),
    messages: generated.messages,
    model: generated.model || effectiveAgentSettings.model,
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
    agentThreadId: normalizeText(source.agentThreadId),
    agentTurnId: normalizeText(source.agentTurnId),
    body: String(source.body || ""),
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

async function generateSourceEditorExplanationWithAgentService(explanationInput = {}, {
  agentSettings = defaultVibe64SourceExplanationAgentSettings(),
  context = {},
  terminalService = null
} = {}) {
  if (!terminalService || typeof terminalService.runDetachedAgentChatTurn !== "function") {
    throw sourceEditorError("Agent chat is not available for source explanations.", "vibe64_source_explanation_agent_unavailable", {}, 409);
  }
  const displayPrompt = sourceEditorExplanationDisplayPrompt(explanationInput);
  const effectiveAgentSettings = sourceEditorExplanationEffectiveAgentSettings(agentSettings);
  const result = await terminalService.runDetachedAgentChatTurn(context.sessionId || context.session?.sessionId || context.session?.id, {
    agentSettings,
    prompt: sourceEditorExplanationPrompt(explanationInput),
    promptLabel: "Source code explanation",
    timeoutMs: SOURCE_EDITOR_EXPLANATION_CHAT_TIMEOUT_MS
  });
  if (result?.ok === false) {
    throw sourceEditorError(
      result.error || "The agent could not explain this code.",
      result.code || "vibe64_source_explanation_agent_failed",
      result,
      result.statusCode || 502
    );
  }
  const body = String(result?.text || "").trim();
  if (!body) {
    throw sourceEditorError("The agent returned an empty source explanation.", "vibe64_source_explanation_agent_empty", {}, 502);
  }
  const createdAt = new Date().toISOString();
  return {
    agentThreadId: normalizeText(result.threadId),
    agentTurnId: normalizeText(result.turnId),
    body,
    engine: "agent-chat",
    messages: [
      sourceEditorExplanationMessage("user", displayPrompt, createdAt),
      sourceEditorExplanationMessage("assistant", body)
    ],
    model: effectiveAgentSettings.model,
    summary: sourceEditorExplanationSummary(body),
    title: sourceEditorExplanationTitle(explanationInput)
  };
}

function sourceEditorExplanationTitle({
  file = {},
  range = {}
} = {}) {
  if (range.scope === "file") {
    return `${path.posix.basename(file.path || "Source")} full file`;
  }
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
  if (range.scope === "file") {
    return `Explain the whole file ${file.path}.`;
  }
  return `Explain ${file.path}:${range.startLine}-${range.endLine}.`;
}

function sourceEditorExplanationMessage(role = "", text = "", createdAt = new Date().toISOString(), options = {}) {
  const source = isPlainObject(options) ? options : {};
  return {
    createdAt,
    id: normalizeText(source.id) || sourceEditorExplanationMessageId(),
    role,
    status: normalizeText(source.status || "complete"),
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

function sourceEditorClientExplanationId(value = "") {
  if (!normalizeText(value)) {
    return "";
  }
  try {
    return normalizeSourceEditorExplanationId(value);
  } catch {
    return "";
  }
}

function sourceEditorClientMessageId(value = "") {
  const id = normalizeText(value);
  return /^[a-z0-9_-]{1,100}$/u.test(id) ? id : "";
}

function sourceEditorExplanationWithMessage(explanation = {}, messageId = "", patch = {}) {
  const normalizedMessageId = normalizeText(messageId);
  const messages = normalizeSourceEditorMessages(explanation.messages);
  const index = messages.findIndex((message) => message.id === normalizedMessageId);
  if (index === -1) {
    return {
      ...explanation,
      messages
    };
  }
  const nextMessages = [...messages];
  nextMessages[index] = normalizeSourceEditorMessages([{
    ...nextMessages[index],
    ...patch
  }])[0] || nextMessages[index];
  return {
    ...explanation,
    messages: nextMessages
  };
}

function emitSourceEditorExplanationEvent(emit = null, isClosed = null, type = "", payload = {}) {
  if (typeof emit !== "function" || (typeof isClosed === "function" && isClosed())) {
    return;
  }
  emit({
    ...payload,
    type
  });
}

async function streamSourceEditorAgentTurn(context = {}, {
  agentSettings = defaultVibe64SourceExplanationAgentSettings(),
  onText = null,
  onThread = null,
  onTurn = null,
  prompt = "",
  promptLabel = "",
  terminalService = null,
  threadId = ""
} = {}) {
  if (!terminalService || typeof terminalService.streamDetachedAgentChatTurn !== "function") {
    throw sourceEditorError("Agent chat streaming is not available for source explanations.", "vibe64_source_explanation_agent_stream_unavailable", {}, 409);
  }
  let latestText = "";
  let latestThreadId = normalizeText(threadId);
  let latestTurnId = "";
  const result = await terminalService.streamDetachedAgentChatTurn(context.sessionId || context.session?.sessionId || context.session?.id, {
    agentSettings,
    prompt,
    promptLabel,
    threadId,
    timeoutMs: SOURCE_EDITOR_EXPLANATION_CHAT_TIMEOUT_MS
  }, {
    onEvent(event = {}) {
      if (event.type === "thread") {
        latestThreadId = normalizeText(event.threadId) || latestThreadId;
        onThread?.({
          replacedThreadId: normalizeText(event.replacedThreadId),
          threadId: latestThreadId
        });
        return;
      }
      if (event.type === "turn") {
        latestThreadId = normalizeText(event.threadId) || latestThreadId;
        latestTurnId = normalizeText(event.turnId) || latestTurnId;
        onTurn?.({
          status: normalizeText(event.status),
          threadId: latestThreadId,
          turnId: latestTurnId
        });
        return;
      }
      const classification = isPlainObject(event.classification) ? event.classification : {};
      if (!["final_assistant_result", "live_progress"].includes(classification.kind) || !classification.text) {
        return;
      }
      latestText = String(classification.text || "");
      onText?.({
        kind: classification.kind,
        text: latestText,
        threadId: normalizeText(event.threadId) || latestThreadId,
        turnId: normalizeText(event.turnId) || latestTurnId
      });
    }
  });
  if (result?.ok === false) {
    throw sourceEditorError(
      result.error || "The agent could not answer this source explanation chat.",
      result.code || "vibe64_source_explanation_agent_failed",
      result,
      result.statusCode || 502
    );
  }
  const text = String(result?.text || latestText || "").trim();
  if (!text) {
    throw sourceEditorError("The agent returned an empty source explanation answer.", "vibe64_source_explanation_agent_empty", {}, 502);
  }
  return {
    replacedThreadId: normalizeText(result.replacedThreadId),
    text,
    threadId: normalizeText(result.threadId) || latestThreadId,
    turnId: normalizeText(result.turnId) || latestTurnId
  };
}

function sourceEditorAgentStreamHandlers({
  assistantMessageId = "",
  currentExplanation = () => ({}),
  emitEvent = () => {},
  remember = async () => {},
  setExplanation = () => {}
} = {}) {
  const updateExplanation = (patch = {}) => {
    const next = {
      ...currentExplanation(),
      ...patch
    };
    setExplanation(next);
    void remember(patch);
    return next;
  };

  return {
    onThread({ threadId }) {
      updateExplanation({
        agentThreadId: threadId
      });
      emitEvent("source-explanation.thread", {
        threadId
      });
    },
    onTurn({ threadId, turnId }) {
      updateExplanation({
        agentThreadId: threadId,
        agentTurnId: turnId
      });
      emitEvent("source-explanation.turn", {
        threadId,
        turnId
      });
    },
    onText({ text }) {
      const next = sourceEditorExplanationWithMessage(currentExplanation(), assistantMessageId, {
        status: "thinking",
        text
      });
      setExplanation(next);
      void remember({
        messages: next.messages
      });
      emitEvent("source-explanation.message", {
        messageId: assistantMessageId,
        role: "assistant",
        status: "thinking",
        text
      });
    }
  };
}

async function streamSourceEditorExplanation(context = {}, input = {}, {
  emit = null,
  explanationChats = null,
  isClosed = null,
  terminalService = null
} = {}) {
  const explanationInput = await sourceEditorExplanationInput(context, input);
  const agentSettings = sourceEditorExplanationAgentSettings(input);
  const effectiveAgentSettings = sourceEditorExplanationEffectiveAgentSettings(agentSettings);
  const createdAt = new Date().toISOString();
  const explanationId = sourceEditorClientExplanationId(input.explanationId) || sourceEditorExplanationId();
  const userMessageId = sourceEditorClientMessageId(input.userMessageId) || sourceEditorExplanationMessageId();
  const assistantMessageId = sourceEditorClientMessageId(input.assistantMessageId) || sourceEditorExplanationMessageId();
  const displayPrompt = sourceEditorExplanationDisplayPrompt(explanationInput);
  let explanation = await writeSourceEditorExplanation(context, {
    agentThreadId: "",
    agentSettings,
    agentTurnId: "",
    body: "",
    createdAt,
    engine: "agent-chat",
    followups: [],
    id: explanationId,
    messages: [
      sourceEditorExplanationMessage("user", displayPrompt, createdAt, {
        id: userMessageId
      }),
      sourceEditorExplanationMessage("assistant", "", createdAt, {
        id: assistantMessageId,
        status: "thinking"
      })
    ],
    model: effectiveAgentSettings.model,
    promptVersion: explanationInput.promptVersion,
    sourceRange: explanationInput.range,
    status: "running",
    title: sourceEditorExplanationTitle(explanationInput)
  }, {
    explanationChats
  });

  const remember = async (patch = {}) => {
    const stopped = await readStoppedSourceEditorExplanation(context, explanation.id, {
      explanationChats
    });
    if (stopped) {
      explanation = stopped;
      return explanation;
    }
    explanation = await writeSourceEditorExplanation(context, {
      ...explanation,
      ...patch
    }, {
      explanationChats
    });
    return explanation;
  };
  const emitEvent = (type, payload = {}) => {
    emitSourceEditorExplanationEvent(emit, isClosed, type, {
      explanation,
      ...payload
    });
  };
  const streamHandlers = sourceEditorAgentStreamHandlers({
    assistantMessageId,
    currentExplanation: () => explanation,
    emitEvent,
    remember,
    setExplanation(value) {
      explanation = value;
    }
  });

  emitEvent("source-explanation.started", {
    assistantMessageId,
    userMessageId
  });

  const result = await streamSourceEditorAgentTurn(context, {
    agentSettings,
    prompt: sourceEditorExplanationPrompt(explanationInput),
    promptLabel: "Source code explanation",
    terminalService,
    ...streamHandlers
  });

  const stopped = await readStoppedSourceEditorExplanation(context, explanation.id, {
    explanationChats
  });
  if (stopped) {
    explanation = await withSourceEditorExplanationFreshness(context, stopped);
    emitEvent("source-explanation.finished", {
      explanation
    });
    return explanation;
  }

  explanation = sourceEditorExplanationWithMessage(explanation, assistantMessageId, {
    status: "complete",
    text: result.text
  });
  explanation = await remember({
    agentThreadId: result.threadId || explanation.agentThreadId,
    agentTurnId: result.turnId || explanation.agentTurnId,
    body: result.text,
    messages: explanation.messages,
    summary: sourceEditorExplanationSummary(result.text),
    status: "ready"
  });
  explanation = await withSourceEditorExplanationFreshness(context, explanation);
  emitEvent("source-explanation.finished", {
    explanation
  });
  return explanation;
}

function sourceEditorExplanationPrompt({
  contextWindow = "",
  file = {},
  promptCode = {},
  range = {},
  selectedText = ""
} = {}) {
  const wholeFile = range.scope === "file";
  const inlineCode = isPlainObject(promptCode) ? promptCode : {};
  const codeLabel = normalizeText(inlineCode.label) || (wholeFile ? "File contents" : "Selected code");
  const codeNote = normalizeText(inlineCode.note);
  const codeText = String(inlineCode.text ?? selectedText ?? "");
  return [
    "You are Vibe64's senior source-code explainer for this exact repository.",
    "Explain what this code is responsible for in the system. Do not teach language basics and do not explain obvious syntax such as `const`, imports, braces, or function declarations unless they are architecturally relevant.",
    wholeFile
      ? "The user asked about the whole file. Explain the file's role, its major sections, and how other parts of the project are likely to interact with it."
      : "The user selected a specific range. Explain that range first, then explain how it fits into the surrounding file and wider project.",
    "Use the selected code, nearby context, file path, naming, imports, exports, and repository inspection when useful. Be explicit when you infer something from context.",
    "Prefer this shape: brief summary; role in the system; how it works; important data/control flow; key dependencies or callers/callees; risks, edge cases, or things to know.",
    "Be concrete and project-aware. Avoid generic rewrite advice unless there is a direct behavioral risk. Do not edit files.",
    "Return user-facing Markdown. No JSON. No Vibe64 result envelope.",
    "",
    `File: ${file.path}`,
    `Target: ${wholeFile ? "whole file" : `lines ${range.startLine}-${range.endLine}, columns ${range.startColumn}-${range.endColumn}`}`,
    `Language: ${range.language || file.language || sourceEditorLanguageForPath(file.path)}`,
    "",
    ...(codeNote
      ? [
          "Important context:",
          codeNote,
          ""
        ]
      : []),
    `${codeLabel}:`,
    "```",
    codeText,
    "```",
    "",
    ...(contextWindow
      ? [
          "Nearby context:",
          "```",
          contextWindow,
          "```"
        ]
      : [])
  ].join("\n");
}

async function addSourceEditorExplanationFollowup(context = {}, input = {}, {
  explanationChats = null,
  explanationFollowupGenerator = generateSourceEditorExplanationFollowupWithAgentService
} = {}) {
  const message = sourceEditorExplanationFollowupMessage(input.message);
  const explanation = await readSourceEditorExplanation(context, input.explanationId, {
    explanationChats
  });
  const agentSettings = sourceEditorExplanationAgentSettings(input, explanation.agentSettings);
  const effectiveAgentSettings = sourceEditorExplanationEffectiveAgentSettings(agentSettings);
  const createdAt = new Date().toISOString();
  const generated = await explanationFollowupGenerator(explanation, message, {
    agentSettings,
    context
  });
  const followupAnswer = normalizeGeneratedSourceEditorFollowup(generated);
  const answer = followupAnswer.answer;
  if (!answer) {
    throw sourceEditorError("The agent returned an empty source explanation answer.", "vibe64_source_explanation_agent_invalid", {}, 502);
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
    agentSettings,
    agentThreadId: followupAnswer.agentThreadId || explanation.agentThreadId,
    agentTurnId: followupAnswer.agentTurnId || explanation.agentTurnId,
    body: answer,
    engine: followupAnswer.engine || explanation.engine,
    model: followupAnswer.model || effectiveAgentSettings.model || explanation.model,
    followups: nextFollowups,
    messages: nextMessages,
    summary: sourceEditorExplanationSummary(answer)
  }, {
    explanationChats
  }));
}

function sourceEditorExplanationFollowupMessage(value = "") {
  const message = String(value || "").trim();
  if (!message) {
    throw sourceEditorError("Enter a question before sending a follow-up.", "vibe64_source_explanation_followup_empty");
  }
  if (message.length > SOURCE_EDITOR_FOLLOWUP_MAX_LENGTH) {
    throw sourceEditorError("Follow-up question is too long.", "vibe64_source_explanation_followup_too_large", {
      maxLength: SOURCE_EDITOR_FOLLOWUP_MAX_LENGTH
    }, 413);
  }
  return message;
}

async function streamSourceEditorExplanationFollowup(context = {}, input = {}, {
  emit = null,
  explanationChats = null,
  isClosed = null,
  terminalService = null
} = {}) {
  const message = sourceEditorExplanationFollowupMessage(input.message);
  const baseExplanation = await readSourceEditorExplanation(context, input.explanationId, {
    explanationChats
  });
  const agentSettings = sourceEditorExplanationAgentSettings(input, baseExplanation.agentSettings);
  const effectiveAgentSettings = sourceEditorExplanationEffectiveAgentSettings(agentSettings);
  const agentThreadId = normalizeText(baseExplanation.agentThreadId);
  if (!agentThreadId) {
    throw sourceEditorError(
      "Regenerate this explanation before asking follow-up questions. It was created before source explanation chat was available.",
      "vibe64_source_explanation_agent_thread_missing",
      {},
      409
    );
  }
  const createdAt = new Date().toISOString();
  const userMessageId = sourceEditorClientMessageId(input.userMessageId) || sourceEditorExplanationMessageId();
  const assistantMessageId = sourceEditorClientMessageId(input.assistantMessageId) || sourceEditorExplanationMessageId();
  let explanation = await writeSourceEditorExplanation(context, {
    ...baseExplanation,
    agentSettings,
    messages: [
      ...sourceEditorExplanationMessagesForAppend(baseExplanation),
      sourceEditorExplanationMessage("user", message, createdAt, {
        id: userMessageId
      }),
      sourceEditorExplanationMessage("assistant", "", createdAt, {
        id: assistantMessageId,
        status: "thinking"
      })
    ],
    status: "running"
  }, {
    explanationChats
  });

  const remember = async (patch = {}) => {
    const stopped = await readStoppedSourceEditorExplanation(context, explanation.id, {
      explanationChats
    });
    if (stopped) {
      explanation = stopped;
      return explanation;
    }
    explanation = await writeSourceEditorExplanation(context, {
      ...explanation,
      ...patch
    }, {
      explanationChats
    });
    return explanation;
  };
  const emitEvent = (type, payload = {}) => {
    emitSourceEditorExplanationEvent(emit, isClosed, type, {
      explanation,
      ...payload
    });
  };
  const streamHandlers = sourceEditorAgentStreamHandlers({
    assistantMessageId,
    currentExplanation: () => explanation,
    emitEvent,
    remember,
    setExplanation(value) {
      explanation = value;
    }
  });

  emitEvent("source-explanation.followup.started", {
    assistantMessageId,
    userMessageId
  });

  const result = await streamSourceEditorAgentTurn(context, {
    agentSettings,
    prompt: sourceEditorExplanationFollowupPrompt(baseExplanation, message),
    promptLabel: "Source code explanation follow-up",
    terminalService,
    threadId: agentThreadId,
    ...streamHandlers
  });

  const stopped = await readStoppedSourceEditorExplanation(context, explanation.id, {
    explanationChats
  });
  if (stopped) {
    explanation = await withSourceEditorExplanationFreshness(context, stopped);
    emitEvent("source-explanation.finished", {
      explanation
    });
    return explanation;
  }

  explanation = sourceEditorExplanationWithMessage(explanation, assistantMessageId, {
    status: "complete",
    text: result.text
  });
  const nextFollowups = [
    ...baseExplanation.followups,
    {
      createdAt,
      id: userMessageId,
      role: "user",
      text: message
    },
    {
      createdAt: new Date().toISOString(),
      id: assistantMessageId,
      role: "assistant",
      text: result.text
    }
  ];
  explanation = await remember({
    agentThreadId: result.threadId || explanation.agentThreadId,
    agentTurnId: result.turnId || explanation.agentTurnId,
    body: result.text,
    followups: nextFollowups,
    messages: explanation.messages,
    model: effectiveAgentSettings.model || explanation.model,
    summary: sourceEditorExplanationSummary(result.text),
    status: "ready"
  });
  explanation = await withSourceEditorExplanationFreshness(context, explanation);
  emitEvent("source-explanation.finished", {
    explanation
  });
  return explanation;
}

async function stopSourceEditorExplanation(context = {}, explanationId = "", {
  explanationChats = null,
  terminalService = null
} = {}) {
  let explanation = await readSourceEditorExplanationRecord(context, explanationId, {
    explanationChats
  });
  const threadId = normalizeText(explanation.agentThreadId);
  const turnId = normalizeText(explanation.agentTurnId);
  if (threadId && turnId) {
    if (!terminalService || typeof terminalService.interruptDetachedAgentChatTurn !== "function") {
      throw sourceEditorError("Agent chat interrupt is not available for source explanations.", "vibe64_source_explanation_agent_interrupt_unavailable", {}, 409);
    }
    const result = await terminalService.interruptDetachedAgentChatTurn(context.sessionId, {
      threadId,
      turnId
    });
    if (result?.ok === false) {
      throw sourceEditorError(
        result.error || "The agent could not stop this source explanation.",
        result.code || "vibe64_source_explanation_agent_interrupt_failed",
        result,
        result.statusCode || 502
      );
    }
  }
  const messages = normalizeSourceEditorMessages(explanation.messages);
  const lastAssistant = [...messages].reverse().find((entry) => entry.role === "assistant");
  if (lastAssistant?.id) {
    explanation = sourceEditorExplanationWithMessage(explanation, lastAssistant.id, {
      status: "stopped",
      text: lastAssistant.text || "Stopped."
    });
  }
  return withSourceEditorExplanationFreshness(context, await writeSourceEditorExplanation(context, {
    ...explanation,
    messages: explanation.messages,
    status: "stopped"
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
      agentCleanup: {
        ok: true,
        status: "notFound"
      },
      deleted: false
    };
  }
  const threadId = normalizeText(explanation.agentThreadId);
  if (!threadId) {
    store.delete(key);
    return {
      agentCleanup: {
        ok: true,
        status: "notFound",
        threadId
      },
      deleted: true
    };
  }
  if (typeof terminalService?.deleteDetachedAgentChatThread !== "function") {
    throw sourceEditorError(
      "Agent chat cleanup is not available.",
      "vibe64_source_explanation_agent_cleanup_unavailable",
      { threadId },
      409
    );
  }
  const agentCleanup = await terminalService.deleteDetachedAgentChatThread(context.sessionId, {
    threadId
  });
  if (agentCleanup?.ok === false) {
    throw sourceEditorError(
      agentCleanup.error || "The agent service could not delete the temporary source explanation chat.",
      agentCleanup.code || "vibe64_source_explanation_agent_cleanup_failed",
      agentCleanup,
      agentCleanup.statusCode || 502
    );
  }
  store.delete(key);
  return {
    agentCleanup,
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
    agentThreadId: normalizeText(source.agentThreadId),
    agentTurnId: normalizeText(source.agentTurnId),
    engine: normalizeText(source.engine),
    model: normalizeText(source.model)
  };
}

async function generateSourceEditorExplanationFollowupWithAgentService(explanation = {}, message = "", {
  agentSettings = defaultVibe64SourceExplanationAgentSettings(),
  context = {},
  terminalService = null
} = {}) {
  if (!terminalService || typeof terminalService.runDetachedAgentChatTurn !== "function") {
    throw sourceEditorError("Agent chat is not available for source explanations.", "vibe64_source_explanation_agent_unavailable", {}, 409);
  }
  const agentThreadId = normalizeText(explanation.agentThreadId);
  if (!agentThreadId) {
    throw sourceEditorError(
      "Regenerate this explanation before asking follow-up questions. It was created before source explanation chat was available.",
      "vibe64_source_explanation_agent_thread_missing",
      {},
      409
    );
  }
  const effectiveAgentSettings = sourceEditorExplanationEffectiveAgentSettings(agentSettings);
  const result = await terminalService.runDetachedAgentChatTurn(context.sessionId || context.session?.sessionId || context.session?.id, {
    agentSettings,
    prompt: sourceEditorExplanationFollowupPrompt(explanation, message),
    promptLabel: "Source code explanation follow-up",
    threadId: agentThreadId,
    timeoutMs: SOURCE_EDITOR_EXPLANATION_CHAT_TIMEOUT_MS
  });
  if (result?.ok === false) {
    throw sourceEditorError(
      result.error || "The agent could not answer this source explanation follow-up.",
      result.code || "vibe64_source_explanation_agent_failed",
      result,
      result.statusCode || 502
    );
  }
  const answer = String(result?.text || "").trim();
  if (!answer) {
    throw sourceEditorError("The agent returned an empty source explanation answer.", "vibe64_source_explanation_agent_empty", {}, 502);
  }
  return {
    agentThreadId: normalizeText(result.threadId) || agentThreadId,
    agentTurnId: normalizeText(result.turnId),
    answer,
    engine: "agent-chat",
    model: effectiveAgentSettings.model
  };
}

function sourceEditorExplanationFollowupPrompt(explanation = {}, message = "") {
  const range = explanation.sourceRange || {};
  const wholeFile = range.scope === "file";
  return [
    "Continue the Vibe64 source-code explanation thread.",
    wholeFile
      ? "Answer the user's follow-up about the same whole-file explanation and its role in the project."
      : "Answer the user's follow-up about the same selected source range and its role in the project.",
    "Assume the user knows the programming language; focus on project behavior, relationships, data/control flow, risks, and intent. You may inspect the repository read-only if needed.",
    "Do not edit files. If the current explanation is stale, say so plainly before answering.",
    "Return user-facing Markdown. No JSON. No Vibe64 result envelope.",
    "",
    `File: ${range.path}`,
    `Target: ${wholeFile ? "whole file" : `lines ${range.startLine}-${range.endLine}, columns ${range.startColumn}-${range.endColumn}`}`,
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

function sourceEditorFileChange(context = {}, input = {}, file = {}) {
  return {
    hash: normalizeText(file.hash),
    mtimeMs: file.mtimeMs,
    originId: normalizeText(input.originId),
    path: normalizeSourceEditorRelativePath(file.path || input.path),
    projectSlug: normalizeText(input.projectSlug),
    sessionId: normalizeText(context.sessionId || input.sessionId),
    size: file.size,
    updatedAt: new Date().toISOString()
  };
}

function sourceEditorFileOpen(context = {}, input = {}, file = {}) {
  return {
    originId: normalizeText(input.originId),
    path: normalizeSourceEditorRelativePath(file.relativePath || input.path),
    projectSlug: normalizeText(input.projectSlug),
    sessionId: normalizeText(context.sessionId || input.sessionId),
    updatedAt: new Date().toISOString()
  };
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
