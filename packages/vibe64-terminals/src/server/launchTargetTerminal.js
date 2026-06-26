import { execFile } from "node:child_process";
import crypto from "node:crypto";
import { readFile, stat } from "node:fs/promises";
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

function launchStatusResponse({
  launchTargets = [],
  session = {},
  terminal = null,
  previewTarget = null
} = {}) {
  const lastLaunchTarget = launchTargetFromMetadata(session.metadata || {});
  const openTarget = lastLaunchTarget?.openTarget || null;
  const normalizedPreviewTarget = previewTarget && previewTarget.available !== false
    ? previewTarget
    : null;
  return {
    ok: true,
    activeTerminal: terminal ? launchTerminalStatus(terminal, {
      previewTarget: normalizedPreviewTarget
    }) : null,
    launchTargets,
    previewTarget: normalizedPreviewTarget || {
      ...(previewTarget && typeof previewTarget === "object" && !Array.isArray(previewTarget) ? previewTarget : {}),
      available: false,
      disabledReason: previewTarget?.disabledReason || "Run a launch target first.",
      href: "",
      kind: "url",
      label: "Preview",
      targetHref: previewTarget?.targetHref || openTarget?.href || ""
    },
    lastLaunchTarget,
    openTarget: openTarget
      ? {
          ...openTarget,
          available: true,
          disabledReason: "",
          previewHref: normalizedPreviewTarget?.href || ""
        }
      : {
          available: false,
          disabledReason: "Run a launch target first.",
          href: "",
          kind: "url",
          label: "Open browser"
        }
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

function stalePreviewTargetForContainer({
  container = {},
  reason = "server_restart_state_lost",
  session = {},
  targetHref = ""
} = {}) {
  const lastLaunchTarget = launchTargetFromMetadata(session.metadata || {});
  const href = String(targetHref || lastLaunchTarget?.openTarget?.href || "").trim();
  return {
    available: false,
    disabledReason: "Preview state was lost after a server restart. Restart preview to recover.",
    href: "",
    kind: "url",
    label: "Preview",
    recovery: {
      canRestart: Boolean(lastLaunchTarget?.id),
      canStopStale: Boolean(container.id),
      containerId: String(container.id || ""),
      containerName: String(container.name || ""),
      reason,
      terminalSessionId: String(container.terminalId || "")
    },
    targetHref: href
  };
}

function stalePreviewTargetForMissingLaunch({
  reason = "server_restart_state_lost",
  session = {},
  targetHref = ""
} = {}) {
  const lastLaunchTarget = launchTargetFromMetadata(session.metadata || {});
  const href = String(targetHref || lastLaunchTarget?.openTarget?.href || "").trim();
  return {
    available: false,
    disabledReason: "Preview state was lost after a server restart. Restart preview to recover.",
    href: "",
    kind: "url",
    label: "Preview",
    recovery: {
      canRestart: Boolean(lastLaunchTarget?.id),
      canStopStale: false,
      containerId: "",
      containerName: "",
      reason,
      terminalSessionId: ""
    },
    targetHref: href
  };
}

async function previewTargetWithLaunchRestartRecovery({
  context = {},
  previewTarget = null,
  terminal = null
} = {}) {
  const launchRestartBaseline = normalizeLaunchRestartBaseline(terminal?.metadata?.launchRestartBaseline);
  if (!previewTarget?.href || !launchRestartBaseline) {
    return previewTarget;
  }
  const metadata = terminal.metadata || {};
  const worktreePath = String(metadata.runRoot || metadata.targetRoot || context.targetRoot || "").trim();
  if (!worktreePath) {
    return previewTarget;
  }
  try {
    const restartState = await launchRestartState({
      baseline: launchRestartBaseline,
      worktreePath
    });
    if (!restartState.stale) {
      return previewTarget;
    }
    return {
      ...previewTarget,
      stale: true,
      recovery: {
        ...(previewTarget.recovery && typeof previewTarget.recovery === "object" && !Array.isArray(previewTarget.recovery)
          ? previewTarget.recovery
          : {}),
        canRestart: true,
        changedFiles: restartState.changedFiles,
        changedFilesTruncated: restartState.changedFilesTruncated,
        label: launchRestartBaseline.rules?.label || "server-side files",
        reason: restartState.reason || LAUNCH_RESTART_REASON_SOURCE_CHANGED
      }
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
    return previewTarget;
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

function createLaunchTargetTerminalController({
  ensureLaunchTargetRuntimeImpl = ensureLaunchTargetRuntime,
  launchReadyStabilityDelayMs = LAUNCH_READY_STABILITY_DELAY_MS,
  listRunningLaunchTargetContainersImpl = listRunningLaunchTargetContainers,
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

  async function previewTargetForStatus(sessionId = "", status = {}, options = {}) {
    const targetHref = String(status.openTarget?.href || "").trim();
    if (!targetHref || status.openTarget?.available === false) {
      return null;
    }
    const terminalSessionId = String(status.activeTerminal?.id || "").trim();
    if (!terminalSessionId || status.activeTerminal?.running !== true) {
      return {
        available: false,
        disabledReason: "Run a launch target first.",
        href: "",
        kind: "url",
        label: "Preview",
        targetHref
      };
    }
    if (!launchIsReady(status.activeTerminal?.metadata || {})) {
      return {
        available: false,
        disabledReason: "Launch target is starting.",
        href: "",
        kind: "url",
        label: "Preview",
        targetHref
      };
    }
    const proxyTargetHref = await previewProxyTargetHrefForTerminal(status.activeTerminal, {
      targetHref
    });
    try {
      const previewTarget = await launchPreviewProxies.ensure({
        previewPublicOrigin: previewPublicOriginForLaunch({
          publicHost: options.publicHost,
          publicProtocol: options.publicProtocol,
          sessionId,
          targetHref,
          terminalSessionId
        }),
        previewAuth: previewAuthForLaunchTerminal(status.activeTerminal, {
          sessionId,
          targetHref
        }),
        sessionId,
        targetHref,
        terminalSessionId
      }, proxyTargetHref);
      return {
        ...previewTarget,
        targetHref
      };
    } catch (error) {
      return {
        available: false,
        disabledReason: String(error?.message || error || "Launch preview proxy could not start."),
        href: "",
        kind: "url",
        label: "Preview",
        targetHref
      };
    }
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

  async function recoverLaunchTerminalFromLiveContainer({
    context = {},
    sessionId = "",
    status = {}
  } = {}) {
    if (status.activeTerminal) {
      return {
        previewTerminal: null,
        previewTarget: null,
        session: null,
        terminal: null
      };
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
      return {
        previewTerminal: null,
        previewTarget: null,
        session: null,
        terminal: null
      };
    }
    if (!containers.length) {
      const lastLaunchTarget = launchTargetFromMetadata(context.session?.metadata || {});
      if (lastLaunchTarget?.id) {
        const previewTarget = stalePreviewTargetForMissingLaunch({
          session: context.session,
          targetHref: status.openTarget?.href || ""
        });
        let metadataCleared = false;
        try {
          metadataCleared = await clearLaunchMetadata(context.store, sessionId);
        } catch (error) {
          vibe64SessionDebugLog("server.launchTargetTerminal.restartReconcile.clearMetadata.error", {
            durationMs: vibe64SessionDebugDurationMs(startedAtMs),
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
          canRestart: previewTarget.recovery.canRestart,
          durationMs: vibe64SessionDebugDurationMs(startedAtMs),
          launchTargetId: lastLaunchTarget.id,
          metadataCleared,
          reason: previewTarget.recovery.reason,
          sessionId,
          targetHref: previewTarget.targetHref,
          targetRoot: context.targetRoot
        }, {
          level: "warn"
        });
        return {
          previewTerminal: null,
          previewTarget,
          session: sessionWithoutLaunchMetadata(context.session),
          terminal: null
        };
      }
      return {
        previewTerminal: null,
        previewTarget: null,
        session: null,
        terminal: null
      };
    }
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
    const terminal = recoveredLaunchTerminalFromContainer({
      container,
      session: context.session,
      sessionId,
      targetRoot: context.targetRoot
    });
    if (terminal) {
      vibe64SessionDebugLog("server.launchTargetTerminal.restartReconcile.previewRecovered", {
        containerId: String(container.id || ""),
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        sessionId,
        targetRoot: context.targetRoot,
        terminalSessionId: terminal.id
      });
      return {
        previewTerminal: terminal,
        previewTarget: null,
        session: null,
        terminal: null
      };
    }
    const previewTarget = stalePreviewTargetForContainer({
      container,
      session: context.session,
      targetHref: status.openTarget?.href || ""
    });
    vibe64SessionDebugLog("server.launchTargetTerminal.restartReconcile.stale", {
      canRestart: previewTarget.recovery.canRestart,
      containerId: String(container.id || ""),
      durationMs: vibe64SessionDebugDurationMs(startedAtMs),
      reason: previewTarget.recovery.reason,
      sessionId,
      targetRoot: context.targetRoot,
      terminalSessionId: String(container.terminalId || "")
    }, {
      level: "warn"
    });
    return {
      previewTerminal: null,
      previewTarget,
      session: null,
      terminal: null
    };
  }

  return Object.freeze({
    async closeAllForSession(sessionId) {
      await launchPreviewProxies.close({
        sessionId
      });
      return closeTerminalSessionsForNamespace(launchTargetTerminalNamespace(sessionId));
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
        const terminal = latestLaunchTerminal(sessionId);
        let responseSession = context.session;
        const status = launchStatusResponse({
          launchTargets,
          session: responseSession,
          terminal
        });
        const recovered = await recoverLaunchTerminalFromLiveContainer({
          context: {
            ...context,
            session: responseSession
          },
          sessionId,
          status
        });
        responseSession = recovered.session || responseSession;
        const statusForPreview = recovered.terminal
          ? launchStatusResponse({
              launchTargets,
              session: responseSession,
              terminal: recovered.terminal
            })
          : recovered.previewTerminal
            ? launchStatusResponse({
                launchTargets,
                session: responseSession,
                terminal: recovered.previewTerminal
              })
            : status;
        const previewTarget = recovered.previewTarget ||
          await previewTargetForStatus(sessionId, statusForPreview, options);
        const responseTerminal = recovered.terminal || latestLaunchTerminal(sessionId);
        const restartMetadataTerminal = recovered.terminal || recovered.previewTerminal || responseTerminal;
        const restartAwarePreviewTarget = await previewTargetWithLaunchRestartRecovery({
          context,
          previewTarget,
          terminal: restartMetadataTerminal
        });
        return launchStatusResponse({
          launchTargets,
          previewTarget: restartAwarePreviewTarget,
          session: responseSession,
          terminal: responseTerminal
        });
      });
    },

    async openLaunchTarget(sessionId) {
      return vibe64Result(async () => {
        const context = await createLaunchContext(projectService, sessionId);
        const status = launchStatusResponse({
          launchTargets: await listLaunchTargets(context),
          session: context.session
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
