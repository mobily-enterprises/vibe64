import crypto from "node:crypto";
import {
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";

import {
  sessionSourcePath
} from "@local/vibe64-core/server/sessionSourcePath";
import { openedFileWithin } from "./openedFileWithin.js";

const OUTPUT_RESULTS_DIRECTORY = "output-results";
const OUTPUT_RESULTS_INDEX = "index.json";
const OUTPUT_RESULT_MAX_BYTES = 256 * 1024 * 1024;
const OUTPUT_RUN_MAX_BYTES = 512 * 1024 * 1024;
const COPY_BUFFER_BYTES = 64 * 1024;
const RESULT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const STORAGE_NAME_PATTERN = /^[0-9a-f-]{36}\.blob$/u;
const snapshotLocks = new Map();

function outputResultError(code, message, statusCode = 409) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function pathInside(rootPath = "", candidatePath = "") {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function canonicalDeclaredPath(value = "") {
  const declaredPath = String(value || "").trim();
  return Boolean(declaredPath) &&
    declaredPath !== "." &&
    !declaredPath.includes("\\") &&
    !path.posix.isAbsolute(declaredPath) &&
    path.posix.normalize(declaredPath) === declaredPath &&
    !declaredPath.split("/").some((part) => !part || part === "..");
}

function outputResultsRoot(session = {}) {
  const sessionRoot = String(session?.sessionRoot || "").trim();
  if (!sessionRoot || !path.isAbsolute(sessionRoot)) {
    throw outputResultError(
      "vibe64_output_results_session_root_unavailable",
      "The session output-result store is unavailable."
    );
  }
  return path.join(sessionRoot, OUTPUT_RESULTS_DIRECTORY);
}

function outputResultsIndexPath(root = "") {
  return path.join(root, OUTPUT_RESULTS_INDEX);
}

function emptyIndex() {
  return {
    schemaVersion: 1,
    runs: []
  };
}

function validIndex(value = {}) {
  return value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    value.schemaVersion === 1 &&
    Array.isArray(value.runs);
}

async function readOutputResultsIndex(root = "") {
  try {
    const parsed = JSON.parse(await readFile(outputResultsIndexPath(root), "utf8"));
    if (!validIndex(parsed)) {
      throw new Error("invalid output-result index");
    }
    return parsed;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return emptyIndex();
    }
    throw outputResultError(
      "vibe64_output_results_index_invalid",
      "The session output-result index is invalid."
    );
  }
}

async function writeOutputResultsIndex(root = "", index = {}) {
  const temporaryPath = path.join(root, `.index-${crypto.randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, `${JSON.stringify(index, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600
    });
    await rename(temporaryPath, outputResultsIndexPath(root));
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => null);
    throw error;
  }
}

function sameFileSnapshot(before, after) {
  return before.dev === after.dev &&
    before.ino === after.ino &&
    before.nlink === after.nlink &&
    before.size === after.size &&
    before.mtimeNs === after.mtimeNs &&
    before.ctimeNs === after.ctimeNs;
}

async function writeAll(fileHandle, buffer, length, position) {
  let written = 0;
  while (written < length) {
    const result = await fileHandle.write(buffer, written, length - written, position + written);
    if (!Number.isInteger(result.bytesWritten) || result.bytesWritten < 1) {
      throw new Error("Output-result snapshot write made no progress.");
    }
    written += result.bytesWritten;
  }
}

async function snapshotRegularFile(sourcePath = "", destinationPath = "", {
  maxBytes = OUTPUT_RESULT_MAX_BYTES,
  sourceRoot = ""
} = {}) {
  const sourceFlags = fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | (fsConstants.O_CLOEXEC || 0);
  const destinationFlags = fsConstants.O_WRONLY |
    fsConstants.O_CREAT |
    fsConstants.O_EXCL |
    fsConstants.O_NOFOLLOW |
    (fsConstants.O_CLOEXEC || 0);
  let source = null;
  let destination = null;
  try {
    source = await open(sourcePath, sourceFlags);
    const before = await source.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n) {
      throw outputResultError(
        "vibe64_output_result_not_regular_file",
        "A declared download must be one ordinary, non-linked file."
      );
    }
    if (before.size > BigInt(maxBytes)) {
      throw outputResultError(
        "vibe64_output_result_too_large",
        `A declared download exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MB result limit.`
      );
    }
    if (!await openedFileWithin(source, sourcePath, (openedPath) => pathInside(sourceRoot, openedPath))) {
      throw outputResultError(
        "vibe64_output_result_outside_source",
        "A declared download resolved outside the session source."
      );
    }
    destination = await open(destinationPath, destinationFlags, 0o600);
    const hash = crypto.createHash("sha256");
    const buffer = Buffer.allocUnsafe(COPY_BUFFER_BYTES);
    let position = 0;
    while (true) {
      const { bytesRead } = await source.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) {
        break;
      }
      position += bytesRead;
      if (position > maxBytes) {
        throw outputResultError(
          "vibe64_output_result_too_large",
          `A declared download exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MB result limit.`
        );
      }
      hash.update(buffer.subarray(0, bytesRead));
      await writeAll(destination, buffer, bytesRead, position - bytesRead);
    }
    await destination.sync();
    const after = await source.stat({ bigint: true });
    if (!sameFileSnapshot(before, after) || BigInt(position) !== before.size) {
      throw outputResultError(
        "vibe64_output_result_changed",
        "A declared download changed while Vibe64 was snapshotting it. Run the output again."
      );
    }
    return {
      sha256: hash.digest("hex"),
      size: position
    };
  } catch (error) {
    if (["ELOOP", "ENOENT", "ENOTDIR"].includes(error?.code)) {
      throw outputResultError(
        "vibe64_output_result_missing",
        "A declared download is missing or is a symbolic link."
      );
    }
    throw error;
  } finally {
    await destination?.close().catch(() => null);
    await source?.close().catch(() => null);
  }
}

function publicOutputResult(result = {}) {
  return {
    createdAt: String(result.createdAt || ""),
    downloadId: String(result.downloadId || ""),
    id: String(result.id || ""),
    mediaType: String(result.mediaType || "application/octet-stream"),
    name: String(result.name || "download"),
    sha256: String(result.sha256 || ""),
    size: Number(result.size || 0)
  };
}

function publicOutputRun(run = {}) {
  return {
    createdAt: String(run.createdAt || ""),
    id: String(run.id || ""),
    outputTargetId: String(run.outputTargetId || ""),
    results: (Array.isArray(run.results) ? run.results : []).map(publicOutputResult),
    terminalSessionId: String(run.terminalSessionId || "")
  };
}

function normalizeDownload(download = {}) {
  const declaredPath = String(download?.path || "").trim();
  if (!canonicalDeclaredPath(declaredPath)) {
    throw outputResultError(
      "vibe64_output_result_path_invalid",
      "A declared download path is invalid."
    );
  }
  return {
    id: String(download?.id || "").trim(),
    mediaType: String(download?.mediaType || "application/octet-stream").trim(),
    name: String(download?.name || download?.id || "download").trim(),
    path: declaredPath
  };
}

async function withSnapshotLock(key = "", operation = async () => null) {
  const previous = snapshotLocks.get(key) || Promise.resolve();
  const run = previous.catch(() => null).then(operation);
  const tracked = run.finally(() => {
    if (snapshotLocks.get(key) === tracked) {
      snapshotLocks.delete(key);
    }
  });
  snapshotLocks.set(key, tracked);
  return tracked;
}

async function snapshotDeclaredOutputResults({
  downloads = [],
  outputTargetId = "",
  session = {},
  terminalSessionId = ""
} = {}) {
  const declarations = (Array.isArray(downloads) ? downloads : []).map(normalizeDownload);
  if (declarations.length === 0) {
    return {
      captured: false,
      results: [],
      run: null
    };
  }
  const sessionSourceRoot = String(sessionSourcePath(session) || "").trim();
  if (!sessionSourceRoot || !path.isAbsolute(sessionSourceRoot)) {
    throw outputResultError(
      "vibe64_output_results_source_unavailable",
      "The session source is unavailable for output-result snapshotting."
    );
  }
  const sourceRoot = path.resolve(sessionSourceRoot);
  const root = outputResultsRoot(session);
  const normalizedTerminalSessionId = String(terminalSessionId || "").trim();
  return withSnapshotLock(root, async () => {
    await mkdir(root, { recursive: true, mode: 0o700 });
    await chmod(root, 0o700);
    const index = await readOutputResultsIndex(root);
    const existing = index.runs.find((run) => run.terminalSessionId === normalizedTerminalSessionId);
    if (existing) {
      return {
        captured: false,
        results: existing.results.map(publicOutputResult),
        run: publicOutputRun(existing)
      };
    }
    const runId = crypto.randomUUID();
    const stagedDirectory = path.join(root, `.run-${runId}.tmp`);
    const runDirectory = path.join(root, `run-${runId}`);
    let runPublished = false;
    await mkdir(stagedDirectory, { mode: 0o700 });
    try {
      const results = [];
      let runBytes = 0;
      for (const declaration of declarations) {
        const resultId = crypto.randomUUID();
        const storageName = `${resultId}.blob`;
        const sourcePath = path.resolve(sourceRoot, declaration.path);
        if (!pathInside(sourceRoot, sourcePath)) {
          throw outputResultError(
            "vibe64_output_result_outside_source",
            "A declared download resolved outside the session source."
          );
        }
        const snapshot = await snapshotRegularFile(
          sourcePath,
          path.join(stagedDirectory, storageName),
          {
            maxBytes: Math.min(OUTPUT_RESULT_MAX_BYTES, OUTPUT_RUN_MAX_BYTES - runBytes),
            sourceRoot
          }
        );
        runBytes += snapshot.size;
        await chmod(path.join(stagedDirectory, storageName), 0o400);
        results.push({
          createdAt: new Date().toISOString(),
          downloadId: declaration.id,
          id: resultId,
          mediaType: declaration.mediaType,
          name: declaration.name,
          sha256: snapshot.sha256,
          size: snapshot.size,
          storageName
        });
      }
      await rename(stagedDirectory, runDirectory);
      runPublished = true;
      const run = {
        createdAt: new Date().toISOString(),
        id: runId,
        outputTargetId: String(outputTargetId || "").trim(),
        results,
        terminalSessionId: normalizedTerminalSessionId
      };
      index.runs.unshift(run);
      await writeOutputResultsIndex(root, index);
      return {
        captured: true,
        results: results.map(publicOutputResult),
        run: publicOutputRun(run)
      };
    } catch (error) {
      await rm(stagedDirectory, { force: true, recursive: true }).catch(() => null);
      if (runPublished) {
        await rm(runDirectory, { force: true, recursive: true }).catch(() => null);
      }
      throw error;
    }
  });
}

async function listOutputResults(session = {}) {
  const root = outputResultsRoot(session);
  const index = await readOutputResultsIndex(root);
  return index.runs.map(publicOutputRun);
}

async function readOutputResult(session = {}, resultId = "") {
  const normalizedResultId = String(resultId || "").trim().toLowerCase();
  if (!RESULT_ID_PATTERN.test(normalizedResultId)) {
    throw outputResultError(
      "vibe64_output_result_not_found",
      "Output result not found.",
      404
    );
  }
  const root = outputResultsRoot(session);
  const index = await readOutputResultsIndex(root);
  for (const run of index.runs) {
    const result = (Array.isArray(run.results) ? run.results : [])
      .find((entry) => entry.id === normalizedResultId);
    if (!result) {
      continue;
    }
    const storageName = String(result.storageName || "").trim();
    if (!STORAGE_NAME_PATTERN.test(storageName)) {
      break;
    }
    const runDirectory = path.join(root, `run-${String(run.id || "")}`);
    const filePath = path.join(runDirectory, storageName);
    if (!pathInside(root, filePath)) {
      break;
    }
    try {
      const fileHandle = await open(
        filePath,
        fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | (fsConstants.O_CLOEXEC || 0)
      );
      const fileStat = await fileHandle.stat({ bigint: true });
      if (!fileStat.isFile() || fileStat.nlink !== 1n || fileStat.size !== BigInt(result.size)) {
        await fileHandle.close();
        break;
      }
      if (!await openedFileWithin(fileHandle, filePath, (openedPath) => pathInside(root, openedPath))) {
        await fileHandle.close();
        break;
      }
      return {
        fileHandle,
        result: publicOutputResult(result),
        run: publicOutputRun(run)
      };
    } catch (error) {
      if (!["ENOENT", "ENOTDIR", "ELOOP"].includes(error?.code)) {
        throw error;
      }
      break;
    }
  }
  throw outputResultError(
    "vibe64_output_result_not_found",
    "Output result not found.",
    404
  );
}

async function removeOutputResults(session = {}) {
  const root = outputResultsRoot(session);
  await rm(root, { force: true, recursive: true });
}

export {
  OUTPUT_RESULT_MAX_BYTES,
  OUTPUT_RESULTS_DIRECTORY,
  OUTPUT_RUN_MAX_BYTES,
  listOutputResults,
  outputResultsRoot,
  readOutputResult,
  removeOutputResults,
  snapshotDeclaredOutputResults
};
