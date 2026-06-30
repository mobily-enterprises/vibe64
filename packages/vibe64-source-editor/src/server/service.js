import crypto from "node:crypto";
import { lstat, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
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

function createService({ projectService } = {}) {
  if (!projectService || typeof projectService.createRuntime !== "function") {
    throw new TypeError("createService requires feature.vibe64-project.service.");
  }

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
