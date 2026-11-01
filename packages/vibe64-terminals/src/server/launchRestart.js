// Whether a running Preview must restart: the source baseline recorded at launch and what changed since.

import crypto from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { runVibe64Command } from "@local/vibe64-execution/server";
import {
  launchRestartRulesMatcher,
  normalizeLaunchRestartPath,
  normalizeLaunchRestartRules
} from "@local/vibe64-core/server/launchRestartRules";
import { vibe64SessionDebugError, vibe64SessionDebugLog } from "@local/vibe64-runtime/server/sessionDebugLog";
import { pathInsideOrEqual } from "@local/vibe64-core/server/core";

const LAUNCH_RESTART_REASON_SOURCE_CHANGED = "server_source_changed";
const MAX_RESTART_CHANGED_FILES = 20;

function normalizeLaunchRestartBaseline(input = null) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const rules = normalizeLaunchRestartRules(source.rules);
  const dirtySignature = String(source.dirtySignature || "").trim();
  const dirtyEntries = (Array.isArray(source.dirtyEntries) ? source.dirtyEntries : [])
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .sort();
  if (!rules || !dirtySignature) {
    return null;
  }
  return {
    dirtyEntries,
    dirtySignature,
    head: String(source.head || "").trim(),
    rules,
    version: 1
  };
}

function serializeLaunchRestartBaseline(input = null) {
  const baseline = normalizeLaunchRestartBaseline(input);
  return baseline ? JSON.stringify(baseline) : "";
}

function parseNullSeparatedPaths(output = "") {
  return String(output || "")
    .split("\0")
    .map(normalizeLaunchRestartPath)
    .filter(Boolean);
}

async function gitOutput(root = "", args = [], {
  runCommand = runVibe64Command
} = {}) {
  const result = await runCommand({
    actor: "daemon",
    allowedRoots: [root],
    args: ["-C", root, ...args],
    command: "git",
    cwd: root,
    envPolicy: "preview",
    mode: "capture",
    purpose: "preview",
    runtimes: ["git"],
    timeout: 10000
  });
  if (result?.ok === false) {
    const error = new Error(result.error || result.stderr || result.output || "Git command failed.");
    error.code = result.code || "vibe64_preview_git_command_failed";
    error.result = result;
    throw error;
  }
  return String(result.stdout || "");
}

async function gitOutputOrEmpty(root = "", args = [], options = {}) {
  try {
    return await gitOutput(root, args, options);
  } catch {
    return "";
  }
}

async function gitHead(root = "", options = {}) {
  return (await gitOutputOrEmpty(root, ["rev-parse", "--verify", "HEAD"], options)).trim();
}

async function gitIsWorkTree(root = "", options = {}) {
  return (await gitOutputOrEmpty(root, ["rev-parse", "--is-inside-work-tree"], options)).trim() === "true";
}

async function changedPathsFromGit(root = "", args = [], rules = null, options = {}) {
  const output = await gitOutputOrEmpty(root, args, options);
  return parseNullSeparatedPaths(output).filter(launchRestartRulesMatcher(rules));
}

async function dirtyRestartPaths(root = "", rules = null, options = {}) {
  const pathGroups = await Promise.all([
    changedPathsFromGit(root, ["diff", "--name-only", "-z", "--"], rules, options),
    changedPathsFromGit(root, ["diff", "--name-only", "-z", "--cached", "--"], rules, options),
    changedPathsFromGit(root, ["ls-files", "-z", "--others", "--exclude-standard"], rules, options)
  ]);
  return [...new Set(pathGroups.flat())].sort();
}

async function fileContentSignature(root = "", relativePath = "") {
  const absolutePath = path.resolve(root, normalizeLaunchRestartPath(relativePath));
  if (!pathInsideOrEqual(root, absolutePath)) {
    return "outside";
  }
  try {
    const stats = await stat(absolutePath);
    if (!stats.isFile()) {
      return stats.isDirectory() ? "directory" : "other";
    }
    const content = await readFile(absolutePath);
    return crypto.createHash("sha256").update(content).digest("hex");
  } catch (error) {
    return error?.code === "ENOENT" ? "missing" : "unreadable";
  }
}

function hashRestartEntries(entries = []) {
  return crypto.createHash("sha256")
    .update(entries.slice().sort().join("\n"))
    .digest("hex");
}

async function dirtyRestartSignature(root = "", rules = null, options = {}) {
  const paths = await dirtyRestartPaths(root, rules, options);
  const entries = await Promise.all(paths.map(async (relativePath) => {
    const signature = await fileContentSignature(root, relativePath);
    return `${relativePath}\t${signature}`;
  }));
  return {
    entries: entries.slice().sort(),
    files: paths,
    signature: hashRestartEntries(entries)
  };
}

function dirtyEntrySignatureMap(entries = []) {
  const signatures = new Map();
  for (const entry of entries) {
    const [relativePath = "", signature = ""] = String(entry || "").split("\t");
    const normalizedPath = normalizeLaunchRestartPath(relativePath);
    if (normalizedPath && signature) {
      signatures.set(normalizedPath, signature);
    }
  }
  return signatures;
}

async function contentChangedSinceLaunchDirtyState(root = "", relativePath = "", launchDirtySignatures = new Map()) {
  const launchSignature = launchDirtySignatures.get(normalizeLaunchRestartPath(relativePath));
  if (!launchSignature) {
    return true;
  }
  return await fileContentSignature(root, relativePath) !== launchSignature;
}

async function committedRestartPathsChangedSinceLaunch(root = "", paths = [], baseline = null) {
  const launchDirtySignatures = dirtyEntrySignatureMap(baseline?.dirtyEntries);
  const changed = await Promise.all(paths.map(async (relativePath) => {
    const contentChanged = await contentChangedSinceLaunchDirtyState(root, relativePath, launchDirtySignatures);
    return contentChanged ? relativePath : "";
  }));
  return changed.filter(Boolean);
}

async function committedRestartPathsFromUnbornLaunch(root = "", baseline = null, rules = null, options = {}) {
  if (baseline?.head) {
    return [];
  }
  return committedRestartPathsChangedSinceLaunch(
    root,
    await changedPathsFromGit(root, ["ls-files", "-z"], rules, options),
    baseline
  );
}

async function createLaunchRestartBaseline({
  restartOnChange = null,
  worktreePath = ""
} = {}, options = {}) {
  const rules = normalizeLaunchRestartRules(restartOnChange);
  const root = String(worktreePath || "").trim();
  if (!rules || !root) {
    return null;
  }
  if (!await gitIsWorkTree(root, options)) {
    return null;
  }
  const [head, dirtyState] = await Promise.all([
    gitHead(root, options),
    dirtyRestartSignature(root, rules, options)
  ]);
  return normalizeLaunchRestartBaseline({
    dirtyEntries: dirtyState.entries,
    dirtySignature: dirtyState.signature,
    head,
    rules,
    version: 1
  });
}

async function launchRestartState({
  baseline = null,
  worktreePath = ""
} = {}, options = {}) {
  const root = String(worktreePath || "").trim();
  const normalizedBaseline = normalizeLaunchRestartBaseline(baseline);
  const rules = normalizedBaseline?.rules || null;
  if (!normalizedBaseline || !rules || !root) {
    return {
      stale: false
    };
  }
  const [currentHead, dirtyState] = await Promise.all([
    gitHead(root, options),
    dirtyRestartSignature(root, rules, options)
  ]);
  const committedFiles = currentHead
    ? normalizedBaseline.head && normalizedBaseline.head !== currentHead
      ? await committedRestartPathsChangedSinceLaunch(
        root,
        await changedPathsFromGit(
          root,
          ["diff", "--name-only", "-z", `${normalizedBaseline.head}..${currentHead}`, "--"],
          rules,
          options
        ),
        normalizedBaseline
      )
      : await committedRestartPathsFromUnbornLaunch(root, normalizedBaseline, rules, options)
    : [];
  const dirtyFiles = dirtyState.signature !== normalizedBaseline.dirtySignature ? dirtyState.files : [];
  const changedFiles = [...new Set([
    ...committedFiles,
    ...dirtyFiles
  ])].sort();
  return {
    changedFiles: changedFiles.slice(0, MAX_RESTART_CHANGED_FILES),
    changedFilesTruncated: changedFiles.length > MAX_RESTART_CHANGED_FILES,
    currentHead,
    reason: rules.reason,
    stale: changedFiles.length > 0
  };
}

function staleLaunchRecovery({
  canRestart = false,
  reason = "server_restart_state_lost",
  terminalSessionId = ""
} = {}) {
  return {
    canRestart: Boolean(canRestart),
    canStopStale: false,
    reason,
    terminalSessionId: String(terminalSessionId || "")
  };
}

async function launchRestartRecoveryForTerminal({
  context = {},
  terminal = null
} = {}) {
  const launchRestartBaseline = normalizeLaunchRestartBaseline(terminal?.metadata?.launchRestartBaseline);
  if (!launchRestartBaseline) {
    return null;
  }
  const metadata = terminal.metadata || {};
  const worktreePath = String(metadata.runRoot || metadata.sessionSourceRoot || context.sessionSourceRoot || "").trim();
  if (!worktreePath) {
    return null;
  }
  try {
    const restartState = await launchRestartState({
      baseline: launchRestartBaseline,
      worktreePath
    });
    if (!restartState.stale) {
      return null;
    }
    return {
      canRestart: true,
      changedFiles: restartState.changedFiles,
      changedFilesTruncated: restartState.changedFilesTruncated,
      label: launchRestartBaseline.rules?.label || "server-side files",
      reason: restartState.reason || LAUNCH_RESTART_REASON_SOURCE_CHANGED
    };
  } catch (error) {
    vibe64SessionDebugLog("server.outputTargetTerminal.restartState.error", {
      error: vibe64SessionDebugError(error),
      sessionId: context.session?.sessionId || "",
      sessionSourceRoot: context.sessionSourceRoot || "",
      terminalSessionId: terminal.id || ""
    }, {
      level: "warn"
    });
    return null;
  }
}

export {
  createLaunchRestartBaseline,
  LAUNCH_RESTART_REASON_SOURCE_CHANGED,
  launchRestartRecoveryForTerminal,
  launchRestartState,
  serializeLaunchRestartBaseline,
  staleLaunchRecovery
};
