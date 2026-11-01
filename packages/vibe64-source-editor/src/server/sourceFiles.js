import crypto from "node:crypto";
import { constants } from "node:fs";
import { copyFile, lstat, mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { isMissingPathError, normalizeText } from "@local/vibe64-core/server/core";
import { vibe64ErrorResponse } from "@local/vibe64-core/server/serverResponses";
import { runVibe64Command } from "@local/vibe64-execution/server";
import { normalizePolicyPath, sourceEditorPathExcluded } from "./filePolicy.js";
import {
  VIBE64_SOURCE_EDITOR_FILE_CHANGED_EVENT,
  VIBE64_SOURCE_EDITOR_SYNC_ERROR_EVENT,
  VIBE64_SOURCE_EDITOR_SYNC_READY_EVENT
} from "@local/vibe64-core/server/sourceEditorRealtimeEvents";
import { sourceEditorLanguageForPath } from "./sourceEditorLanguage.js";
import {
  normalizeSourceEditorQuery,
  sourceEditorFileMatches,
  sourceEditorResultLimit,
  sourceEditorResultOffset
} from "./sourceFileMatches.js";
import {
  absoluteSourceEditorPath,
  normalizeSourceEditorRelativePath,
  sourceEditorError,
  sourceEditorPathStats
} from "./sourceEditorPaths.js";
import {
  directoryNode,
  sourceEditorDirectoryPage,
  sourceEditorFileRevealTree
} from "./sourceFileTree.js";
// Session source files: path policy, tree, file matching, search, resolution
// and read/create/save. The Files areas and integrations reuse these helpers.
const SOURCE_EDITOR_CONFLICT_CODE = "vibe64_source_editor_conflict";

const SOURCE_EDITOR_SEARCH_RESULT_LIMIT = 120;

const SOURCE_EDITOR_SEARCH_TIMEOUT_MS = 6000;

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

function isPlainObject(value = null) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function streamSourceEditorFileChanges(context, file, stream, fileObserver) {
  const {
    emit,
    isClosed,
    onClose
  } = stream;
  if (
    typeof emit !== "function" ||
    typeof isClosed !== "function" ||
    typeof onClose !== "function"
  ) {
    throw new TypeError("Source file change streams require emit(), isClosed(), and onClose().");
  }
  if (isClosed()) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let finished = false;
    let unsubscribe = null;
    const finish = () => {
      if (finished) {
        return;
      }
      finished = true;
      unsubscribe?.();
      resolve();
    };
    onClose(finish);
    unsubscribe = fileObserver.subscribe({
      relativePath: file.relativePath,
      sourceRoot: context.sourceRoot
    }, (event = {}) => {
      if (finished || isClosed()) {
        return;
      }
      const payload = {
        path: file.relativePath,
        sessionId: context.sessionId
      };
      switch (event.kind) {
        case "ready":
          emit(VIBE64_SOURCE_EDITOR_SYNC_READY_EVENT, payload);
          break;
        case "change":
          emit(VIBE64_SOURCE_EDITOR_FILE_CHANGED_EVENT, {
            ...payload,
            originId: "filesystem",
            updatedAt: normalizeText(event.updatedAt) || new Date().toISOString()
          });
          break;
        case "error":
          try {
            emit(VIBE64_SOURCE_EDITOR_SYNC_ERROR_EVENT, {
              ...payload,
              error: normalizeText(event.error) || "Source file observation failed.",
              fatal: false
            });
          } finally {
            finish();
          }
          break;
        case "closed":
          finish();
          break;
        default:
          break;
      }
    });
    if (finished) {
      unsubscribe();
    }
  });
}

async function downloadSessionFile(context, relativePath) {
  const file = await sourceEditorExistingFile(context, relativePath, { maxFileBytes: Infinity });
  const handle = await open(file.absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stats = await handle.stat();
    if (!stats.isFile() || stats.dev !== file.stats.dev || stats.ino !== file.stats.ino) {
      throw sourceEditorError("The file changed while opening. Try downloading again.", "vibe64_source_editor_file_changed", {}, 409);
    }
    return { ok: true, fileHandle: handle, name: path.posix.basename(file.relativePath) };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function runSourceEditorOperation(operation) {
  try {
    return await operation();
  } catch (error) {
    return sourceEditorErrorResponse(error);
  }
}

async function streamSourceEditorOperation(operation, options = {}) {
  const {
    emit = null
  } = options;
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

function sourceEditorErrorResponse(error) {
  return {
    ...vibe64ErrorResponse(error, {
      fallbackCode: "vibe64_source_editor_failed",
      fallbackMessage: "Source editor operation failed."
    }),
    statusCode: error?.statusCode || 400,
    ...(error?.fieldErrors ? { fieldErrors: error.fieldErrors } : {})
  };
}

function publicSourceEditorPolicy(policy = {}) {
  return {
    exclude: Array.isArray(policy.exclude) ? policy.exclude : [],
    maxFileBytes: policy.maxFileBytes,
    maxTreeDepth: policy.maxTreeDepth,
    maxTreeEntries: policy.maxTreeEntries
  };
}

function sourceEditorPolicyExcludeGlobs(policy = {}) {
  const globs = [];
  const seen = new Set();
  function add(pattern = "") {
    const normalized = normalizePolicyPath(pattern);
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    globs.push("--glob", `!${normalized}`);
  }

  for (const pattern of Array.isArray(policy.exclude) ? policy.exclude : []) {
    const normalized = normalizePolicyPath(pattern);
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

async function sourceEditorFilePaths(context = {}) {
  const paths = [];
  const ripgrepRun = await runRipgrepLines([
    "--files",
    ...sourceEditorRipgrepBaseArgs(context.policy)
  ], {
    cwd: context.sourceRoot,
    onLine(line = "") {
      const relativePath = normalizePolicyPath(line);
      if (
        !relativePath ||
        sourceEditorPathExcluded(context.policy, relativePath)
      ) {
        return true;
      }
      paths.push(relativePath);
      return true;
    }
  });
  return { paths, truncated: ripgrepRun.truncated || ripgrepRun.timedOut };
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
  let stats = null;
  try {
    stats = await sourceEditorPathStats(context.sourceRoot, relativePath);
  } catch (error) {
    if (isMissingPathError(error) || error?.code === "vibe64_source_editor_symlink") {
      return null;
    }
    throw error;
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

async function runRipgrepLines(args = [], options = {}) {
  const {
    cwd = "",
    onLine = () => true,
    timeoutMs = SOURCE_EDITOR_SEARCH_TIMEOUT_MS
  } = options;
  const result = await runVibe64Command({
    actor: "app",
    allowedRoots: [
      cwd
    ],
    args,
    command: "rg",
    cwd,
    mode: "capture",
    purpose: "source-editor",
    runtimes: ["ripgrep"],
    timeout: timeoutMs
  });

  const output = String(result.stdout || "");
  let stopped = false;
  const lines = output.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    if (index === lines.length - 1 && rawLine === "") {
      continue;
    }
    const line = rawLine.replace(/\r$/u, "");
    if (onLine(line) === false) {
      stopped = true;
      break;
    }
  }

  if (stopped || result.ok || result.exitCode === 1 || result.timedOut) {
    return {
      timedOut: result.timedOut === true,
      truncated: stopped || result.timedOut === true
    };
  }

  const failureText = [result.error, result.output, result.stderr].filter(Boolean).join("\n");
  if (/\b(?:ENOENT|not found|No such file or directory)\b/iu.test(failureText)) {
    throw sourceEditorError("Source search requires ripgrep (rg) on the Vibe64 host.", "vibe64_source_editor_rg_missing", {}, 500);
  }
  throw sourceEditorError(
    result.stderr || result.output || "Source search failed.",
    "vibe64_source_editor_rg_failed",
    { exitCode: result.exitCode },
    500
  );
}

function normalizeNewSourceEditorFilePath(value = "") {
  const raw = normalizeText(value).replaceAll("\\", "/");
  if (/\/$/u.test(raw)) {
    throw sourceEditorError("Choose a file path, not a directory path.", "vibe64_invalid_source_editor_path");
  }
  if (raw.split("/").some((segment) => segment === "." || segment === "..")) {
    throw sourceEditorError(
      "New source file paths cannot include current- or parent-directory segments.",
      "vibe64_invalid_source_editor_path"
    );
  }
  const relativePath = normalizeSourceEditorRelativePath(raw);
  if (!relativePath || relativePath.endsWith("/")) {
    throw sourceEditorError("Choose a file path before creating a file.", "vibe64_invalid_source_editor_path");
  }
  const basename = path.posix.basename(relativePath);
  if (!basename || basename === "." || basename === "..") {
    throw sourceEditorError("Choose a valid file name before creating a file.", "vibe64_invalid_source_editor_path", {
      path: relativePath
    });
  }
  return relativePath;
}

async function ensureSourceEditorParentDirectory(context = {}, parentRelativePath = "") {
  const parentPath = normalizePolicyPath(parentRelativePath);
  if (parentPath && sourceEditorPathExcluded(context.policy, parentPath)) {
    throw sourceEditorError("The selected directory is excluded from source editing.", "vibe64_source_editor_directory_excluded", {
      path: parentPath
    }, 403);
  }
  let currentPath = path.resolve(context.sourceRoot);
  for (const segment of parentPath.split("/").filter(Boolean)) {
    currentPath = absoluteSourceEditorPath(currentPath, segment);
    try {
      const stats = await lstat(currentPath);
      if (stats.isSymbolicLink()) {
        throw sourceEditorError("Source editor does not write through symbolic links.", "vibe64_source_editor_symlink", {
          path: parentPath
        }, 403);
      }
      if (!stats.isDirectory()) {
        throw sourceEditorError("Choose a source directory.", "vibe64_invalid_source_editor_path", {
          path: parentPath
        });
      }
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw error;
      }
      await mkdir(currentPath);
      const stats = await lstat(currentPath);
      if (!stats.isDirectory() || stats.isSymbolicLink()) {
        throw sourceEditorError("Choose a source directory.", "vibe64_invalid_source_editor_path", {
          path: parentPath
        });
      }
    }
  }
  return currentPath;
}

async function createSourceEditorFile(context = {}, input = {}) {
  const relativePath = normalizeNewSourceEditorFilePath(input.path);
  const content = Buffer.from(String(input.text ?? ""), "utf8");
  if (content.byteLength > context.policy.maxFileBytes) {
    throw sourceEditorError("The new file is too large for the source editor.", "vibe64_source_editor_file_too_large", {}, 413);
  }
  assertTextBuffer(content, relativePath);
  if (sourceEditorPathExcluded(context.policy, relativePath)) {
    throw sourceEditorError("The selected file is excluded from source editing.", "vibe64_source_editor_file_excluded", {
      path: relativePath
    }, 403);
  }

  const absolutePath = absoluteSourceEditorPath(context.sourceRoot, relativePath);
  await ensureSourceEditorParentDirectory(context, path.posix.dirname(relativePath) === "."
    ? ""
    : path.posix.dirname(relativePath));
  try {
    await writeFile(absolutePath, content, {
      encoding: "utf8",
      flag: "wx"
    });
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw sourceEditorError("A source file already exists at that path.", "vibe64_source_editor_file_exists", {
        path: relativePath
      }, 409);
    }
    throw error;
  }
  const savedBuffer = await readFile(absolutePath);
  const savedStats = await lstat(absolutePath);
  if (!savedStats.isFile() || savedStats.isSymbolicLink()) {
    throw sourceEditorError("Source editor created path is not a regular file.", "vibe64_invalid_source_editor_path", {
      path: relativePath
    });
  }
  return sourceEditorFilePayload(relativePath, savedBuffer, savedStats);
}

async function sourceEditorExistingFile(context = {}, relativePathValue = "", options = {}) {
  const {
    maxFileBytes = context.policy.maxFileBytes
  } = options;
  const relativePath = normalizeSourceEditorRelativePath(relativePathValue);
  if (!relativePath) {
    throw sourceEditorError("Choose a file before editing.", "vibe64_invalid_source_editor_path");
  }
  if (sourceEditorPathExcluded(context.policy, relativePath)) {
    throw sourceEditorError("The selected file is excluded from source editing.", "vibe64_source_editor_file_excluded", {
      path: relativePath
    }, 403);
  }

  const absolutePath = absoluteSourceEditorPath(context.sourceRoot, relativePath);
  const stats = await sourceEditorPathStats(context.sourceRoot, relativePath);
  if (!stats.isFile()) {
    throw sourceEditorError("Choose a source file, not a directory.", "vibe64_invalid_source_editor_path", {
      path: relativePath
    });
  }
  if (stats.size > maxFileBytes) {
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
  await writeSourceEditorTextFile(context, file.absolutePath, nextText);
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

function assertTextBuffer(buffer, relativePath = "") {
  if (buffer.includes(0)) {
    throw sourceEditorError("The selected file appears to be binary.", "vibe64_source_editor_binary_file", {
      path: relativePath
    }, 415);
  }
}

function sourceEditorTempRoot(temporaryRoot = "", sessionId = "") {
  const root = normalizeText(temporaryRoot);
  if (!path.isAbsolute(root)) {
    throw sourceEditorError("Source editor requires an absolute runtime temp root.", "vibe64_source_editor_temp_root_missing", {}, 500);
  }
  const sessionKey = crypto.createHash("sha256")
    .update(normalizeText(sessionId))
    .digest("hex")
    .slice(0, 24);
  return path.join(root, "vibe64-source-editor", sessionKey);
}

async function writeSourceEditorTextFile(context = {}, absolutePath = "", text = "") {
  const tempRoot = normalizeText(context.sourceEditorTempRoot);
  if (!tempRoot) {
    throw sourceEditorError("Source editor save requires runtime temp storage.", "vibe64_source_editor_temp_root_missing", {}, 500);
  }
  await mkdir(tempRoot, {
    recursive: true
  });
  const temporaryPath = path.join(tempRoot, `${process.pid}-${Date.now()}-${crypto.randomUUID()}-${path.basename(absolutePath)}`);
  try {
    await writeFile(temporaryPath, text, "utf8");
    await copyFile(temporaryPath, absolutePath);
  } finally {
    await rm(temporaryPath, {
      force: true
    }).catch(() => null);
  }
}

function sourceEditorHash(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function sourceEditorFilePayload(relativePath, buffer, stats, overrides = {}) {
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

export {
  SOURCE_EDITOR_CONFLICT_CODE,
  SOURCE_EDITOR_SEARCH_RESULT_LIMIT,
  absoluteSourceEditorPath,
  createSourceEditorFile,
  directoryNode,
  downloadSessionFile,
  ensureSourceEditorParentDirectory,
  isPlainObject,
  normalizeNewSourceEditorFilePath,
  normalizeSourceEditorQuery,
  normalizeSourceEditorRelativePath,
  publicSourceEditorPolicy,
  readSourceEditorFile,
  resolveSourceEditorPath,
  runSourceEditorOperation,
  saveSourceEditorFile,
  sourceEditorDirectoryPage,
  sourceEditorError,
  sourceEditorErrorResponse,
  sourceEditorExistingFile,
  sourceEditorFileChange,
  sourceEditorFileMatches,
  sourceEditorFilePaths,
  sourceEditorFileRevealTree,
  sourceEditorHash,
  sourceEditorLanguageForPath,
  sourceEditorPathStats,
  sourceEditorResultLimit,
  sourceEditorResultOffset,
  sourceEditorTempRoot,
  streamSourceEditorFileChanges,
  streamSourceEditorOperation
};
