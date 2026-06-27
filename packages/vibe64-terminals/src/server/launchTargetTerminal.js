import { execFile } from "node:child_process";
import crypto from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import path from "node:path";
import { promisify } from "node:util";

import stripAnsi from "strip-ansi";

import {
  closeTerminalSession,
  closeTerminalSessionsForNamespace,
  listTerminalSessions,
  readTerminalSession,
  resizeTerminalSession,
  startTerminalSession,
  stopTerminalSession,
  subscribeTerminalSession,
  updateTerminalSessionMetadata,
  writeTerminalSession
} from "@local/studio-terminal-core/server/terminalSessions";
import {
  listRunningLaunchTargetContainers,
  removeLaunchTargetContainers
} from "@local/studio-terminal-core/server/launchTargetTerminal";
import {
  terminalNoGithubActorMetadata
} from "@local/studio-terminal-core/server/terminalOwnership";
import {
  currentProcessIsDockerContainer,
  ensureCurrentContainerConnectedToRuntimeNetwork,
  ensureTargetRuntimeNetwork
} from "@local/studio-terminal-core/server/runtimeContainers";
import {
  isLoopbackAddress,
  normalizeHostName
} from "@local/vibe64-core/server/localStudioRequest";
import {
  normalizePreviewAuthKind,
  previewAuthProfilePath
} from "@local/vibe64-core/server/previewAuth";
import {
  vibe64SessionDebugDurationMs,
  vibe64SessionDebugError,
  vibe64SessionDebugLog
} from "@local/vibe64-runtime/server/sessionDebugLog";
import {
  commandInvocation,
  vibe64Result,
  launchTargetTerminalNamespace,
  sessionTerminalCwd,
  terminalProjectScopeKey,
  stableHash
} from "./terminalShared.js";
import {
  projectTerminalEnvironment,
  terminalEnvironmentFingerprint
} from "./terminalEnvironment.js";
import {
  ensureAdapterRuntimeContainers
} from "./terminalRuntimeContainers.js";
import {
  createLaunchPreviewProxyRegistry
} from "./launchPreviewProxy.js";

const LAUNCH_METADATA = Object.freeze({
  agentHref: "launch_target_agent_href",
  href: "launch_target_open_href",
  id: "launch_target_id",
  input: "launch_target_input",
  kind: "launch_target_open_kind",
  label: "launch_target_label",
  openLabel: "launch_target_open_label",
  previewAuth: "launch_target_preview_auth",
  restartBaseline: "launch_target_restart_baseline",
  sessionRoot: "launch_target_session_root",
  startedAt: "launch_target_started_at",
  terminalId: "launch_target_terminal_id"
});
const LAUNCH_METADATA_NAMES = Object.freeze(Object.values(LAUNCH_METADATA));
const MAX_LAUNCH_ACTION_SCAN_LINES = 10;
const PREVIEW_PUBLIC_HOST_PREFIX = "v64preview";
const execFileAsync = promisify(execFile);
const LAUNCH_RESTART_REASON_SOURCE_CHANGED = "server_source_changed";
const LAUNCH_READY_STABILITY_DELAY_MS = 2500;
const LAUNCH_READY_PROBE_TIMEOUT_MS = 1500;
const MAX_RESTART_CHANGED_FILES = 20;

function normalizeLaunchTargetId(value = "") {
  return String(value || "").trim();
}

function normalizeOpenTarget(value = {}) {
  return {
    href: String(value.href || "").trim(),
    kind: String(value.kind || "url").trim() || "url",
    label: String(value.label || "Open").trim() || "Open"
  };
}

function parseLaunchInputMetadata(value = "") {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return normalizeLaunchInput(parsed);
  } catch {
    return {};
  }
}

function serializeLaunchInputMetadata(input = {}) {
  return JSON.stringify(normalizeLaunchInput(input));
}

function normalizeRestartPath(relativePath = "") {
  return String(relativePath || "")
    .replace(/\\/gu, "/")
    .replace(/^\.\/+/u, "")
    .replace(/^\/+/u, "")
    .trim();
}

function normalizeRestartPattern(pattern = "") {
  const normalized = normalizeRestartPath(pattern);
  return normalized.endsWith("/") ? `${normalized}**` : normalized;
}

function normalizeLaunchRestartRules(input = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const include = (Array.isArray(source.include) ? source.include : [])
    .map(normalizeRestartPattern)
    .filter(Boolean);
  if (include.length < 1) {
    return null;
  }
  const exclude = (Array.isArray(source.exclude) ? source.exclude : [])
    .map(normalizeRestartPattern)
    .filter(Boolean);
  return {
    exclude,
    include,
    label: String(source.label || "server-side files").trim() || "server-side files",
    reason: String(source.reason || LAUNCH_RESTART_REASON_SOURCE_CHANGED).trim() || LAUNCH_RESTART_REASON_SOURCE_CHANGED,
    version: 1
  };
}

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

function parseLaunchRestartBaseline(value = "") {
  const serialized = String(value || "").trim();
  if (!serialized) {
    return null;
  }
  try {
    return normalizeLaunchRestartBaseline(JSON.parse(serialized));
  } catch {
    return null;
  }
}

function escapeRegExpChar(character = "") {
  return /[\\^$+?.()|[\]{}]/u.test(character) ? `\\${character}` : character;
}

function restartGlobToRegExp(pattern = "") {
  const normalized = normalizeRestartPattern(pattern);
  let source = "^";
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (character === "*") {
      if (normalized[index + 1] === "*") {
        if (normalized[index + 2] === "/") {
          source += "(?:.*/)?";
          index += 2;
          continue;
        }
        source += ".*";
        index += 1;
      } else {
        source += "[^/]*";
      }
      continue;
    }
    source += escapeRegExpChar(character);
  }
  return new RegExp(`${source}$`, "u");
}

function restartPathMatchesPattern(relativePath = "", pattern = "") {
  const normalizedPath = normalizeRestartPath(relativePath);
  const normalizedPattern = normalizeRestartPattern(pattern);
  if (!normalizedPath || !normalizedPattern) {
    return false;
  }
  return restartGlobToRegExp(normalizedPattern).test(normalizedPath);
}

function restartPathMatchesRules(relativePath = "", rules = null) {
  if (!rules?.include?.length) {
    return false;
  }
  return rules.include.some((pattern) => restartPathMatchesPattern(relativePath, pattern)) &&
    !rules.exclude.some((pattern) => restartPathMatchesPattern(relativePath, pattern));
}

function parseNullSeparatedPaths(output = "") {
  return String(output || "")
    .split("\0")
    .map(normalizeRestartPath)
    .filter(Boolean);
}

async function gitOutput(root = "", args = [], {
  execFileImpl = execFileAsync
} = {}) {
  const result = await execFileImpl("git", ["-C", root, ...args], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    timeout: 10000
  });
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
  return parseNullSeparatedPaths(output).filter((relativePath) => restartPathMatchesRules(relativePath, rules));
}

async function dirtyRestartPaths(root = "", rules = null, options = {}) {
  const pathGroups = await Promise.all([
    changedPathsFromGit(root, ["diff", "--name-only", "-z", "--"], rules, options),
    changedPathsFromGit(root, ["diff", "--name-only", "-z", "--cached", "--"], rules, options),
    changedPathsFromGit(root, ["ls-files", "-z", "--others", "--exclude-standard"], rules, options)
  ]);
  return [...new Set(pathGroups.flat())].sort();
}

function pathInsideOrEqual(rootPath = "", candidatePath = "") {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function fileContentSignature(root = "", relativePath = "") {
  const absolutePath = path.resolve(root, normalizeRestartPath(relativePath));
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
    const normalizedPath = normalizeRestartPath(relativePath);
    if (normalizedPath && signature) {
      signatures.set(normalizedPath, signature);
    }
  }
  return signatures;
}

async function contentChangedSinceLaunchDirtyState(root = "", relativePath = "", launchDirtySignatures = new Map()) {
  const launchSignature = launchDirtySignatures.get(normalizeRestartPath(relativePath));
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
          await changedPathsFromGit(root, ["diff", "--name-only", "-z", `${normalizedBaseline.head}..${currentHead}`, "--"], rules, options),
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

function launchIsReady(metadata = {}) {
  return metadata.launchReady === true || metadata.launchReady === "true";
}

function openTargetFromMetadata(metadata = {}) {
  const href = String(metadata[LAUNCH_METADATA.href] || "").trim();
  if (!href) {
    return null;
  }
  return normalizeOpenTarget({
    href,
    kind: metadata[LAUNCH_METADATA.kind],
    label: metadata[LAUNCH_METADATA.openLabel]
  });
}

function launchTargetFromMetadata(metadata = {}) {
  const id = String(metadata[LAUNCH_METADATA.id] || "").trim();
  if (!id) {
    return null;
  }
  return {
    id,
    agentHref: String(metadata[LAUNCH_METADATA.agentHref] || "").trim(),
    label: String(metadata[LAUNCH_METADATA.label] || id).trim() || id,
    launchInput: parseLaunchInputMetadata(metadata[LAUNCH_METADATA.input]),
    openTarget: openTargetFromMetadata(metadata),
    startedAt: String(metadata[LAUNCH_METADATA.startedAt] || "").trim()
  };
}

function sessionWithoutLaunchMetadata(session = {}) {
  const metadata = session.metadata && typeof session.metadata === "object" && !Array.isArray(session.metadata)
    ? session.metadata
    : {};
  return {
    ...session,
    metadata: Object.fromEntries(Object.entries(metadata).filter(([name]) => !LAUNCH_METADATA_NAMES.includes(name)))
  };
}

async function clearLaunchMetadata(store, sessionId = "") {
  const normalizedSessionId = String(sessionId || "").trim();
  if (!normalizedSessionId || !store) {
    return false;
  }
  if (typeof store.mutateSession === "function" && typeof store.deleteMetadataValue === "function") {
    await store.mutateSession(normalizedSessionId, async () => {
      await Promise.all(LAUNCH_METADATA_NAMES.map((name) => store.deleteMetadataValue(normalizedSessionId, name)));
    });
    return true;
  }
  if (typeof store.deleteMetadataValues === "function") {
    await store.deleteMetadataValues(normalizedSessionId, LAUNCH_METADATA_NAMES);
    return true;
  }
  return false;
}

async function clearLaunchMetadataForTerminal(store, sessionId = "", terminalSessionId = "") {
  const normalizedTerminalSessionId = String(terminalSessionId || "").trim();
  if (
    !normalizedTerminalSessionId ||
    !store ||
    typeof store.readMetadataValue !== "function"
  ) {
    return false;
  }
  const currentTerminalId = String(
    await store.readMetadataValue(sessionId, LAUNCH_METADATA.terminalId) || ""
  ).trim();
  if (currentTerminalId !== normalizedTerminalSessionId) {
    return false;
  }
  return clearLaunchMetadata(store, sessionId);
}

async function writeLaunchMetadata(store, sessionId, terminalSession = {}) {
  const metadata = terminalSession.metadata || {};
  const openTarget = normalizeOpenTarget(metadata.openTarget || {});
  if (!metadata.launchTargetId || !openTarget.href) {
    return;
  }
  const agentHref = String(
    metadata.agentTargetHref ||
    metadata.previewProxyTargetHref ||
    metadata.targetUrl ||
    openTarget.href
  ).trim();
  await store.mutateSession(sessionId, async () => {
    await Promise.all([
      store.writeMetadataValue(sessionId, LAUNCH_METADATA.agentHref, agentHref),
      store.writeMetadataValue(sessionId, LAUNCH_METADATA.id, metadata.launchTargetId),
      store.writeMetadataValue(sessionId, LAUNCH_METADATA.input, serializeLaunchInputMetadata(metadata.launchInput)),
      store.writeMetadataValue(sessionId, LAUNCH_METADATA.label, metadata.launchTargetLabel || metadata.launchTargetId),
      store.writeMetadataValue(sessionId, LAUNCH_METADATA.kind, openTarget.kind),
      store.writeMetadataValue(sessionId, LAUNCH_METADATA.openLabel, openTarget.label),
      store.writeMetadataValue(sessionId, LAUNCH_METADATA.href, openTarget.href),
      store.writeMetadataValue(sessionId, LAUNCH_METADATA.previewAuth, metadata.previewAuth || ""),
      store.writeMetadataValue(
        sessionId,
        LAUNCH_METADATA.restartBaseline,
        serializeLaunchRestartBaseline(metadata.launchRestartBaseline)
      ),
      store.writeMetadataValue(sessionId, LAUNCH_METADATA.sessionRoot, metadata.sessionRoot || ""),
      store.writeMetadataValue(sessionId, LAUNCH_METADATA.startedAt, new Date().toISOString()),
      store.writeMetadataValue(sessionId, LAUNCH_METADATA.terminalId, terminalSession.id || "")
    ]);
  });
}

async function createLaunchContext(projectService, sessionId) {
  const runtime = await projectService.createRuntime();
  const session = await runtime.getSession(sessionId);
  return {
    config: runtime.projectConfig,
    projectsRoot: projectService?.selectedProject?.projectsRoot || "",
    runtime,
    session,
    store: runtime.store,
    targetRoot: sessionTerminalCwd(session, projectService)
  };
}

async function listLaunchTargets(context) {
  const targets = await context.runtime.adapter.listLaunchTargets(context);
  return Array.isArray(targets) ? targets : [];
}

function findLaunchTarget(targets = [], launchTargetId = "") {
  const normalizedLaunchTargetId = normalizeLaunchTargetId(launchTargetId);
  return targets.find((target) => target.id === normalizedLaunchTargetId) || null;
}

function normalizePreviewRecovery(recovery = null) {
  return recovery && typeof recovery === "object" && !Array.isArray(recovery) ? recovery : null;
}

function launchTargetFromTerminalMetadata(terminal = {}) {
  const metadata = terminal.metadata && typeof terminal.metadata === "object" && !Array.isArray(terminal.metadata)
    ? terminal.metadata
    : {};
  const id = String(metadata.launchTargetId || "").trim();
  if (!id) {
    return null;
  }
  const openTarget = normalizeOpenTarget(metadata.openTarget || {});
  return {
    id,
    agentHref: String(metadata.agentTargetHref || metadata.previewProxyTargetHref || metadata.targetUrl || openTarget.href || "").trim(),
    label: String(metadata.launchTargetLabel || id).trim() || id,
    launchInput: normalizeLaunchInput(metadata.launchInput),
    openTarget: openTarget.href ? openTarget : null,
    startedAt: String(terminal.createdAt || "").trim()
  };
}

function launchTargetForPreviewStatus({
  session = {},
  terminal = null
} = {}) {
  const terminalLaunchTarget = terminal ? launchTargetFromTerminalMetadata(terminal) : null;
  const sessionLaunchTarget = launchTargetFromMetadata(session.metadata || {});
  if (terminalLaunchTarget && !terminalLaunchTarget.openTarget && sessionLaunchTarget?.openTarget) {
    return {
      ...terminalLaunchTarget,
      agentHref: terminalLaunchTarget.agentHref || sessionLaunchTarget.agentHref,
      openTarget: sessionLaunchTarget.openTarget,
      startedAt: terminalLaunchTarget.startedAt || sessionLaunchTarget.startedAt
    };
  }
  return terminalLaunchTarget || sessionLaunchTarget;
}

function openTargetForPreviewStatus({
  lastLaunchTarget = null,
  terminal = null
} = {}) {
  if (lastLaunchTarget?.openTarget?.href) {
    return lastLaunchTarget.openTarget;
  }
  const terminalOpenTarget = launchTargetFromTerminalMetadata(terminal)?.openTarget || null;
  return terminalOpenTarget?.href ? terminalOpenTarget : null;
}

function launchTargetCanStart(launchTargets = []) {
  return Array.isArray(launchTargets) && launchTargets.some((target) => target?.available !== false);
}

function normalizeLaunchPreview({
  canRestart = false,
  canShowLog = false,
  canStart = false,
  href = "",
  message = "",
  reason = "",
  recovery = null,
  state = "idle",
  targetHref = "",
  terminalId = ""
} = {}) {
  const normalizedState = [
    "idle",
    "starting",
    "ready",
    "stale",
    "stopped",
    "failed",
    "project_closed"
  ].includes(state) ? state : "idle";
  const fallbackMessage = normalizedState === "idle"
    ? "Run a launch target first."
    : normalizedState === "ready"
      ? "Preview is ready."
      : normalizedState === "stale"
        ? "Server-side app files changed after this preview started."
        : normalizedState === "starting"
          ? "Preparing preview."
          : normalizedState === "project_closed"
            ? "Project is closed."
            : "Preview could not be opened.";
  return {
    canRestart: Boolean(canRestart),
    canShowLog: Boolean(canShowLog),
    canStart: Boolean(canStart),
    href: String(href || "").trim(),
    message: String(message || fallbackMessage).trim() || fallbackMessage,
    reason: String(reason || "").trim(),
    recovery: normalizePreviewRecovery(recovery),
    state: normalizedState,
    targetHref: String(targetHref || "").trim(),
    terminalId: String(terminalId || "").trim()
  };
}

function previewTargetFromLaunchPreview(preview = {}) {
  const normalizedPreview = normalizeLaunchPreview(preview);
  const recovery = normalizePreviewRecovery(normalizedPreview.recovery);
  const available = ["ready", "stale"].includes(normalizedPreview.state) && Boolean(normalizedPreview.href);
  return {
    available,
    disabledReason: available ? "" : normalizedPreview.message,
    href: available ? normalizedPreview.href : "",
    kind: "url",
    label: "Preview",
    ...(recovery ? { recovery } : {}),
    ...(normalizedPreview.state === "stale" ? { stale: true } : {}),
    targetHref: normalizedPreview.targetHref
  };
}

function openTargetFromLaunchPreview(preview = {}, openTarget = null) {
  const normalizedPreview = normalizeLaunchPreview(preview);
  if (normalizedPreview.state === "project_closed") {
    return {
      available: false,
      disabledReason: "Project is closed.",
      href: "",
      kind: "url",
      label: "Open browser"
    };
  }
  if (!openTarget?.href) {
    return {
      available: false,
      disabledReason: "Run a launch target first.",
      href: "",
      kind: "url",
      label: "Open browser"
    };
  }
  return {
    ...normalizeOpenTarget(openTarget),
    available: true,
    disabledReason: "",
    previewHref: ["ready", "stale"].includes(normalizedPreview.state) ? normalizedPreview.href : ""
  };
}

function launchStatusResponseFromPreviewStatus({
  launchTargets = [],
  previewStatus = {}
} = {}) {
  const preview = normalizeLaunchPreview(previewStatus.preview || {});
  const previewTarget = previewTargetFromLaunchPreview(preview);
  const normalizedPreviewTarget = previewTarget.available !== false ? previewTarget : null;
  return {
    ok: true,
    activeTerminal: previewStatus.activeTerminal ? launchTerminalStatus(previewStatus.activeTerminal, {
      previewTarget: normalizedPreviewTarget
    }) : null,
    launchTargets,
    preview,
    previewTarget,
    lastLaunchTarget: previewStatus.lastLaunchTarget || null,
    openTarget: openTargetFromLaunchPreview(preview, previewStatus.openTarget || null)
  };
}

function launchTerminalIsRunning(terminal = {}) {
  return terminal.status === "running" || terminal.status === "closing";
}

function launchTerminalStatus(terminal = {}, {
  previewTarget = null
} = {}) {
  const metadata = terminal.metadata && typeof terminal.metadata === "object" && !Array.isArray(terminal.metadata)
    ? terminal.metadata
    : {};
  const actions = launchActionsWithPreviewTarget(metadata.actions, previewTarget);
  return {
    closeError: String(terminal.closeError || ""),
    commandPreview: String(terminal.commandPreview || ""),
    createdAt: String(terminal.createdAt || ""),
    exitCode: terminal.exitCode ?? null,
    id: String(terminal.id || ""),
    metadata: {
      ...metadata,
      actions
    },
    output: String(terminal.output || ""),
    running: launchTerminalIsRunning(terminal),
    status: String(terminal.status || "")
  };
}

function previewAuthForLaunchTerminal(terminal = {}, {
  sessionId = "",
  targetHref = ""
} = {}) {
  const metadata = terminal.metadata && typeof terminal.metadata === "object" && !Array.isArray(terminal.metadata)
    ? terminal.metadata
    : {};
  const kind = normalizePreviewAuthKind(metadata.previewAuth);
  if (!kind) {
    return null;
  }
  return {
    kind,
    profilePath: previewAuthProfilePath({
      sessionRoot: metadata.sessionRoot,
      targetRoot: metadata.targetRoot || metadata.runRoot || "",
      sessionId,
      terminalSessionId: terminal.id
    }),
    sessionId,
    sessionRoot: String(metadata.sessionRoot || ""),
    targetHref,
    targetRoot: String(metadata.targetRoot || metadata.runRoot || ""),
    terminalSessionId: String(terminal.id || "")
  };
}

function launchActionsWithPreviewTarget(actions = [], previewTarget = null) {
  const entries = Array.isArray(actions) ? actions : [];
  if (!previewTarget?.href || !previewTarget.targetHref) {
    return entries;
  }
  return entries.map((action) => {
    if (String(action?.href || "") !== previewTarget.targetHref) {
      return action;
    }
    return {
      ...action,
      previewHref: previewTarget.href
    };
  });
}

function recoveredLaunchTerminalFromContainer({
  container = {},
  session = {},
  sessionId = "",
  targetRoot = ""
} = {}) {
  const terminalId = String(container.terminalId || "").trim();
  const lastLaunchTarget = launchTargetFromMetadata(session.metadata || {});
  const openTarget = lastLaunchTarget?.openTarget || null;
  const launchRestartBaseline = parseLaunchRestartBaseline(session.metadata?.[LAUNCH_METADATA.restartBaseline]);
  if (!terminalId || !lastLaunchTarget?.id || !openTarget?.href) {
    return null;
  }
  return {
    closeError: "",
    commandPreview: "",
    createdAt: lastLaunchTarget.startedAt || "",
    exitCode: null,
    id: terminalId,
    metadata: {
      actions: [
        openTarget
      ],
      launchContainer: {
        id: String(container.id || ""),
        name: String(container.name || ""),
        status: String(container.status || "")
      },
      launchReady: true,
      launchTargetId: lastLaunchTarget.id,
      launchTargetLabel: lastLaunchTarget.label || lastLaunchTarget.id,
      launchInput: lastLaunchTarget.launchInput || {},
      openTarget,
      previewAuth: session.metadata?.[LAUNCH_METADATA.previewAuth] || "",
      previewProxyTargetHref: session.metadata?.[LAUNCH_METADATA.agentHref] || openTarget.href,
      reattachedAfterServerRestart: true,
      ...(launchRestartBaseline ? { launchRestartBaseline } : {}),
      sessionId,
      sessionRoot: session.metadata?.[LAUNCH_METADATA.sessionRoot] || session.sessionRoot || "",
      targetRoot,
      targetUrl: openTarget.href
    },
    output: "",
    running: true,
    status: "running"
  };
}

function staleLaunchRecovery({
  canRestart = false,
  canStopStale = false,
  container = {},
  reason = "server_restart_state_lost",
  terminalSessionId = ""
} = {}) {
  return {
    canRestart: Boolean(canRestart),
    canStopStale: Boolean(canStopStale),
    containerId: String(container.id || ""),
    containerName: String(container.name || ""),
    reason,
    terminalSessionId: String(terminalSessionId || container.terminalId || "")
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
  const worktreePath = String(metadata.runRoot || metadata.targetRoot || context.targetRoot || "").trim();
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
    vibe64SessionDebugLog("server.launchTargetTerminal.restartState.error", {
      error: vibe64SessionDebugError(error),
      sessionId: context.session?.sessionId || "",
      targetRoot: context.targetRoot || "",
      terminalSessionId: terminal.id || ""
    }, {
      level: "warn"
    });
    return null;
  }
}

function latestLaunchTerminal(sessionId = "") {
  const terminals = listTerminalSessions({
    namespace: launchTargetTerminalNamespace(sessionId)
  });
  return terminals.sort((left, right) => {
    return String(left.createdAt || "").localeCompare(String(right.createdAt || ""));
  }).at(-1) || null;
}

function firstLaunchOutputLines(output = "") {
  return stripAnsi(String(output || ""))
    .replace(/\r\n/gu, "\n")
    .replace(/\r/gu, "\n")
    .split("\n")
    .slice(0, MAX_LAUNCH_ACTION_SCAN_LINES)
    .map((line) => line.trim())
    .filter(Boolean);
}

function launchActionFromLine(line = "") {
  const match = String(line || "").match(/(?:^|\s)action:(?:url:)?(https?:\/\/\S+)/u);
  if (!match) {
    return null;
  }

  const href = match[1].replace(/[),.;]+$/u, "");
  let label = "Open";
  try {
    const url = new URL(href);
    label = url.host || label;
  } catch {
    return null;
  }

  return {
    href,
    id: `url-${stableHash(href)}`,
    kind: "url",
    label
  };
}

function launchActionsFromOutput(output = "") {
  const actionMap = new Map();
  for (const line of firstLaunchOutputLines(output)) {
    const action = launchActionFromLine(line);
    if (action) {
      actionMap.set(action.id, action);
    }
  }
  return [...actionMap.values()];
}

function launchActionsChanged(currentActions = [], nextActions = []) {
  return JSON.stringify(currentActions || []) !== JSON.stringify(nextActions || []);
}

function launchReadinessMarkerLineSeen(output = "", readinessMarker = "") {
  const marker = String(readinessMarker || "").trim();
  if (!marker) {
    return false;
  }
  return stripAnsi(String(output || ""))
    .replace(/\r\n/gu, "\n")
    .replace(/\r/gu, "\n")
    .split("\n")
    .some((line) => line.trim() === marker);
}

async function closeStoppedLaunchTerminals(sessionId = "") {
  const namespace = launchTargetTerminalNamespace(sessionId);
  await Promise.all(listTerminalSessions({
    namespace
  }).filter((terminal) => !launchTerminalIsRunning(terminal)).map((terminal) => {
    return closeTerminalSession(terminal.id, {
      namespace
    });
  }));
}

function readinessMarkerFromSpec(spec = {}) {
  return String(spec.readinessMarker || spec.metadata?.readinessMarker || "").trim();
}

function releaseLaunchSpecReservation(spec = {}) {
  if (typeof spec.releasePortReservation !== "function") {
    return;
  }
  try {
    spec.releasePortReservation();
  } catch {
    // Reservation release is best-effort cleanup for failed or reused launches.
  }
}

function normalizeLaunchInput(input = {}) {
  return input && typeof input === "object" && !Array.isArray(input) ? input : {};
}

function launchInputFingerprint(input = {}) {
  return stableHash(JSON.stringify(normalizeLaunchInput(input)));
}

function launchTerminalIsReady(terminalSession = {}, readinessMarker = "") {
  if (!readinessMarker) {
    return true;
  }
  return launchIsReady(terminalSession.metadata || {});
}

function delay(milliseconds = 0) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(milliseconds) || 0)));
}

async function launchTerminalSurvivedStabilityDelay({
  delayMs = LAUNCH_READY_STABILITY_DELAY_MS,
  namespace = "",
  sessionId = "",
  terminalSessionId = ""
} = {}) {
  const normalizedTerminalSessionId = String(terminalSessionId || "").trim();
  if (!normalizedTerminalSessionId || !namespace) {
    return false;
  }
  if (Number(delayMs || 0) > 0) {
    await delay(delayMs);
  }
  const terminal = readTerminalSession(normalizedTerminalSessionId, {
    namespace
  });
  if (terminal?.status === "running") {
    return true;
  }
  vibe64SessionDebugLog("server.launchTargetTerminal.readyStability.failed", {
    delayMs: Number(delayMs || 0),
    exitCode: terminal?.exitCode ?? null,
    sessionId,
    status: String(terminal?.status || "missing"),
    terminalSessionId: normalizedTerminalSessionId
  }, {
    level: "warn"
  });
  return false;
}

function probeLaunchTargetHref(href = "", {
  timeoutMs = LAUNCH_READY_PROBE_TIMEOUT_MS
} = {}) {
  return new Promise((resolve) => {
    let targetUrl;
    try {
      targetUrl = new URL(String(href || "").trim());
    } catch {
      resolve(false);
      return;
    }
    const requestFactory = targetUrl.protocol === "https:"
      ? httpsRequest
      : targetUrl.protocol === "http:"
        ? httpRequest
        : null;
    if (!requestFactory) {
      resolve(false);
      return;
    }
    let settled = false;
    const finish = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(Boolean(value));
    };
    const request = requestFactory(targetUrl, {
      method: "GET",
      timeout: Math.max(250, Number(timeoutMs) || LAUNCH_READY_PROBE_TIMEOUT_MS)
    }, (response) => {
      response.resume();
      finish(Number(response.statusCode || 0) < 500);
    });
    request.on("timeout", () => {
      request.destroy();
      finish(false);
    });
    request.on("error", () => finish(false));
    request.end();
  });
}

async function previewProxyTargetHrefForTerminal(terminal = {}, {
  targetHref = ""
} = {}) {
  if (!await currentProcessIsDockerContainer()) {
    return targetHref;
  }
  const metadata = terminal.metadata && typeof terminal.metadata === "object" && !Array.isArray(terminal.metadata)
    ? terminal.metadata
    : {};
  return String(metadata.previewProxyTargetHref || targetHref || "").trim();
}

function launchTerminalCanBeReused(runningSession = {}, {
  launchEnvHash = "",
  launchInputHash = "",
  launchTargetId = "",
  spec = {}
} = {}) {
  return spec.reuseRunning !== false &&
    runningSession.metadata?.envHash === launchEnvHash &&
    runningSession.metadata?.launchInputHash === launchInputHash &&
    runningSession.metadata?.launchTargetId === launchTargetId;
}

function reusableLaunchTerminal(sessionId = "", {
  launchEnvHash = "",
  launchInputHash = "",
  launchTargetId = "",
  namespace = launchTargetTerminalNamespace(sessionId),
  spec = {}
} = {}) {
  return listTerminalSessions({
    namespace,
    runningOnly: true
  }).find((terminal) => launchTerminalCanBeReused(terminal, {
    launchEnvHash,
    launchInputHash,
    launchTargetId,
    spec
  })) || null;
}

async function cleanupSupersededLaunchTerminals({
  launchPreviewProxies = null,
  namespace = "",
  removeLaunchTargetContainersImpl = removeLaunchTargetContainers,
  reusableTerminal = null,
  sessionId = "",
  targetRoot = ""
} = {}) {
  const preservedTerminalIds = reusableTerminal?.id ? [String(reusableTerminal.id)] : [];
  const preservedTerminalIdSet = new Set(preservedTerminalIds);
  let closed = 0;
  for (const terminal of listTerminalSessions({ namespace })) {
    if (!terminal.id || preservedTerminalIdSet.has(terminal.id)) {
      continue;
    }
    const result = await closeTerminalSession(terminal.id, {
      namespace
    });
    if (result.closed) {
      closed += 1;
    }
  }
  const removedContainers = await removeLaunchTargetContainersImpl({
    exceptTerminalIds: preservedTerminalIds,
    sessionId,
    targetRoot
  });
  if (!preservedTerminalIds.length) {
    await launchPreviewProxies?.close?.({
      sessionId
    });
  }
  return {
    closed,
    removedContainers
  };
}

async function ensureLaunchTargetRuntime({
  context = {}
} = {}) {
  await ensureTargetRuntimeNetwork(context.targetRoot);
  await ensureCurrentContainerConnectedToRuntimeNetwork(context.targetRoot);
  await ensureAdapterRuntimeContainers({
    runtime: context.runtime,
    session: context.session,
    target: "launch-target",
    targetRoot: context.targetRoot
  });
}

async function markLaunchTerminalReady({
  delayMs = LAUNCH_READY_STABILITY_DELAY_MS,
  namespace = "",
  publishSessionChanged = async () => null,
  store,
  sessionId = "",
  terminalSession = {},
  updateMetadata = () => null
} = {}) {
  if (!await launchTerminalSurvivedStabilityDelay({
    delayMs,
    namespace,
    sessionId,
    terminalSessionId: terminalSession.id
  })) {
    return false;
  }
  const readyMetadata = {
    launchReady: true,
    launchReadyAt: new Date().toISOString()
  };
  const updatedSession = updateMetadata(readyMetadata);
  await writeLaunchMetadata(store, sessionId, {
    ...terminalSession,
    metadata: {
      ...(terminalSession.metadata || {}),
      ...readyMetadata,
      ...(updatedSession?.metadata || {})
    }
  });
  await publishSessionChanged(sessionId, {
    reason: "launch-target-ready"
  });
  return true;
}

async function repairLaunchReadinessFromProbe({
  context = {},
  probeLaunchTargetImpl = probeLaunchTargetHref,
  publishSessionChanged = async () => null,
  sessionId = "",
  targetHref = "",
  terminal = null
} = {}) {
  const terminalSessionId = String(terminal?.id || "").trim();
  const normalizedTargetHref = String(targetHref || "").trim();
  if (
    !terminalSessionId ||
    !normalizedTargetHref ||
    !launchTerminalIsRunning(terminal) ||
    launchIsReady(terminal?.metadata || {})
  ) {
    return null;
  }
  const startedAtMs = Date.now();
  const probeHref = await previewProxyTargetHrefForTerminal(terminal, {
    targetHref: normalizedTargetHref
  });
  let ready = false;
  try {
    ready = await probeLaunchTargetImpl(probeHref, {
      context,
      sessionId,
      targetHref: normalizedTargetHref,
      terminal,
      timeoutMs: LAUNCH_READY_PROBE_TIMEOUT_MS
    });
  } catch (error) {
    vibe64SessionDebugLog("server.launchTargetTerminal.readinessProbe.error", {
      durationMs: vibe64SessionDebugDurationMs(startedAtMs),
      error: vibe64SessionDebugError(error),
      probeHref,
      sessionId,
      targetHref: normalizedTargetHref,
      terminalSessionId
    }, {
      level: "warn"
    });
    return null;
  }
  if (!ready) {
    return null;
  }
  const readyMetadata = {
    launchReady: true,
    launchReadyAt: new Date().toISOString(),
    launchReadySource: "target-probe"
  };
  const updatedTerminal = updateTerminalSessionMetadata(terminalSessionId, readyMetadata, {
    namespace: launchTargetTerminalNamespace(sessionId)
  });
  const repairedTerminal = updatedTerminal?.ok === false
    ? {
        ...terminal,
        metadata: {
          ...(terminal.metadata || {}),
          ...readyMetadata
        }
      }
    : updatedTerminal;
  try {
    await writeLaunchMetadata(context.store, sessionId, repairedTerminal);
  } catch (error) {
    vibe64SessionDebugLog("server.launchTargetTerminal.readinessProbe.metadata.error", {
      durationMs: vibe64SessionDebugDurationMs(startedAtMs),
      error: vibe64SessionDebugError(error),
      probeHref,
      sessionId,
      targetHref: normalizedTargetHref,
      terminalSessionId
    }, {
      level: "warn"
    });
  }
  await publishSessionChanged(sessionId, {
    reason: "launch-target-ready"
  });
  vibe64SessionDebugLog("server.launchTargetTerminal.readinessProbe.ready", {
    durationMs: vibe64SessionDebugDurationMs(startedAtMs),
    probeHref,
    sessionId,
    targetHref: normalizedTargetHref,
    terminalSessionId
  });
  return repairedTerminal;
}

async function readyLaunchPreview({
  activeTerminal = null,
  canShowLog = false,
  context = {},
  launchPreviewProxies = null,
  launchTargets = [],
  lastLaunchTarget = null,
  openTarget = null,
  options = {},
  sessionId = "",
  terminal = null
} = {}) {
  const targetHref = String(openTarget?.href || "").trim();
  const terminalSessionId = String(terminal?.id || "").trim();
  if (!targetHref) {
    return {
      activeTerminal,
      lastLaunchTarget,
      openTarget,
      preview: normalizeLaunchPreview({
        canRestart: Boolean(lastLaunchTarget?.id),
        canShowLog,
        canStart: launchTargetCanStart(launchTargets),
        message: "Launch target URL is missing.",
        reason: "missing_target_href",
        state: "failed",
        terminalId: terminalSessionId
      })
    };
  }
  try {
    const proxyTargetHref = await previewProxyTargetHrefForTerminal(terminal, {
      targetHref
    });
    const previewTarget = await launchPreviewProxies.ensure({
      previewPublicOrigin: previewPublicOriginForLaunch({
        publicHost: options.publicHost,
        publicProtocol: options.publicProtocol,
        sessionId,
        targetHref,
        terminalSessionId
      }),
      previewAuth: previewAuthForLaunchTerminal(terminal, {
        sessionId,
        targetHref
      }),
      sessionId,
      targetHref,
      terminalSessionId
    }, proxyTargetHref);
    const restartRecovery = await launchRestartRecoveryForTerminal({
      context,
      terminal
    });
    const stale = Boolean(restartRecovery);
    return {
      activeTerminal,
      lastLaunchTarget,
      openTarget,
      preview: normalizeLaunchPreview({
        canRestart: Boolean(lastLaunchTarget?.id || terminal?.metadata?.launchTargetId),
        canShowLog,
        canStart: false,
        href: previewTarget.href,
        message: stale
          ? "Server-side app files changed after this preview started."
          : "Preview is ready.",
        reason: stale ? (restartRecovery.reason || LAUNCH_RESTART_REASON_SOURCE_CHANGED) : "",
        recovery: restartRecovery,
        state: stale ? "stale" : "ready",
        targetHref,
        terminalId: terminalSessionId
      })
    };
  } catch (error) {
    return {
      activeTerminal,
      lastLaunchTarget,
      openTarget,
      preview: normalizeLaunchPreview({
        canRestart: Boolean(lastLaunchTarget?.id || terminal?.metadata?.launchTargetId),
        canShowLog,
        canStart: launchTargetCanStart(launchTargets),
        message: String(error?.message || error || "Launch preview proxy could not start."),
        reason: "preview_proxy_unavailable",
        state: "failed",
        targetHref,
        terminalId: terminalSessionId
      })
    };
  }
}

function stoppedLaunchPreviewStatus({
  activeTerminal = null,
  launchTargets = [],
  lastLaunchTarget = null,
  openTarget = null
} = {}) {
  const exitCode = activeTerminal?.exitCode ?? null;
  const failed = exitCode !== 0;
  const targetHref = String(openTarget?.href || "").trim();
  return {
    activeTerminal,
    lastLaunchTarget,
    openTarget,
    preview: normalizeLaunchPreview({
      canRestart: Boolean(lastLaunchTarget?.id || activeTerminal?.metadata?.launchTargetId),
      canShowLog: Boolean(activeTerminal?.id),
      canStart: launchTargetCanStart(launchTargets),
      message: failed
        ? `The preview process exited with code ${exitCode ?? "unknown"}.`
        : "The preview process exited.",
      reason: failed ? "process_exited_nonzero" : "process_exited",
      state: failed ? "failed" : "stopped",
      targetHref,
      terminalId: activeTerminal?.id || ""
    })
  };
}

async function liveContainerLaunchPreviewStatus({
  container = {},
  context = {},
  launchPreviewProxies = null,
  launchTargets = [],
  openTarget = null,
  options = {},
  sessionId = ""
} = {}) {
  const lastLaunchTarget = launchTargetFromMetadata(context.session?.metadata || {});
  const recoveredTerminal = recoveredLaunchTerminalFromContainer({
    container,
    session: context.session,
    sessionId,
    targetRoot: context.targetRoot
  });
  if (!recoveredTerminal) {
    const recovery = staleLaunchRecovery({
      canRestart: Boolean(lastLaunchTarget?.id),
      canStopStale: Boolean(container.id),
      container,
      terminalSessionId: container.terminalId
    });
    return {
      activeTerminal: null,
      lastLaunchTarget,
      openTarget,
      preview: normalizeLaunchPreview({
        canRestart: recovery.canRestart,
        canShowLog: false,
        canStart: launchTargetCanStart(launchTargets),
        message: "Preview state was lost after a server restart. Restart preview to recover.",
        reason: recovery.reason,
        recovery,
        state: "failed",
        targetHref: String(openTarget?.href || lastLaunchTarget?.openTarget?.href || "").trim(),
        terminalId: recovery.terminalSessionId
      })
    };
  }
  vibe64SessionDebugLog("server.launchTargetTerminal.restartReconcile.previewRecovered", {
    containerId: String(container.id || ""),
    sessionId,
    targetRoot: context.targetRoot,
    terminalSessionId: recoveredTerminal.id
  });
  return readyLaunchPreview({
    activeTerminal: null,
    canShowLog: false,
    context,
    launchPreviewProxies,
    launchTargets,
    lastLaunchTarget,
    openTarget: openTarget || recoveredTerminal.metadata?.openTarget || null,
    options,
    sessionId,
    terminal: recoveredTerminal
  });
}

async function missingContainerLaunchPreviewStatus({
  context = {},
  launchTargets = [],
  openTarget = null,
  publishSessionChanged = async () => null,
  sessionId = ""
} = {}) {
  const lastLaunchTarget = launchTargetFromMetadata(context.session?.metadata || {});
  const recovery = staleLaunchRecovery({
    canRestart: Boolean(lastLaunchTarget?.id),
    canStopStale: false
  });
  let metadataCleared = false;
  try {
    metadataCleared = await clearLaunchMetadata(context.store, sessionId);
  } catch (error) {
    vibe64SessionDebugLog("server.launchTargetTerminal.restartReconcile.clearMetadata.error", {
      error: vibe64SessionDebugError(error),
      sessionId,
      targetRoot: context.targetRoot
    }, {
      level: "warn"
    });
  }
  if (metadataCleared) {
    await publishSessionChanged(sessionId, {
      reason: "launch-target-stale-cleared"
    });
  }
  vibe64SessionDebugLog("server.launchTargetTerminal.restartReconcile.missingContainer", {
    canRestart: recovery.canRestart,
    launchTargetId: lastLaunchTarget?.id || "",
    metadataCleared,
    reason: recovery.reason,
    sessionId,
    targetHref: String(openTarget?.href || lastLaunchTarget?.openTarget?.href || "").trim(),
    targetRoot: context.targetRoot
  }, {
    level: "warn"
  });
  return {
    activeTerminal: null,
    lastLaunchTarget: null,
    openTarget: null,
    preview: normalizeLaunchPreview({
      canRestart: recovery.canRestart,
      canShowLog: false,
      canStart: launchTargetCanStart(launchTargets),
      message: "Preview state was lost after a server restart. Restart preview to recover.",
      reason: recovery.reason,
      recovery,
      state: "failed",
      targetHref: String(openTarget?.href || lastLaunchTarget?.openTarget?.href || "").trim(),
      terminalId: ""
    }),
    session: sessionWithoutLaunchMetadata(context.session)
  };
}

async function resolveLaunchPreviewStatus({
  context = {},
  launchPreviewProxies = null,
  launchTargets = [],
  listRunningLaunchTargetContainersImpl = listRunningLaunchTargetContainers,
  options = {},
  probeLaunchTargetImpl = probeLaunchTargetHref,
  publishSessionChanged = async () => null,
  sessionId = ""
} = {}) {
  const activeTerminal = latestLaunchTerminal(sessionId);
  const initialLastLaunchTarget = launchTargetForPreviewStatus({
    session: context.session,
    terminal: activeTerminal
  });
  const initialOpenTarget = openTargetForPreviewStatus({
    lastLaunchTarget: initialLastLaunchTarget,
    terminal: activeTerminal
  });
  if (activeTerminal && launchTerminalIsRunning(activeTerminal)) {
    let terminalForPreview = activeTerminal;
    const targetHref = String(initialOpenTarget?.href || "").trim();
    if (!launchIsReady(activeTerminal.metadata || {}) && targetHref) {
      terminalForPreview = await repairLaunchReadinessFromProbe({
        context,
        probeLaunchTargetImpl,
        publishSessionChanged,
        sessionId,
        targetHref,
        terminal: activeTerminal
      }) || activeTerminal;
    }
    if (!launchIsReady(terminalForPreview.metadata || {})) {
      return {
        activeTerminal: terminalForPreview,
        lastLaunchTarget: initialLastLaunchTarget,
        openTarget: initialOpenTarget,
        preview: normalizeLaunchPreview({
          canRestart: false,
          canShowLog: Boolean(terminalForPreview.id),
          canStart: false,
          message: "Preparing preview.",
          reason: "launch_starting",
          state: "starting",
          targetHref,
          terminalId: terminalForPreview.id
        })
      };
    }
    return readyLaunchPreview({
      activeTerminal: terminalForPreview,
      canShowLog: true,
      context,
      launchPreviewProxies,
      launchTargets,
      lastLaunchTarget: launchTargetForPreviewStatus({
        session: context.session,
        terminal: terminalForPreview
      }),
      openTarget: openTargetForPreviewStatus({
        lastLaunchTarget: launchTargetForPreviewStatus({
          session: context.session,
          terminal: terminalForPreview
        }),
        terminal: terminalForPreview
      }),
      options,
      sessionId,
      terminal: terminalForPreview
    });
  }
  if (activeTerminal?.status === "exited") {
    return stoppedLaunchPreviewStatus({
      activeTerminal,
      launchTargets,
      lastLaunchTarget: initialLastLaunchTarget,
      openTarget: initialOpenTarget
    });
  }

  const startedAtMs = Date.now();
  let containers = [];
  try {
    containers = await listRunningLaunchTargetContainersImpl({
      sessionId,
      targetRoot: context.targetRoot
    });
  } catch (error) {
    vibe64SessionDebugLog("server.launchTargetTerminal.restartReconcile.error", {
      durationMs: vibe64SessionDebugDurationMs(startedAtMs),
      error: vibe64SessionDebugError(error),
      sessionId,
      targetRoot: context.targetRoot
    }, {
      level: "warn"
    });
    containers = [];
  }

  if (containers.length > 0) {
    const container = containers.find((item) => item.terminalId) || containers[0];
    vibe64SessionDebugLog("server.launchTargetTerminal.restartReconcile.containerFound", {
      containerId: String(container.id || ""),
      containerName: String(container.name || ""),
      containerStatus: String(container.status || ""),
      durationMs: vibe64SessionDebugDurationMs(startedAtMs),
      sessionId,
      targetRoot: context.targetRoot,
      terminalSessionId: String(container.terminalId || "")
    });
    return liveContainerLaunchPreviewStatus({
      container,
      context,
      launchPreviewProxies,
      launchTargets,
      openTarget: initialOpenTarget,
      options,
      sessionId
    });
  }

  if (initialLastLaunchTarget?.id) {
    return missingContainerLaunchPreviewStatus({
      context,
      launchTargets,
      openTarget: initialOpenTarget,
      publishSessionChanged,
      sessionId
    });
  }

  return {
    activeTerminal: null,
    lastLaunchTarget: null,
    openTarget: null,
    preview: normalizeLaunchPreview({
      canRestart: false,
      canShowLog: false,
      canStart: launchTargetCanStart(launchTargets),
      message: "Run a launch target first.",
      state: "idle"
    })
  };
}

function createLaunchTargetTerminalController({
  ensureLaunchTargetRuntimeImpl = ensureLaunchTargetRuntime,
  launchReadyStabilityDelayMs = LAUNCH_READY_STABILITY_DELAY_MS,
  listRunningLaunchTargetContainersImpl = listRunningLaunchTargetContainers,
  probeLaunchTargetImpl = probeLaunchTargetHref,
  projectService,
  publishSessionChanged = async () => null,
  removeLaunchTargetContainersImpl = removeLaunchTargetContainers
} = {}) {
  const launchPreviewProxies = createLaunchPreviewProxyRegistry();
  const launchStartLocks = new Map();

  async function withLaunchStartLock(sessionId = "", operation = async () => null) {
    const key = String(sessionId || "global");
    const previous = launchStartLocks.get(key) || Promise.resolve();
    const run = previous.catch(() => null).then(operation);
    const tracked = run.catch(() => null).finally(() => {
      if (launchStartLocks.get(key) === tracked) {
        launchStartLocks.delete(key);
      }
    });
    launchStartLocks.set(key, tracked);
    return run;
  }

  return Object.freeze({
    async closeAllForSession(sessionId) {
      await launchPreviewProxies.close({
        sessionId
      });
      let removedContainers = [];
      try {
        const context = await createLaunchContext(projectService, sessionId);
        removedContainers = await removeLaunchTargetContainersImpl({
          sessionId,
          targetRoot: context.targetRoot
        });
      } catch (error) {
        vibe64SessionDebugLog("server.launchTargetTerminal.closeAllForSession.removeContainers.error", {
          error: vibe64SessionDebugError(error),
          sessionId
        }, {
          level: "warn"
        });
      }
      const result = await closeTerminalSessionsForNamespace(launchTargetTerminalNamespace(sessionId));
      return {
        ...result,
        removedContainers
      };
    },

    async closeTerminal(sessionId, terminalSessionId) {
      await launchPreviewProxies.close({
        sessionId,
        terminalSessionId
      });
      return closeTerminalSession(terminalSessionId, {
        namespace: launchTargetTerminalNamespace(sessionId)
      });
    },

    async launchStatus(sessionId, options = {}) {
      return vibe64Result(async () => {
        const context = await createLaunchContext(projectService, sessionId);
        const launchTargets = await listLaunchTargets(context);
        const previewStatus = await resolveLaunchPreviewStatus({
          context,
          launchPreviewProxies,
          launchTargets,
          listRunningLaunchTargetContainersImpl,
          options,
          probeLaunchTargetImpl,
          publishSessionChanged,
          sessionId
        });
        return launchStatusResponseFromPreviewStatus({
          launchTargets,
          previewStatus
        });
      });
    },

    async openLaunchTarget(sessionId) {
      return vibe64Result(async () => {
        const context = await createLaunchContext(projectService, sessionId);
        const launchTargets = await listLaunchTargets(context);
        const previewStatus = await resolveLaunchPreviewStatus({
          context,
          launchPreviewProxies,
          launchTargets,
          listRunningLaunchTargetContainersImpl,
          probeLaunchTargetImpl,
          publishSessionChanged,
          sessionId,
        });
        const status = launchStatusResponseFromPreviewStatus({
          launchTargets,
          previewStatus
        });
        if (!status.openTarget.available) {
          return {
            ok: false,
            error: status.openTarget.disabledReason
          };
        }
        return {
          ok: true,
          target: status.openTarget
        };
      });
    },

    readTerminal(sessionId, terminalSessionId) {
      return readTerminalSession(terminalSessionId, {
        namespace: launchTargetTerminalNamespace(sessionId)
      });
    },

    async startTerminal(sessionId, input = {}) {
      return vibe64Result(async () => withLaunchStartLock(sessionId, async () => {
        const context = await createLaunchContext(projectService, sessionId);
        const cwd = sessionTerminalCwd(context.session, projectService);
        const forceRestart = input.forceRestart === true;
        const launchInput = normalizeLaunchInput(input.launchInput);
        const launchInputHash = launchInputFingerprint(launchInput);
        if (!cwd) {
          return {
            ok: false,
            error: "Vibe64 launch target root is not available."
          };
        }

        const launchTargets = await listLaunchTargets(context);
        const launchTarget = findLaunchTarget(launchTargets, input.launchTargetId);
        if (!launchTarget) {
          return {
            ok: false,
            error: "Launch target is not available."
          };
        }
        if (launchTarget.available === false) {
          return {
            ok: false,
            error: launchTarget.disabledReason || "Launch target is disabled."
          };
        }

        const spec = await context.runtime.adapter.createLaunchTargetTerminalSpec({
          context: {
            ...context,
            launchInput,
            launchTarget,
            vibe64User: input.vibe64User || null
          },
          launchInput,
          launchTargetId: launchTarget.id
        });
        if (spec?.ok === false) {
          return {
            ok: false,
            error: spec.message || "Launch target terminal cannot start."
          };
        }

        const namespace = launchTargetTerminalNamespace(sessionId);
        let terminalSession;
        let readinessMarker = "";
        try {
          await ensureLaunchTargetRuntimeImpl({
            context
          });
          const terminalEnv = await projectTerminalEnvironment({
            projectService,
            runtime: context.runtime,
            session: context.session,
            target: "launch-target",
            targetRoot: context.targetRoot
          });
          const launchEnv = {
            ...terminalEnv,
            ...(spec.env || {})
          };
          const launchEnvHash = terminalEnvironmentFingerprint(launchEnv);
          const launchRestartBaseline = await createLaunchRestartBaseline({
            restartOnChange: spec.restartOnChange || spec.metadata?.restartOnChange,
            worktreePath: spec.metadata?.runRoot || spec.cwd || cwd
          });
          readinessMarker = readinessMarkerFromSpec(spec);
          let launchReadyWritten = false;
          await closeStoppedLaunchTerminals(sessionId);
          const existingReusableTerminal = forceRestart
            ? null
            : reusableLaunchTerminal(sessionId, {
                launchEnvHash,
                launchInputHash,
                launchTargetId: launchTarget.id,
                namespace,
                spec
              });
          await cleanupSupersededLaunchTerminals({
            launchPreviewProxies,
            namespace,
            removeLaunchTargetContainersImpl,
            reusableTerminal: existingReusableTerminal,
            sessionId,
            targetRoot: context.targetRoot
          });
          terminalSession = startTerminalSession({
            args: spec.args || [],
            command: spec.command,
            commandPreview: spec.commandPreview,
            cwd: spec.cwd || cwd,
            env: launchEnv,
            maxRunning: 1,
            metadata: {
              ...(spec.metadata || {}),
              attemptedCommand: commandInvocation(spec),
              envHash: launchEnvHash,
              launchInput,
              launchInputHash,
              ...(launchRestartBaseline ? { launchRestartBaseline } : {}),
              launchTargetId: launchTarget.id,
              launchTargetLabel: launchTarget.label,
              sessionId,
              ...terminalNoGithubActorMetadata({
                ownerUserKey: "launch-target",
                reason: "launch-target"
              })
            },
            namespace,
            namespaceLimitPrefix: namespace,
            onClose: async (event) => {
              await launchPreviewProxies.close({
                sessionId,
                terminalSessionId: event.id
              });
              const metadataCleared = await clearLaunchMetadataForTerminal(context.store, sessionId, event.id);
              if (metadataCleared) {
                await publishSessionChanged(sessionId, {
                  reason: "launch-target-stale-cleared"
                });
              }
              if (typeof spec.onClose === "function") {
                await spec.onClose(event);
              }
            },
            onStop: async (event) => {
              await launchPreviewProxies.close({
                sessionId,
                terminalSessionId: event.id
              });
              const metadataCleared = await clearLaunchMetadataForTerminal(context.store, sessionId, event.id);
              if (metadataCleared) {
                await publishSessionChanged(sessionId, {
                  reason: "launch-target-stale-cleared"
                });
              }
              if (typeof spec.onStop === "function") {
                await spec.onStop(event);
              }
            },
            onOutput: ({ output, session: runningTerminalSession, updateMetadata }) => {
              const actions = launchActionsFromOutput(output);
              if (actions.length > 0 && launchActionsChanged(runningTerminalSession.metadata?.actions, actions)) {
                updateMetadata({
                  actions
                });
              }
              if (!readinessMarker || launchReadyWritten || !launchReadinessMarkerLineSeen(output, readinessMarker)) {
                return;
              }
              launchReadyWritten = true;
              void markLaunchTerminalReady({
                delayMs: launchReadyStabilityDelayMs,
                namespace,
                publishSessionChanged,
                store: context.store,
                sessionId,
                terminalSession: runningTerminalSession,
                updateMetadata
              });
            },
            reuseRunning: forceRestart
              ? false
              : (runningSession) => {
                  return launchTerminalCanBeReused(runningSession, {
                    launchEnvHash,
                    launchInputHash,
                    launchTargetId: launchTarget.id,
                    spec
                  });
                }
          });
        } catch (error) {
          releaseLaunchSpecReservation(spec);
          throw error;
        }
        if (
          terminalSession?.ok === false ||
          (spec.metadata?.port && String(terminalSession?.metadata?.port || "") !== String(spec.metadata.port))
        ) {
          releaseLaunchSpecReservation(spec);
        }
        if (terminalSession?.ok !== false && launchTerminalIsReady(terminalSession, readinessMarker)) {
          await writeLaunchMetadata(context.store, sessionId, terminalSession);
        }
        return terminalSession;
      }));
    },

    async stopTerminal(sessionId, terminalSessionId) {
      await launchPreviewProxies.close({
        sessionId,
        terminalSessionId
      });
      const result = stopTerminalSession(terminalSessionId, {
        namespace: launchTargetTerminalNamespace(sessionId)
      });
      if (result?.ok === false && /terminal session not found/iu.test(String(result.error || ""))) {
        return {
          ok: true,
          id: String(terminalSessionId || ""),
          running: false,
          stale: true,
          status: "exited"
        };
      }
      return result;
    },

    subscribeTerminal(sessionId, terminalSessionId, subscriber) {
      return subscribeTerminalSession(terminalSessionId, subscriber, {
        namespace: launchTargetTerminalNamespace(sessionId)
      });
    },

    writeTerminal(sessionId, terminalSessionId, data) {
      return writeTerminalSession(terminalSessionId, data, {
        namespace: launchTargetTerminalNamespace(sessionId)
      });
    },

    resizeTerminal(sessionId, terminalSessionId, size) {
      return resizeTerminalSession(terminalSessionId, size, {
        namespace: launchTargetTerminalNamespace(sessionId)
      });
    }
  });
}

function previewPublicOriginForLaunch({
  publicHost = "",
  publicProtocol = "",
  sessionId = "",
  targetHref = "",
  terminalSessionId = ""
} = {}) {
  const hostname = normalizeHostName(String(publicHost || "").trim());
  if (!hostname || isLoopbackAddress(hostname)) {
    return "";
  }
  const studioHostMatch = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.([a-z0-9][a-z0-9.-]*[a-z0-9])$/u.exec(hostname);
  if (!studioHostMatch) {
    return "";
  }
  const workspace = studioHostMatch[1];
  const baseDomain = previewPublicBaseDomain(studioHostMatch[2]);
  const hash = stableHash([
    terminalProjectScopeKey(),
    sessionId,
    terminalSessionId,
    targetHref
  ].join("\n")).replace(/[^a-z0-9]/giu, "").toLowerCase().slice(0, 12);
  if (!hash) {
    return "";
  }
  void publicProtocol;
  return `https://${PREVIEW_PUBLIC_HOST_PREFIX}-${hash}--${workspace}.${baseDomain}`;
}

function previewPublicBaseDomain(studioBaseDomain = "") {
  const baseDomain = String(studioBaseDomain || "").trim().toLowerCase();
  if (baseDomain.startsWith("users.")) {
    return baseDomain.slice("users.".length);
  }
  return baseDomain;
}

export {
  LAUNCH_METADATA,
  cleanupSupersededLaunchTerminals,
  createLaunchRestartBaseline,
  ensureLaunchTargetRuntime,
  launchActionsFromOutput,
  launchReadinessMarkerLineSeen,
  launchRestartState,
  previewPublicOriginForLaunch,
  createLaunchTargetTerminalController
};
