import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

import { pathInsideOrEqual } from "@local/vibe64-core/server/studioProjectContext";
import { runVibe64Command } from "@local/vibe64-execution/server";

import { SYSTEM_DOCUMENT_FILENAME } from "./systemDocument.js";

const GIT_TIMEOUT_MS = 30_000;

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function gitOutput(sourceRoot, args, commandRunner) {
  const result = await commandRunner({
    actor: "daemon",
    allowedRoots: [sourceRoot],
    args,
    command: "git",
    cwd: sourceRoot,
    envPolicy: "session",
    gitSafeDirectories: [sourceRoot],
    mode: "capture",
    purpose: "adapter",
    runtimes: ["git"],
    timeout: GIT_TIMEOUT_MS
  });
  if (result.ok === true) {
    return String(result.stdout || "");
  }
  throw new Error(String(result.stderr || result.stdout || result.output || result.error || "Git inspection failed."));
}

function normalizeGitPath(value = "") {
  return String(value || "").trim().replace(/\\/gu, "/").replace(/^\.\//u, "");
}

function parsePorcelainStatus(output = "") {
  const tokens = String(output || "").split("\u0000");
  const records = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token || token.length < 4) {
      continue;
    }
    const status = token.slice(0, 2);
    const filePath = normalizeGitPath(token.slice(3));
    if (filePath) {
      records.push({ path: filePath, status });
    }
    if (status.includes("R") || status.includes("C")) {
      const previousPath = normalizeGitPath(tokens[index + 1]);
      index += 1;
      if (previousPath) {
        records.push({ path: previousPath, status: `${status}:from` });
      }
    }
  }
  return records
    .filter((record) => record.path !== SYSTEM_DOCUMENT_FILENAME)
    .sort((left, right) => left.path.localeCompare(right.path) || left.status.localeCompare(right.status));
}

async function changedPathHash(sourceRoot, relativePath) {
  const absolutePath = path.resolve(sourceRoot, relativePath);
  if (!pathInsideOrEqual(sourceRoot, absolutePath)) {
    throw new Error(`Git reported a path outside the session source: ${relativePath}.`);
  }
  try {
    const fileStat = await lstat(absolutePath);
    if (!fileStat.isFile()) {
      return "non-file";
    }
    return hash(await readFile(absolutePath));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return "deleted";
    }
    throw error;
  }
}

async function readGitSnapshot(sourceRoot, {
  commandRunner = runVibe64Command
} = {}) {
  const [headOutput, statusOutput] = await Promise.all([
    gitOutput(sourceRoot, ["rev-parse", "--verify", "HEAD"], commandRunner).catch(() => "unborn"),
    gitOutput(sourceRoot, ["status", "--porcelain=v1", "-z", "--untracked-files=all"], commandRunner)
  ]);
  const head = headOutput.trim() || "unborn";
  const status = parsePorcelainStatus(statusOutput);
  const changed = [];
  for (const record of status) {
    changed.push({
      ...record,
      hash: await changedPathHash(sourceRoot, record.path)
    });
  }
  return {
    changed,
    changedPaths: [...new Set(changed.map((record) => record.path))].sort(),
    digest: hash(JSON.stringify({ head, changed })),
    head
  };
}

export {
  parsePorcelainStatus,
  readGitSnapshot
};
