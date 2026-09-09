import crypto from "node:crypto";
import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import stripAnsi from "strip-ansi";

import {
  beginTerminalNamespaceOperation,
  closeTerminalSession,
  closeTerminalSessionsForNamespace,
  listTerminalSessions,
  readTerminalSession,
  resizeTerminalSession,
  stopTerminalSession,
  subscribeTerminalSession,
  updateTerminalSessionMetadata,
  writeTerminalSession
} from "@local/vibe64-execution/server/terminalSessions";
import {
  runVibe64Command
} from "@local/vibe64-execution/server";
import {
  terminalNoGithubActorMetadata
} from "@local/studio-terminal-core/server/terminalOwnership";
import {
  managedPreviewTarget
} from "@local/studio-terminal-core/shared";
import {
  isLoopbackAddress,
  normalizeHostName
} from "@local/vibe64-core/server/localStudioRequest";
import {
  currentProjectRequestContext
} from "@local/vibe64-core/server/projectRequestContext";
import {
  VIBE64_PREVIEW_PUBLIC_DOMAIN_ENV,
  VIBE64_PUBLIC_PROTOCOL_ENV,
  VIBE64_PUBLIC_USER_DOMAIN_ENV
} from "@local/vibe64-core/server/launchPreviewProxyEnv";
import {
  launchRestartRulesMatcher,
  normalizeLaunchRestartPath,
  normalizeLaunchRestartRules
} from "@local/vibe64-core/server/launchRestartRules";
import {
  createPreviewIdentityGrant,
  normalizePreviewAuthKind,
  normalizePreviewApplicationIdentities,
  PREVIEW_IDENTITY_LOGIN_OPERATION,
  PREVIEW_IDENTITY_LOGOUT_OPERATION,
  previewAuthEnvironment,
  previewAuthIdentityAvailable,
  previewAuthIdentityTypes,
  previewAuthRequiresIdentitySecret,
  previewAuthProfilePath,
  previewAuthSecretPath,
  readPreviewAuthSecret
} from "@local/vibe64-core/server/previewAuth";
import {
  vibe64SessionDebugDurationMs,
  vibe64SessionDebugError,
  vibe64SessionDebugLog
} from "@local/vibe64-runtime/server/sessionDebugLog";
import {
  sessionClosingReason
} from "@local/vibe64-runtime/server/sessionLifecycle";
import {
  runVibe64AgentWriteExclusive
} from "@local/vibe64-runtime/server/agentWriteLock";
import {
  assertSourceInspectionHealthy
} from "@local/vibe64-runtime/server/sessionSourceInspection";
import {
  commandInvocation,
  ensureTerminalSessionSourceGitSelfContained,
  vibe64Result,
  outputTargetTerminalNamespace,
  sessionTerminalCwd,
  terminalProjectScopeKey,
  stableHash
} from "./terminalShared.js";
import {
  projectExecutionEnvFromRecords,
  loadProjectExecutionEnv,
  loadProjectExecutionEnvRecords,
  executionEnvFingerprint
} from "./projectExecutionEnv.js";
import {
  createLaunchPreviewProxyRegistry
} from "./launchPreviewProxy.js";
import {
  createPreviewIdentityCommandRunner
} from "./previewIdentityCommand.js";
import {
  createVibe64OutputTargetTerminalSpec,
  inspectVibe64WorkspaceSetupForContext,
  listVibe64OutputTargets,
  outputResultsMarkerLineSeen
} from "./vibe64OutputTargets.js";
import {
  listOutputResults,
  readOutputResult,
  removeOutputResults,
  snapshotDeclaredOutputResults
} from "./outputResults.js";

const OUTPUT_METADATA = Object.freeze({
  agentHref: "output_target_agent_href",
  href: "output_target_open_href",
  id: "output_target_id",
  kind: "output_target_open_kind",
  label: "output_target_label",
  openLabel: "output_target_open_label",
  previewAuth: "output_target_preview_auth",
  restartBaseline: "output_target_restart_baseline",
  sessionRoot: "output_target_session_root",
  startedAt: "output_target_started_at",
  terminalId: "output_target_terminal_id"
});
const OUTPUT_METADATA_NAMES = Object.freeze(Object.values(OUTPUT_METADATA));
const MAX_LAUNCH_ACTION_SCAN_LINES = 10;
const PREVIEW_PUBLIC_HOST_PREFIX = "v64preview";
const VIBE64_WORKSPACE_ENV = "VIBE64_WORKSPACE";
const LAUNCH_RESTART_REASON_SOURCE_CHANGED = "server_source_changed";
const MAX_RESTART_CHANGED_FILES = 20;
const PREVIEW_LOG_FILE_NAME = "preview-log.jsonl";
const PREVIEW_LAST_FILE_NAME = "preview-last.json";
const PREVIEW_OUTPUT_TAIL_LIMIT = 12000;
const DEFAULT_PUBLIC_PROTOCOL = "https";

function normalizeRuntimeList(values = []) {
  const normalized = [];
  for (const value of Array.isArray(values) ? values : []) {
    const runtime = String(value || "").trim();
    if (runtime && !normalized.includes(runtime)) {
      normalized.push(runtime);
    }
  }
  return normalized;
}

function previewRuntimesForSpec(spec = {}) {
  return normalizeRuntimeList([
    "git",
    ...(Array.isArray(spec.runtimes) ? spec.runtimes : [])
  ]);
}

function normalizeOutputTargetId(value = "") {
  return String(value || "").trim();
}

function previewDiagnosticsSessionRoot(session = {}) {
  return String(session?.sessionRoot || "").trim();
}

function previewLogPath(session = {}) {
  const sessionRoot = previewDiagnosticsSessionRoot(session);
  return sessionRoot ? path.join(sessionRoot, PREVIEW_LOG_FILE_NAME) : "";
}

function previewLastPath(session = {}) {
  const sessionRoot = previewDiagnosticsSessionRoot(session);
  return sessionRoot ? path.join(sessionRoot, PREVIEW_LAST_FILE_NAME) : "";
}

function previewDiagnosticOutputTail(output = "") {
  const text = stripAnsi(String(output || ""));
  return text.length > PREVIEW_OUTPUT_TAIL_LIMIT
    ? text.slice(text.length - PREVIEW_OUTPUT_TAIL_LIMIT)
    : text;
}

function previewDiagnosticError(error = null) {
  if (!error) {
    return null;
  }
  if (typeof error === "string") {
    return {
      message: error
    };
  }
  return {
    message: String(error?.message || error || ""),
    ...(error?.code ? { code: String(error.code) } : {}),
    ...(error?.statusCode ? { statusCode: error.statusCode } : {})
  };
}

async function writePreviewDiagnostic(session = {}, record = {}, {
  append = true
} = {}) {
  const sessionRoot = previewDiagnosticsSessionRoot(session);
  if (!sessionRoot) {
    return;
  }
  const normalizedRecord = {
    at: new Date().toISOString(),
    schemaVersion: 1,
    sessionId: String(record.sessionId || session.sessionId || session.id || "").trim(),
    sessionRoot,
    status: String(record.status || "failed").trim() || "failed",
    sessionSourceRoot: String(record.sessionSourceRoot || sessionTerminalCwd(session) || "").trim(),
    ...(record.reason ? { reason: String(record.reason) } : {}),
    ...(record.outputTargetId ? { outputTargetId: normalizeOutputTargetId(record.outputTargetId) } : {}),
    ...(record.cwd ? { cwd: String(record.cwd) } : {}),
    ...(record.commandPreview ? { commandPreview: String(record.commandPreview) } : {}),
    ...(record.terminalSessionId ? { terminalSessionId: String(record.terminalSessionId) } : {}),
    ...(record.exitCode !== undefined ? { exitCode: record.exitCode } : {}),
    ...(record.error ? { error: previewDiagnosticError(record.error) } : {}),
    ...(record.message ? { message: String(record.message) } : {}),
    ...(record.outputTail ? { outputTail: previewDiagnosticOutputTail(record.outputTail) } : {}),
    ...(record.details && typeof record.details === "object" && !Array.isArray(record.details) ? { details: record.details } : {})
  };
  try {
    await mkdir(sessionRoot, {
      recursive: true
    });
    await writeFile(previewLastPath(session), `${JSON.stringify(normalizedRecord, null, 2)}\n`, "utf8");
    if (append) {
      await appendFile(previewLogPath(session), `${JSON.stringify(normalizedRecord)}\n`, "utf8");
    }
  } catch (error) {
    vibe64SessionDebugLog("server.outputTargetTerminal.previewDiagnostics.error", {
      error: vibe64SessionDebugError(error),
      sessionId: record.sessionId || session.sessionId || session.id || "",
      sessionRoot
    }, {
      level: "warn"
    });
  }
}

function normalizeOpenTarget(value = {}) {
  return {
    href: String(value.href || "").trim(),
    kind: String(value.kind || "url").trim() || "url",
    label: String(value.label || "Open").trim() || "Open"
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

function pathInsideOrEqual(rootPath = "", candidatePath = "") {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
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
  const href = String(metadata[OUTPUT_METADATA.href] || "").trim();
  if (!href) {
    return null;
  }
  return normalizeOpenTarget({
    href,
    kind: metadata[OUTPUT_METADATA.kind],
    label: metadata[OUTPUT_METADATA.openLabel]
  });
}

function outputTargetFromMetadata(metadata = {}) {
  const id = String(metadata[OUTPUT_METADATA.id] || "").trim();
  if (!id) {
    return null;
  }
  return {
    id,
    agentHref: String(metadata[OUTPUT_METADATA.agentHref] || "").trim(),
    label: String(metadata[OUTPUT_METADATA.label] || id).trim() || id,
    openTarget: openTargetFromMetadata(metadata),
    startedAt: String(metadata[OUTPUT_METADATA.startedAt] || "").trim()
  };
}

function sessionWithoutLaunchMetadata(session = {}) {
  const metadata = session.metadata && typeof session.metadata === "object" && !Array.isArray(session.metadata)
    ? session.metadata
    : {};
  return {
    ...session,
    metadata: Object.fromEntries(Object.entries(metadata).filter(([name]) => !OUTPUT_METADATA_NAMES.includes(name)))
  };
}

async function clearLaunchMetadata(store, sessionId = "") {
  const normalizedSessionId = String(sessionId || "").trim();
  if (!normalizedSessionId || !store) {
    return false;
  }
  if (typeof store.mutateSession === "function" && typeof store.deleteMetadataValue === "function") {
    await store.mutateSession(normalizedSessionId, async () => {
      await Promise.all(OUTPUT_METADATA_NAMES.map((name) => store.deleteMetadataValue(normalizedSessionId, name)));
    });
    return true;
  }
  if (typeof store.deleteMetadataValues === "function") {
    await store.deleteMetadataValues(normalizedSessionId, OUTPUT_METADATA_NAMES);
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
    await store.readMetadataValue(sessionId, OUTPUT_METADATA.terminalId) || ""
  ).trim();
  if (currentTerminalId !== normalizedTerminalSessionId) {
    return false;
  }
  return clearLaunchMetadata(store, sessionId);
}

async function writeLaunchMetadata(store, sessionId, terminalSession = {}) {
  const metadata = terminalSession.metadata || {};
  const openTarget = normalizeOpenTarget(metadata.openTarget || {});
  if (!metadata.outputTargetId || !openTarget.href) {
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
      store.writeMetadataValue(sessionId, OUTPUT_METADATA.agentHref, agentHref),
      store.writeMetadataValue(sessionId, OUTPUT_METADATA.id, metadata.outputTargetId),
      store.writeMetadataValue(sessionId, OUTPUT_METADATA.label, metadata.outputTargetLabel || metadata.outputTargetId),
      store.writeMetadataValue(sessionId, OUTPUT_METADATA.kind, openTarget.kind),
      store.writeMetadataValue(sessionId, OUTPUT_METADATA.openLabel, openTarget.label),
      store.writeMetadataValue(sessionId, OUTPUT_METADATA.href, openTarget.href),
      store.writeMetadataValue(sessionId, OUTPUT_METADATA.previewAuth, metadata.previewAuth || ""),
      store.writeMetadataValue(
        sessionId,
        OUTPUT_METADATA.restartBaseline,
        serializeLaunchRestartBaseline(metadata.launchRestartBaseline)
      ),
      store.writeMetadataValue(sessionId, OUTPUT_METADATA.sessionRoot, metadata.sessionRoot || ""),
      store.writeMetadataValue(sessionId, OUTPUT_METADATA.startedAt, new Date().toISOString()),
      store.writeMetadataValue(sessionId, OUTPUT_METADATA.terminalId, terminalSession.id || "")
    ]);
  });
}

async function createLaunchContext(projectService, sessionId, {
  awaitWorkspacePrepared = false,
  ensureWorkspacePrepared = null,
  prepareEnvironment = false
} = {}) {
  const runtime = await projectService.createRuntime();
  let session = await runtime.getSession(sessionId);
  assertSourceInspectionHealthy(session.sourceInspection);
  if (typeof ensureWorkspacePrepared === "function") {
    const setup = await ensureWorkspacePrepared(sessionId, {
      runtime,
      session
    });
    if (setup?.ok === false) {
      throw Object.assign(new Error(setup.error || "Workspace preparation could not start."), setup);
    }
    if (awaitWorkspacePrepared && setup?.completion) {
      await setup.completion;
    }
    session = await runtime.getSession(sessionId);
  }
  const sessionSourceRoot = sessionTerminalCwd(session);
  const projectEnvironment = await loadProjectExecutionEnv({
    prepare: prepareEnvironment,
    reusePrepared: prepareEnvironment,
    projectService,
    session,
    target: "output-target"
  });
  const projectContextRoot = typeof projectService?.currentTargetRoot === "function"
    ? String(projectService.currentTargetRoot() || "").trim()
    : "";
  const previewIdentitySettings = typeof projectService?.readPreviewApplicationIdentities === "function"
    ? await projectService.readPreviewApplicationIdentities({
        sessionId: session.sessionId
      })
    : {
        identities: [],
        ok: true
      };
  if (previewIdentitySettings?.ok === false) {
    const error = new Error(
      previewIdentitySettings.errors?.[0]?.message ||
      previewIdentitySettings.error ||
      "Managed app identities could not be read."
    );
    error.code = previewIdentitySettings.errors?.[0]?.code || previewIdentitySettings.code ||
      "vibe64_preview_application_identities_unavailable";
    throw error;
  }
  return {
    config: {},
    previewApplicationIdentities: previewIdentitySettings.identities || [],
    projectEnvironment,
    projectsRoot: projectService?.selectedProject?.projectsRoot || "",
    projectContextRoot,
    runtime,
    serviceDataRoot: typeof projectService?.currentServiceDataRoot === "function"
      ? projectService.currentServiceDataRoot()
      : "",
    session,
    store: runtime.store,
    sessionSourceRoot
  };
}

async function listOutputTargets(context, {
  inspectOutputs,
  inspectWorkspaceSetup
} = {}) {
  const [targets, setup] = await Promise.all([
    listVibe64OutputTargets(context, inspectOutputs ? { inspect: inspectOutputs } : {}),
    inspectVibe64WorkspaceSetupForContext(
      context,
      inspectWorkspaceSetup ? { inspect: inspectWorkspaceSetup } : {}
    )
  ]);
  const disabledReason = workspaceSetupLaunchDisabledReason(context.session, setup);
  if (!disabledReason) {
    return targets;
  }
  return targets.map((target) => ({
    ...target,
    available: false,
    disabledReason
  }));
}

function workspaceSetupLaunchDisabledReason(session = {}, inspection = null) {
  const stored = session.workspaceSetup || {};
  const storedStatus = String(stored.status || "").trim();
  const inspectionStatus = String(inspection?.status || "").trim();

  if (!inspectionStatus) {
    return ["ambiguous", "failed"].includes(storedStatus)
      ? String(stored.diagnostic || "Workspace preparation must be fixed before managed preview can start.").trim()
      : "";
  }
  if (inspectionStatus === "unconfigured") {
    return "";
  }

  const diagnostic = (Array.isArray(inspection?.diagnostics) ? inspection.diagnostics : [])
    .map((entry) => String(
      typeof entry === "string" ? entry : entry?.message || entry?.code || ""
    ).trim())
    .find(Boolean) || "";
  if (inspectionStatus !== "ready") {
    return diagnostic || "Vibe64 workspace preparation is not ready.";
  }

  const recipeHash = String(inspection?.recipeHash || "").trim();
  const storedRecipeHash = String(stored.recipeHash || "").trim();
  const currentRecipe = Boolean(recipeHash && storedRecipeHash === recipeHash);
  if (currentRecipe && storedStatus === "succeeded") {
    return "";
  }
  if (currentRecipe && storedStatus === "running") {
    return "";
  }
  if (currentRecipe && ["ambiguous", "failed"].includes(storedStatus)) {
    return String(
      stored.diagnostic || "Workspace preparation must be fixed before managed preview can start."
    ).trim();
  }
  // Starting an output target owns running and awaiting the current recipe.
  // A new or changed recipe is therefore pending work, not a disabled target.
  return "";
}

async function createOutputTargetSpec(input = {}) {
  return createVibe64OutputTargetTerminalSpec(input);
}

function outputTargetExecutionDescriptor(outputTarget = {}, spec = {}) {
  const presentationKind = String(spec.metadata?.outputPresentationKind || "").trim();
  const outputMode = String(spec.metadata?.outputMode || "").trim();
  return {
    kind: presentationKind === "web"
      ? "preview"
      : outputMode === "finite"
        ? "job"
        : "terminal",
    label: String(outputTarget.label || spec.metadata?.outputTargetLabel || "Output target").trim()
  };
}

function findOutputTarget(targets = [], outputTargetId = "") {
  const normalizedOutputTargetId = normalizeOutputTargetId(outputTargetId);
  return targets.find((target) => target.id === normalizedOutputTargetId) || null;
}

function previewTargetError(target, outputTargetId) {
  if (target && target.available !== false && target.presentation?.kind === "web") {
    return null;
  }
  return Object.assign(new Error(`Preview target ${outputTargetId} must be an available declared web target.`), {
    code: "vibe64_preview_target_unavailable"
  });
}

function managedPreviewUnavailableMessage(outputTargets = []) {
  const reasons = [...new Set(outputTargets
    .map((target) => String(target?.disabledReason || "").trim())
    .filter(Boolean))];
  if (reasons.length > 0) {
    return reasons.join(" ");
  }
  return outputTargets.length > 0
    ? "The managed preview is not currently available."
    : "This project does not currently provide a managed preview.";
}

function managedPreviewLaunchPlan({
  outputTargets = [],
  outputTargetId = "",
  previewStatus = {},
  restart = false,
  savedOutputTarget = null
} = {}) {
  const activeTerminal = previewStatus.activeTerminal || null;
  const previewState = String(previewStatus.preview?.state || "").trim();
  const requestedTarget = outputTargetId ? findOutputTarget(outputTargets, outputTargetId) : null;
  const targetError = outputTargetId ? previewTargetError(requestedTarget, outputTargetId) : null;
  if (targetError) {
    return {
      code: targetError.code,
      error: targetError.message,
      ready: false
    };
  }
  const sameTarget = !outputTargetId || activeTerminal?.metadata?.outputTargetId === outputTargetId;
  if (!restart && sameTarget && (
    previewState === "ready" ||
    (previewState === "starting" && launchTerminalIsRunning(activeTerminal || {}))
  )) {
    return {
      ready: true,
      terminal: activeTerminal || {
        ok: true
      }
    };
  }

  const activeMetadata = activeTerminal?.metadata || {};
  const lastOutputTarget = previewStatus.lastOutputTarget || savedOutputTarget || {};
  const previousTargetId = normalizeOutputTargetId(
    lastOutputTarget.id || activeMetadata.outputTargetId
  );
  if (restart && !previousTargetId) {
    return {
      code: "vibe64_preview_not_started",
      error: "No managed Vibe64 preview has been started for this session.",
      ready: false
    };
  }
  const previousTarget = findOutputTarget(outputTargets, previousTargetId);
  if (restart && (!previousTarget || previousTarget.available === false)) {
    return {
      error: previousTarget?.disabledReason || "The previous managed preview output target is no longer available.",
      ready: false
    };
  }
  const outputTarget = requestedTarget || (
    previousTarget && previousTarget.available !== false
      ? previousTarget
      : null
  ) || (restart ? null : managedPreviewTarget(outputTargets));
  if (!outputTarget) {
    return {
      error: managedPreviewUnavailableMessage(outputTargets),
      ready: false
    };
  }

  return {
    forceRestart: restart || launchTerminalIsRunning(activeTerminal || {}),
    outputTargetId: outputTarget.id,
    ready: false
  };
}

function normalizePreviewRecovery(recovery = null) {
  return recovery && typeof recovery === "object" && !Array.isArray(recovery) ? recovery : null;
}

function outputTargetFromTerminalMetadata(terminal = {}) {
  const source = terminal && typeof terminal === "object" && !Array.isArray(terminal)
    ? terminal
    : {};
  const metadata = source.metadata && typeof source.metadata === "object" && !Array.isArray(source.metadata)
    ? source.metadata
    : {};
  const id = String(metadata.outputTargetId || "").trim();
  if (!id) {
    return null;
  }
  const openTarget = normalizeOpenTarget(metadata.openTarget || {});
  return {
    id,
    agentHref: String(metadata.agentTargetHref || metadata.previewProxyTargetHref || metadata.targetUrl || openTarget.href || "").trim(),
    label: String(metadata.outputTargetLabel || id).trim() || id,
    openTarget: openTarget.href ? openTarget : null,
    startedAt: String(source.createdAt || "").trim()
  };
}

function outputTargetForPreviewStatus({
  session = {},
  terminal = null
} = {}) {
  const terminalOutputTarget = terminal ? outputTargetFromTerminalMetadata(terminal) : null;
  const sessionOutputTarget = outputTargetFromMetadata(session.metadata || {});
  if (terminalOutputTarget && !terminalOutputTarget.openTarget && sessionOutputTarget?.openTarget) {
    return {
      ...terminalOutputTarget,
      agentHref: terminalOutputTarget.agentHref || sessionOutputTarget.agentHref,
      openTarget: sessionOutputTarget.openTarget,
      startedAt: terminalOutputTarget.startedAt || sessionOutputTarget.startedAt
    };
  }
  return terminalOutputTarget || sessionOutputTarget;
}

function openTargetForPreviewStatus({
  lastOutputTarget = null,
  terminal = null
} = {}) {
  if (lastOutputTarget?.openTarget?.href) {
    return lastOutputTarget.openTarget;
  }
  const terminalOpenTarget = outputTargetFromTerminalMetadata(terminal)?.openTarget || null;
  return terminalOpenTarget?.href ? terminalOpenTarget : null;
}

function outputTargetCanStart(outputTargets = []) {
  return Array.isArray(outputTargets) && outputTargets.some((target) => target?.available !== false);
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
    ? "Run an output target first."
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
      disabledReason: "Run an output target first.",
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

function outputExecutionStatus(terminal = null) {
  if (!terminal) {
    return {
      error: null,
      mode: "",
      presentationKind: "",
      state: "idle",
      targetId: ""
    };
  }
  const metadata = terminal.metadata && typeof terminal.metadata === "object" && !Array.isArray(terminal.metadata)
    ? terminal.metadata
    : {};
  const outputError = metadata.outputResultError && typeof metadata.outputResultError === "object"
    ? metadata.outputResultError
    : null;
  const running = launchTerminalIsRunning(terminal);
  let state = "stopped";
  if (outputError) state = "failed";
  else if (running) state = launchIsReady(metadata) ? "ready" : "preparing";
  else if (terminal.status === "exited") state = terminal.exitCode === 0 ? "succeeded" : "failed";
  return {
    error: outputError,
    mode: String(metadata.outputMode || ""),
    presentationKind: String(metadata.outputPresentationKind || ""),
    state,
    targetId: String(metadata.outputTargetId || "")
  };
}

function outputStatusResponseFromPreviewStatus({
  outputRuns = [],
  outputTargets = [],
  previewStatus = {},
  previewApplicationIdentities = []
} = {}) {
  const preview = normalizeLaunchPreview(previewStatus.preview || {});
  const previewTarget = previewTargetFromLaunchPreview(preview);
  const normalizedPreviewTarget = previewTarget.available !== false ? previewTarget : null;
  return {
    ok: true,
    activeTerminal: previewStatus.activeTerminal ? launchTerminalStatus(previewStatus.activeTerminal, {
      previewTarget: normalizedPreviewTarget
    }) : null,
    output: outputExecutionStatus(previewStatus.activeTerminal || null),
    outputRuns,
    outputTargets,
    preview,
    previewIdentity: previewIdentityCapability({
      previewApplicationIdentities,
      preview,
      terminal: previewStatus.activeTerminal
    }),
    previewTarget,
    lastOutputTarget: previewStatus.lastOutputTarget || null,
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
  const requiresIdentitySecret = previewAuthRequiresIdentitySecret({ kind });
  let secret = "";
  try {
    secret = requiresIdentitySecret
      ? readPreviewAuthSecret(previewAuthSecretPath({
          sessionRoot: metadata.sessionRoot,
          terminalSessionId: terminal.id
        }))
      : "";
  } catch (error) {
    vibe64SessionDebugLog("server.outputTargetTerminal.previewIdentity.secretReadError", {
      error: vibe64SessionDebugError(error),
      sessionId,
      terminalSessionId: String(terminal.id || "")
    }, {
      level: "warn"
    });
    return null;
  }
  if (requiresIdentitySecret && !secret) {
    return null;
  }
  return {
    identityTypes: previewAuthIdentityTypes({
      identityTypes: metadata.previewIdentity?.identityTypes,
      kind
    }),
    kind,
    profilePath: previewAuthProfilePath({
      sessionRoot: metadata.sessionRoot,
      terminalSessionId: terminal.id
    }),
    projectScope: String(metadata.projectScope || terminalProjectScopeKey()).trim(),
    secret,
    sessionId,
    sessionRoot: String(metadata.sessionRoot || ""),
    targetHref,
    sessionSourceRoot: String(metadata.sessionSourceRoot || ""),
    terminalSessionId: String(terminal.id || "")
  };
}

function previewIdentityCapability({
  previewApplicationIdentities = [],
  preview = {},
  terminal = null
} = {}) {
  const previewReady = ["ready", "stale"].includes(String(preview.state || "")) && Boolean(preview.href);
  const previewAuthKind = normalizePreviewAuthKind(terminal?.metadata?.previewAuth);
  const identitySupported = previewAuthIdentityAvailable({
    kind: previewAuthKind
  });
  const previewAuth = previewAuthForLaunchTerminal(terminal || {}, {
    sessionId: terminal?.metadata?.sessionId || "",
    targetHref: preview.targetHref || ""
  });
  const identityTypes = previewAuthIdentityTypes(previewAuth || {
    kind: previewAuthKind
  });
  const configuredIdentities = normalizePreviewApplicationIdentities(previewApplicationIdentities);
  const identities = configuredIdentities.filter((identity) => (
    identityTypes.includes(identity.type)
  ));
  const available = previewReady &&
    identityTypes.length > 0 &&
    previewAuthIdentityAvailable(previewAuth || {});
  return {
    available,
    defaultIdentityName: identities[0]?.name || "",
    defaultMode: identities.length > 0 ? "identity" : "guest",
    disabledReason: available
      ? ""
      : !previewReady
        ? String(preview.message || "Run the preview before selecting an application identity.")
        : identitySupported
          ? identityTypes.length < 1
            ? "This preview does not advertise a supported application user identifier."
            : "Preview identity authorization is unavailable. Restart the preview."
          : "This preview does not support application identity switching.",
    identities,
    identityTypes,
    rejectedIdentities: configuredIdentities
      .filter((identity) => !identityTypes.includes(identity.type))
      .map((identity) => identity.name)
  };
}

function previewIdentitySelection(input = {}, {
  identities = []
} = {}) {
  const mode = String(input.mode || "identity").trim();
  if (!["identity", "guest"].includes(mode)) {
    const error = new Error("Preview identity mode is invalid.");
    error.code = "vibe64_preview_identity_mode_invalid";
    throw error;
  }
  if (mode === "guest") {
    return {
      requestedIdentity: {
        mode: "guest"
      },
      selection: {
        operation: PREVIEW_IDENTITY_LOGOUT_OPERATION
      }
    };
  }
  const requestedName = String(input.identityName || "").trim().toLowerCase();
  const identity = requestedName && requestedName !== "default"
    ? identities.find((entry) => entry.name === requestedName)
    : identities[0];
  if (!identity) {
    const availableNames = identities.map((entry) => entry.name);
    const error = new Error(
      requestedName && availableNames.length > 0
        ? `Unknown managed app identity ${requestedName}. Choose one of: ${availableNames.join(", ")}.`
        : "No managed app identity is configured for this project."
    );
    error.code = requestedName
      ? "vibe64_preview_identity_name_unknown"
      : "vibe64_preview_identity_not_configured";
    throw error;
  }
  const selector = {
    type: identity.type,
    value: identity.value
  };
  return {
    requestedIdentity: {
      displayName: identity.name,
      mode,
      name: identity.name,
      selector
    },
    selection: {
      operation: PREVIEW_IDENTITY_LOGIN_OPERATION,
      selector
    }
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

function latestLaunchTerminal(sessionId = "") {
  const terminals = listTerminalSessions({
    namespace: outputTargetTerminalNamespace(sessionId)
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
    .some((line) => {
      const text = line.trim().replace(/^[\s\u2800-\u28FF]+|[\s\u2800-\u28FF]+$/gu, "");
      return text === marker;
    });
}

async function closeStoppedLaunchTerminals(sessionId = "") {
  const namespace = outputTargetTerminalNamespace(sessionId);
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

function launchTerminalIsReady(terminalSession = {}, readinessMarker = "") {
  if (!readinessMarker) {
    return true;
  }
  return launchIsReady(terminalSession.metadata || {});
}

function launchTerminalCanBeReused(runningSession = {}, {
  launchEnvHash = "",
  outputTargetId = "",
  spec = {}
} = {}) {
  return spec.reuseRunning !== false &&
    runningSession.metadata?.envHash === launchEnvHash &&
    runningSession.metadata?.outputTargetId === outputTargetId;
}

function reusableLaunchTerminal(sessionId = "", {
  launchEnvHash = "",
  outputTargetId = "",
  namespace = outputTargetTerminalNamespace(sessionId),
  spec = {}
} = {}) {
  return listTerminalSessions({
    namespace,
    runningOnly: true
  }).find((terminal) => launchTerminalCanBeReused(terminal, {
    launchEnvHash,
    outputTargetId,
    spec
  })) || null;
}

function launchSpecEnvironment(specEnv = {}, input = {}) {
  const value = typeof specEnv === "function"
    ? specEnv(input)
    : specEnv;
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function launchSpecAllowedRoots(spec = {}) {
  return (Array.isArray(spec.allowedRoots) ? spec.allowedRoots : [])
    .map((root) => String(root || "").trim())
    .filter(Boolean);
}

function composeLaunchTerminalEnvironment({
  envBase = null,
  hashBase = null,
  terminalEnv = {},
  specEnv = {}
} = {}) {
  const resolvedEnvBase = envBase && typeof envBase === "object" && !Array.isArray(envBase)
    ? envBase
    : terminalEnv;
  const resolvedHashBase = hashBase && typeof hashBase === "object" && !Array.isArray(hashBase)
    ? hashBase
    : terminalEnv;
  const staticSpecEnv = launchSpecEnvironment(specEnv, {
    id: "",
    namespace: ""
  });
  const hashEnv = {
    ...resolvedHashBase,
    ...staticSpecEnv
  };
  const env = typeof specEnv === "function"
    ? (input = {}) => ({
        ...resolvedEnvBase,
        ...launchSpecEnvironment(specEnv, input)
      })
    : {
        ...resolvedEnvBase,
        ...staticSpecEnv
      };
  return {
    env,
    hashEnv
  };
}

async function cleanupSupersededLaunchTerminals({
  launchPreviewProxies = null,
  namespace = "",
  reusableTerminal = null,
  sessionId = ""
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
  if (!preservedTerminalIds.length) {
    await launchPreviewProxies?.close?.({
      sessionId
    });
  }
  return {
    closed
  };
}

async function markLaunchTerminalReady({
  namespace = "",
  publishSessionChanged = async () => null,
  source = "marker",
  store,
  sessionId = "",
  terminalSession = {},
  updateMetadata = () => null
} = {}) {
  const terminalSessionId = String(terminalSession?.id || "").trim();
  const currentTerminal = readTerminalSession(terminalSessionId, {
    namespace
  });
  if (!launchTerminalIsRunning(currentTerminal)) {
    vibe64SessionDebugLog("server.outputTargetTerminal.readyMarker.processExited", {
      exitCode: currentTerminal?.exitCode ?? null,
      sessionId,
      status: String(currentTerminal?.status || "missing"),
      terminalSessionId
    }, {
      level: "warn"
    });
    return {
      ready: false,
      terminal: currentTerminal,
      transitioned: false
    };
  }
  if (launchIsReady(currentTerminal.metadata || {})) {
    return {
      ready: true,
      terminal: currentTerminal,
      transitioned: false
    };
  }
  const readyMetadata = {
    launchReady: true,
    launchReadyAt: new Date().toISOString(),
    launchReadySource: String(source || "marker")
  };
  const readyTerminal = {
    ...currentTerminal,
    metadata: {
      ...(terminalSession.metadata || {}),
      ...(currentTerminal.metadata || {}),
      ...readyMetadata
    }
  };
  await writeLaunchMetadata(store, sessionId, readyTerminal);
  const runningTerminal = readTerminalSession(terminalSessionId, {
    namespace
  });
  if (!launchTerminalIsRunning(runningTerminal)) {
    await clearLaunchMetadataForTerminal(store, sessionId, terminalSessionId);
    return {
      ready: false,
      terminal: runningTerminal,
      transitioned: false
    };
  }
  const updatedSession = updateMetadata(readyMetadata);
  const updatedTerminal = readTerminalSession(terminalSessionId, {
    namespace
  }) || updatedSession || readyTerminal;
  await publishSessionChanged(sessionId, {
    reason: "output-target-ready"
  });
  vibe64SessionDebugLog("server.outputTargetTerminal.readyMarker.ready", {
    source: readyMetadata.launchReadySource,
    sessionId,
    terminalSessionId
  });
  return {
    ready: true,
    terminal: updatedTerminal,
    transitioned: true
  };
}

async function repairLaunchReadinessFromOutput({
  context = {},
  markReady = markLaunchTerminalReady,
  publishSessionChanged = async () => null,
  sessionId = "",
  terminal = null
} = {}) {
  const terminalSessionId = String(terminal?.id || "").trim();
  const readinessMarker = readinessMarkerFromSpec(terminal?.metadata || {});
  if (
    !terminalSessionId ||
    !readinessMarker ||
    !launchTerminalIsRunning(terminal) ||
    launchIsReady(terminal?.metadata || {}) ||
    !launchReadinessMarkerLineSeen(terminal?.output, readinessMarker)
  ) {
    return null;
  }
  const startedAtMs = Date.now();
  try {
    const result = await markReady({
      namespace: outputTargetTerminalNamespace(sessionId),
      publishSessionChanged,
      source: "marker-repair",
      store: context.store,
      sessionId,
      terminalSession: terminal,
      updateMetadata: (metadata) => updateTerminalSessionMetadata(terminalSessionId, metadata, {
        namespace: outputTargetTerminalNamespace(sessionId)
      })
    });
    return result?.ready ? result.terminal || terminal : null;
  } catch (error) {
    vibe64SessionDebugLog("server.outputTargetTerminal.readyMarker.repairError", {
      durationMs: vibe64SessionDebugDurationMs(startedAtMs),
      error: vibe64SessionDebugError(error),
      readinessMarker,
      sessionId,
      terminalSessionId
    }, {
      level: "warn"
    });
    return null;
  }
}

async function readyLaunchPreview({
  activeTerminal = null,
  canShowLog = false,
  context = {},
  launchPreviewProxies = null,
  outputTargets = [],
  lastOutputTarget = null,
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
      lastOutputTarget,
      openTarget,
      preview: normalizeLaunchPreview({
        canRestart: Boolean(lastOutputTarget?.id),
        canShowLog,
        canStart: outputTargetCanStart(outputTargets),
        message: "Output target URL is missing.",
        reason: "missing_target_href",
        state: "failed",
        terminalId: terminalSessionId
      })
    };
  }
  try {
    const previewTarget = await ensureLaunchPreviewProxy({
      context,
      launchPreviewProxies,
      options,
      sessionId,
      targetHref,
      terminal
    });
    const restartRecovery = await launchRestartRecoveryForTerminal({
      context,
      terminal
    });
    const stale = Boolean(restartRecovery);
    return {
      activeTerminal,
      lastOutputTarget,
      openTarget,
      preview: normalizeLaunchPreview({
        canRestart: Boolean(lastOutputTarget?.id || terminal?.metadata?.outputTargetId),
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
      lastOutputTarget,
      openTarget,
      preview: normalizeLaunchPreview({
        canRestart: Boolean(lastOutputTarget?.id || terminal?.metadata?.outputTargetId),
        canShowLog,
        canStart: outputTargetCanStart(outputTargets),
        message: String(error?.message || error || "Launch preview proxy could not start."),
        reason: "preview_proxy_unavailable",
        state: "failed",
        targetHref,
        terminalId: terminalSessionId
      })
    };
  }
}

async function ensureLaunchPreviewProxy({
  context = {},
  launchPreviewProxies = null,
  options = {},
  previewPublicOrigin = "",
  sessionId = "",
  targetHref = "",
  terminal = null
} = {}) {
  return launchPreviewProxies.ensure({
    executePreviewIdentityCommand: terminal?.metadata?.previewIdentity
      ? async ({ selection }) => {
          const runner = previewIdentityCommandRunnerForLaunchTerminal({
            context,
            runCommand: options.runCommand,
            targetHref,
            terminal
          });
          if (!runner) {
            const error = new Error("Application preview identity command is unavailable. Restart the preview.");
            error.code = "vibe64_preview_identity_command_unavailable";
            error.statusCode = 409;
            throw error;
          }
          return runner(selection);
        }
      : null,
    previewPublicOrigin: String(
      previewPublicOrigin ||
      terminal?.metadata?.previewPublicOrigin ||
      previewPublicOriginForLaunch({
        env: options.env,
        previewPublicDomain: options.previewPublicDomain,
        publicHost: options.publicHost,
        publicProtocol: options.publicProtocol,
        publicUserDomain: options.publicUserDomain,
        sessionId
      })
    ).trim(),
    previewAuth: previewAuthForLaunchTerminal(terminal, {
      sessionId,
      targetHref
    }),
    sessionId,
    targetHref,
    terminalSessionId: String(terminal?.id || "").trim()
  }, targetHref);
}

function launchExecutionProject(context = {}, terminalEnvRecords = {}) {
  return {
    config: context.config || {},
    projectsRoot: context.projectsRoot || "",
    runtimeConfigEnv: terminalEnvRecords.runtimeConfigEnv,
    runtimeTargetRoot: context.projectContextRoot || "",
    serviceDataRoot: context.serviceDataRoot || "",
    slug: String(currentProjectRequestContext()?.slug || "").trim(),
    targetRoot: context.sessionSourceRoot || ""
  };
}

function previewIdentityCommandRunnerForLaunchTerminal({
  context = {},
  runCommand = null,
  targetHref = "",
  terminal = null
} = {}) {
  const capability = terminal?.metadata?.previewIdentity;
  if (!capability || typeof runCommand !== "function") {
    return null;
  }
  const previewAuth = previewAuthForLaunchTerminal(terminal, {
    sessionId: terminal?.metadata?.sessionId || "",
    targetHref
  });
  if (!previewAuthIdentityAvailable(previewAuth || {})) {
    return null;
  }
  return createPreviewIdentityCommandRunner({
    allowedRoots: [
      context.sessionSourceRoot,
      capability.sourceRoot
    ].filter(Boolean),
    capability,
    // Identity exchange is a host-to-app protocol invocation, not another app
    // launch. It needs only the one-time exchange secret and its declared
    // aliases. Loading the complete project environment here can provision or
    // inspect managed resources (notably a session database) while the user is
    // waiting on a ten-second UI interaction.
    env: previewAuthEnvironment({
      ...previewAuth,
      previewIdentity: capability
    }),
    project: launchExecutionProject(context, {
      runtimeConfigEnv: {}
    }),
    runCommand,
    runtimes: capability.runtimes,
    session: context.session || {},
    sourceRoot: capability.sourceRoot,
    targetHref
  });
}

function stoppedLaunchPreviewStatus({
  activeTerminal = null,
  outputTargets = [],
  lastOutputTarget = null,
  openTarget = null
} = {}) {
  const exitCode = activeTerminal?.exitCode ?? null;
  const failed = exitCode !== 0;
  const targetHref = String(openTarget?.href || "").trim();
  return {
    activeTerminal,
    lastOutputTarget,
    openTarget,
    preview: normalizeLaunchPreview({
      canRestart: Boolean(lastOutputTarget?.id || activeTerminal?.metadata?.outputTargetId),
      canShowLog: Boolean(activeTerminal?.id),
      canStart: outputTargetCanStart(outputTargets),
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

async function missingLaunchPreviewStatus({
  context = {},
  outputTargets = [],
  openTarget = null,
  publishSessionChanged = async () => null,
  sessionId = ""
} = {}) {
  const lastOutputTarget = outputTargetFromMetadata(context.session?.metadata || {});
  const recovery = staleLaunchRecovery({
    canRestart: Boolean(lastOutputTarget?.id),
    canStopStale: false
  });
  let metadataCleared = false;
  try {
    metadataCleared = await clearLaunchMetadata(context.store, sessionId);
  } catch (error) {
    vibe64SessionDebugLog("server.outputTargetTerminal.restartReconcile.clearMetadata.error", {
      error: vibe64SessionDebugError(error),
      sessionId,
      sessionSourceRoot: context.sessionSourceRoot
    }, {
      level: "warn"
    });
  }
  if (metadataCleared) {
    await publishSessionChanged(sessionId, {
      reason: "output-target-stale-cleared"
    });
  }
  vibe64SessionDebugLog("server.outputTargetTerminal.restartReconcile.missingProcess", {
    canRestart: recovery.canRestart,
    outputTargetId: lastOutputTarget?.id || "",
    metadataCleared,
    reason: recovery.reason,
    sessionId,
    targetHref: String(openTarget?.href || lastOutputTarget?.openTarget?.href || "").trim(),
    sessionSourceRoot: context.sessionSourceRoot
  }, {
    level: "warn"
  });
  return {
    activeTerminal: null,
    lastOutputTarget: null,
    openTarget: null,
    preview: normalizeLaunchPreview({
      canRestart: recovery.canRestart,
      canShowLog: false,
      canStart: outputTargetCanStart(outputTargets),
      message: "Preview state was lost after a server restart. Restart preview to recover.",
      reason: recovery.reason,
      recovery,
      state: "failed",
      targetHref: String(openTarget?.href || lastOutputTarget?.openTarget?.href || "").trim(),
      terminalId: ""
    }),
    session: sessionWithoutLaunchMetadata(context.session)
  };
}

async function resolveLaunchPreviewStatus({
  context = {},
  launchPreviewProxies = null,
  outputTargets = [],
  markReady = markLaunchTerminalReady,
  options = {},
  publishSessionChanged = async () => null,
  sessionId = ""
} = {}) {
  const activeTerminal = latestLaunchTerminal(sessionId);
  const initialLastOutputTarget = outputTargetForPreviewStatus({
    session: context.session,
    terminal: activeTerminal
  });
  const initialOpenTarget = openTargetForPreviewStatus({
    lastOutputTarget: initialLastOutputTarget,
    terminal: activeTerminal
  });
  const presentationKind = String(activeTerminal?.metadata?.outputPresentationKind || "").trim();
  if (activeTerminal && presentationKind && presentationKind !== "web") {
    return {
      activeTerminal,
      lastOutputTarget: initialLastOutputTarget,
      openTarget: null,
      preview: normalizeLaunchPreview({
        canRestart: false,
        canShowLog: false,
        canStart: outputTargetCanStart(outputTargets),
        message: presentationKind === "terminal"
          ? "This output runs in the terminal."
          : "This finite output has no web preview.",
        state: "idle",
        terminalId: activeTerminal.id
      })
    };
  }
  if (activeTerminal && launchTerminalIsRunning(activeTerminal)) {
    let terminalForPreview = activeTerminal;
    const targetHref = String(initialOpenTarget?.href || "").trim();
    if (!launchIsReady(activeTerminal.metadata || {})) {
      terminalForPreview = await repairLaunchReadinessFromOutput({
        context,
        markReady,
        publishSessionChanged,
        sessionId,
        terminal: activeTerminal
      }) || activeTerminal;
    }
    if (!launchIsReady(terminalForPreview.metadata || {})) {
      return {
        activeTerminal: terminalForPreview,
        lastOutputTarget: initialLastOutputTarget,
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
      outputTargets,
      lastOutputTarget: outputTargetForPreviewStatus({
        session: context.session,
        terminal: terminalForPreview
      }),
      openTarget: openTargetForPreviewStatus({
        lastOutputTarget: outputTargetForPreviewStatus({
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
      outputTargets,
      lastOutputTarget: initialLastOutputTarget,
      openTarget: initialOpenTarget
    });
  }

  if (initialLastOutputTarget?.id) {
    return missingLaunchPreviewStatus({
      context,
      outputTargets,
      openTarget: initialOpenTarget,
      publishSessionChanged,
      sessionId
    });
  }

  return {
    activeTerminal: null,
    lastOutputTarget: null,
    openTarget: null,
    preview: normalizeLaunchPreview({
      canRestart: false,
      canShowLog: false,
      canStart: outputTargetCanStart(outputTargets),
      message: "Run an output target first.",
      state: "idle"
    })
  };
}

function createOutputTargetTerminalController({
  ensureWorkspacePrepared = null,
  env = process.env,
  projectService,
  publishSessionChanged = async () => null,
  runCommand = runVibe64Command,
  sessionAdmissionFailure = () => null
} = {}) {
  const launchPreviewProxies = createLaunchPreviewProxyRegistry({
    env
  });
  const launchReadyWrites = new Map();
  const launchStartLocks = new Map();
  const previewTestRuns = new Map();
  const outputResultWrites = new Map();

  async function ensureReadyLaunchPreviewProxy(context = {}, terminal = {}, {
    source = "ready"
  } = {}) {
    const metadata = terminal?.metadata || {};
    const targetHref = String(
      normalizeOpenTarget(metadata.openTarget || {}).href || metadata.targetUrl || ""
    ).trim();
    const previewPublicOrigin = String(metadata.previewPublicOrigin || "").trim();
    if (
      metadata.outputPresentationKind !== "web" ||
      !targetHref ||
      !previewPublicOrigin
    ) {
      return false;
    }
    try {
      await ensureLaunchPreviewProxy({
        context,
        launchPreviewProxies,
        options: {
          env,
          projectService,
          runCommand
        },
        previewPublicOrigin,
        sessionId: context.session?.sessionId || metadata.sessionId || "",
        targetHref,
        terminal
      });
      return true;
    } catch (error) {
      vibe64SessionDebugLog("server.outputTargetTerminal.previewProxy.eagerEnsureError", {
        error: vibe64SessionDebugError(error),
        sessionId: String(context.session?.sessionId || metadata.sessionId || ""),
        source,
        terminalSessionId: String(terminal?.id || "")
      }, {
        level: "warn"
      });
      return false;
    }
  }

  function captureOutputResults({
    context = {},
    outputTarget = {},
    spec = {},
    terminalSessionId = "",
    updateMetadata = () => null
  } = {}) {
    const downloads = Array.isArray(spec.metadata?.outputDownloads)
      ? spec.metadata.outputDownloads
      : [];
    if (downloads.length === 0 || !terminalSessionId) {
      return Promise.resolve({
        captured: false,
        ok: true,
        results: []
      });
    }
    const key = `${String(context.session?.sessionRoot || "")}:${terminalSessionId}`;
    const existing = outputResultWrites.get(key);
    if (existing) {
      return existing;
    }
    const write = snapshotDeclaredOutputResults({
      downloads,
      outputTargetId: outputTarget.id,
      session: context.session,
      terminalSessionId
    }).then(async (snapshot) => {
      updateMetadata({
        outputResultError: null,
        outputResults: snapshot.results,
        outputResultsReady: true,
        outputRun: snapshot.run
      });
      await publishSessionChanged(context.session?.sessionId || "", {
        reason: "output-results-ready"
      });
      return {
        ...snapshot,
        ok: true
      };
    }).catch(async (error) => {
      const outputResultFailure = {
        code: String(error?.code || "vibe64_output_result_snapshot_failed"),
        message: String(error?.message || error || "Declared downloads could not be snapshotted.")
      };
      updateMetadata({
        outputResultError: outputResultFailure,
        outputResultsReady: false
      });
      await publishSessionChanged(context.session?.sessionId || "", {
        reason: "output-results-failed"
      }).catch(() => null);
      vibe64SessionDebugLog("server.outputTargetTerminal.results.error", {
        error: vibe64SessionDebugError(error),
        outputTargetId: outputTarget.id,
        sessionId: context.session?.sessionId || "",
        terminalSessionId
      }, {
        level: "warn"
      });
      return {
        error: outputResultFailure,
        ok: false,
        results: []
      };
    });
    const tracked = write.finally(() => {
      if (outputResultWrites.get(key) === tracked) {
        outputResultWrites.delete(key);
      }
    });
    outputResultWrites.set(key, tracked);
    return tracked;
  }

  function markLaunchReady(input = {}) {
    const terminalSessionId = String(input.terminalSession?.id || "").trim();
    const key = `${String(input.namespace || "")}:${terminalSessionId}`;
    const existing = launchReadyWrites.get(key);
    if (existing) {
      return existing;
    }
    const write = Promise.resolve().then(() => markLaunchTerminalReady(input));
    const tracked = write.finally(() => {
      if (launchReadyWrites.get(key) === tracked) {
        launchReadyWrites.delete(key);
      }
    });
    launchReadyWrites.set(key, tracked);
    return tracked;
  }

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

  function launchAdmissionFailure(sessionId = "", session = null) {
    const frozen = sessionAdmissionFailure(sessionId);
    if (frozen?.ok === false) {
      return frozen;
    }
    const closingReason = sessionClosingReason(session || {});
    if (!closingReason) {
      return null;
    }
    const renewing = String(session?.status || "").trim() === "renewal_quiesced";
    return {
      code: renewing ? "vibe64_session_renewal_quiesced" : "vibe64_session_closing",
      error: renewing
        ? "Session renewal has frozen preview access."
        : `Session is ${closingReason} and preview access is unavailable.`,
      ok: false
    };
  }

  const controller = {
    async close() {
      for (const testRun of previewTestRuns.values()) testRun.closing = true;
      await Promise.allSettled([
        ...launchReadyWrites.values(),
        ...outputResultWrites.values()
      ]);
      await launchPreviewProxies.closeAll();
    },

    async closeAllForSession(sessionId) {
      const testRun = previewTestRuns.get(sessionId);
      if (testRun) testRun.closing = true;
      return withLaunchStartLock(sessionId, async () => {
        await launchPreviewProxies.close({
          sessionId
        });
        return closeTerminalSessionsForNamespace(outputTargetTerminalNamespace(sessionId));
      });
    },

    async removeResultsForSession(sessionId) {
      const context = await createLaunchContext(projectService, sessionId);
      await removeOutputResults(context.session);
      return {
        ok: true,
        removed: true,
        sessionId: String(sessionId || "")
      };
    },

    async closeTerminal(sessionId, terminalSessionId) {
      if (previewTestRuns.has(sessionId)) {
        return { ok: false, code: "vibe64_preview_test_busy", error: "Browser tests own this Preview. Stop the test command before closing Preview." };
      }
      await launchPreviewProxies.close({
        sessionId,
        terminalSessionId
      });
      return closeTerminalSession(terminalSessionId, {
        namespace: outputTargetTerminalNamespace(sessionId)
      });
    },

    async launchStatus(sessionId, options = {}) {
      return vibe64Result(async () => withLaunchStartLock(sessionId, async () => {
        const admission = beginTerminalNamespaceOperation(
          outputTargetTerminalNamespace(sessionId)
        );
        if (admission.ok === false) {
          return launchAdmissionFailure(sessionId) || admission;
        }
        try {
          const frozen = launchAdmissionFailure(sessionId);
          if (frozen) {
            return frozen;
          }
          const context = await createLaunchContext(projectService, sessionId);
          const unavailable = launchAdmissionFailure(sessionId, context.session);
          if (unavailable) {
            return unavailable;
          }
          const outputTargets = await listOutputTargets(context);
          const [previewStatus, outputRuns] = await Promise.all([
            resolveLaunchPreviewStatus({
            context,
            launchPreviewProxies,
            outputTargets,
            markReady: markLaunchReady,
            options: {
              ...options,
              env,
              projectService,
              runCommand
            },
            publishSessionChanged,
            sessionId
            }),
            listOutputResults(context.session)
          ]);
          return outputStatusResponseFromPreviewStatus({
            outputRuns,
            outputTargets,
            previewStatus,
            previewApplicationIdentities: context.previewApplicationIdentities
          });
        } finally {
          admission.release();
        }
      }));
    },

    async selectPreviewIdentity(sessionId, input = {}, options = {}) {
      return vibe64Result(async () => {
        const status = await controller.launchStatus(sessionId, options);
        if (status?.ok === false) {
          const error = new Error(status.error || "Preview identity is unavailable.");
          error.code = status.code || "vibe64_preview_identity_unavailable";
          throw error;
        }
        const unavailable = launchAdmissionFailure(sessionId, status.session);
        if (unavailable) {
          return unavailable;
        }
        if (!["ready", "stale"].includes(String(status.preview?.state || ""))) {
          const error = new Error(status.preview?.message || "Run the preview before selecting an identity.");
          error.code = "vibe64_preview_identity_preview_not_ready";
          throw error;
        }
        const previewAuth = previewAuthForLaunchTerminal(status.activeTerminal || {}, {
          sessionId,
          targetHref: status.preview.targetHref
        });
        if (!previewAuthIdentityAvailable(previewAuth || {})) {
          const error = new Error("This preview does not support application identity switching.");
          error.code = "vibe64_preview_identity_unsupported";
          throw error;
        }
        const identity = previewIdentitySelection(input, {
          identities: status.previewIdentity?.identities || []
        });
        return {
          grant: createPreviewIdentityGrant(previewAuth, identity.selection),
          ok: true,
          requestedIdentity: identity.requestedIdentity
        };
      });
    },

    ensurePreview(sessionId, input = {}) {
      return controller.startTerminal(sessionId, {
        outputTargetId: input.outputTargetId,
        ensurePreview: true
      });
    },

    async withPreviewTarget(sessionId, outputTargetId, operation, { waitUntilReady }) {
      const testRun = { targetId: outputTargetId, token: crypto.randomUUID(), closing: false };
      const previous = await withLaunchStartLock(sessionId, async () => {
        if (previewTestRuns.has(sessionId)) {
          throw Object.assign(new Error("Browser tests already own this session's Preview. Wait for them to finish."), {
            code: "vibe64_preview_test_busy"
          });
        }
        const context = await createLaunchContext(projectService, sessionId);
        const unavailable = launchAdmissionFailure(sessionId, context.session);
        if (unavailable) throw Object.assign(new Error(unavailable.error), unavailable);
        const targets = await listOutputTargets(context);
        const targetError = previewTargetError(findOutputTarget(targets, outputTargetId), outputTargetId);
        if (targetError) {
          throw targetError;
        }
        const status = await resolveLaunchPreviewStatus({
          context, launchPreviewProxies, outputTargets: targets, markReady: markLaunchReady,
          options: { env, projectService, runCommand }, publishSessionChanged, sessionId
        });
        previewTestRuns.set(sessionId, testRun);
        return {
          running: launchTerminalIsRunning(status.activeTerminal || {}),
          targetId: status.activeTerminal?.metadata?.outputTargetId || "",
          savedTarget: outputTargetFromMetadata(context.session.metadata),
          store: context.runtime.store
        };
      });
      async function ensureTargetReady(targetId, options) {
        const started = await controller.startTerminal(sessionId, {
          ensurePreview: true,
          outputTargetId: targetId,
          previewTestRun: testRun
        });
        if (started?.ok === false) {
          throw Object.assign(new Error(started.error), started);
        }
        await waitUntilReady(started, options);
      }

      let result;
      try {
        await ensureTargetReady(outputTargetId);
        if (testRun.closing) {
          throw new Error("The session closed before browser tests could start.");
        }
        result = await operation(testRun.token);
      } catch (error) {
        result = { ok: false, exitCode: 1, error: error.message, code: error.code };
      }
      try {
        if (testRun.closing) {
          return result;
        }
        if (previous.running && previous.targetId) {
          await ensureTargetReady(previous.targetId, { restoring: true });
        } else {
          await withLaunchStartLock(sessionId, async () => {
            await launchPreviewProxies.close({ sessionId });
            const closed = await closeTerminalSessionsForNamespace(outputTargetTerminalNamespace(sessionId));
            if (closed?.ok === false) throw new Error(closed.error);
            await clearLaunchMetadata(previous.store, sessionId);
            if (previous.savedTarget) {
              await previous.store.mutateSession(sessionId, async () => {
                await previous.store.writeMetadataValue(sessionId, OUTPUT_METADATA.id, previous.savedTarget.id);
                await previous.store.writeMetadataValue(sessionId, OUTPUT_METADATA.label, previous.savedTarget.label);
              });
            }
          });
        }
      } catch (error) {
        result = {
          ...result, ok: false, exitCode: result?.exitCode || 1,
          code: "vibe64_preview_restore_failed",
          error: [result?.error, `Could not restore Preview: ${error.message}`].filter(Boolean).join("\n")
        };
      } finally {
        previewTestRuns.delete(sessionId);
      }
      return result;
    },

    previewTestRunAdmission(sessionId, token = "") {
      const testRun = previewTestRuns.get(sessionId);
      if ((!testRun && token) || (testRun && (testRun.closing || testRun.token !== token))) {
        return { ok: false, code: "vibe64_preview_test_busy", error: "Another browser test owns this Preview, or this test run has ended. Wait for it to finish, then retry." };
      }
      return null;
    },

    restartPreview(sessionId) {
      return controller.startTerminal(sessionId, {
        restartPreview: true
      });
    },

    async openOutputTarget(sessionId) {
      return vibe64Result(async () => {
        const status = await controller.launchStatus(sessionId);
        if (status?.ok === false) {
          return status;
        }
        const unavailable = launchAdmissionFailure(sessionId, status.session);
        if (unavailable) {
          return unavailable;
        }
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

    async readResult(sessionId, resultId) {
      const context = await createLaunchContext(projectService, sessionId);
      return readOutputResult(context.session, resultId);
    },

    readTerminal(sessionId, terminalSessionId) {
      return readTerminalSession(terminalSessionId, {
        namespace: outputTargetTerminalNamespace(sessionId)
      });
    },

    async startTerminal(sessionId, input = {}) {
      return vibe64Result(async () => withLaunchStartLock(sessionId, async () => {
        const testRun = previewTestRuns.get(sessionId);
        if (testRun && input.previewTestRun !== testRun) {
          if (input.ensurePreview !== true || (input.outputTargetId && input.outputTargetId !== testRun.targetId)) {
            return { ok: false, code: "vibe64_preview_test_busy", error: "Browser tests own this Preview. Wait for them to finish before changing or restarting its target." };
          }
          input = { ...input, outputTargetId: testRun.targetId };
        }
        const admission = beginTerminalNamespaceOperation(outputTargetTerminalNamespace(sessionId));
        if (admission.ok === false) {
          return launchAdmissionFailure(sessionId) || admission;
        }
        try {
          const frozen = launchAdmissionFailure(sessionId);
          if (frozen) {
            return frozen;
          }
          const context = await createLaunchContext(projectService, sessionId, {
            awaitWorkspacePrepared: true,
            ensureWorkspacePrepared,
            prepareEnvironment: true
          });
          const unavailable = launchAdmissionFailure(sessionId, context.session);
          if (unavailable) {
            return unavailable;
          }
          const cwd = sessionTerminalCwd(context.session, projectService);
          let forceRestart = input.forceRestart === true;
          let outputTargetId = normalizeOutputTargetId(input.outputTargetId);
          let outputTargets = null;
          const managedPreviewOperation = input.ensurePreview === true || input.restartPreview === true;
          if (managedPreviewOperation) {
            const restartPreview = input.restartPreview === true;
            const savedOutputTarget = outputTargetFromMetadata(context.session?.metadata || {});
            outputTargets = await listOutputTargets(context);
            const previewStatus = await resolveLaunchPreviewStatus({
              context,
              launchPreviewProxies,
              outputTargets,
              markReady: markLaunchReady,
              options: {
                env,
                projectService,
                runCommand
              },
              publishSessionChanged,
              sessionId
            });
            const launchPlan = managedPreviewLaunchPlan({
              outputTargets,
              outputTargetId,
              previewStatus,
              restart: restartPreview,
              savedOutputTarget
            });
            if (launchPlan.ready) {
              return launchPlan.terminal;
            }
            if (testRun && input.previewTestRun !== testRun) {
              return { ok: false, code: "vibe64_preview_test_not_ready", error: "The browser-test Preview stopped. Tests cannot restart it while using its fixtures." };
            }
            if (launchPlan.error) {
              return {
                ...(launchPlan.code ? { code: launchPlan.code } : {}),
                error: launchPlan.error,
                ok: false
              };
            }
            forceRestart = launchPlan.forceRestart;
            outputTargetId = launchPlan.outputTargetId;
          }
          const diagnosticBase = {
            cwd,
            outputTargetId,
            sessionId
          };
          const closingReason = sessionClosingReason(context.session);
          if (closingReason) {
            await writePreviewDiagnostic(context.session, {
              ...diagnosticBase,
              message: `Session is ${closingReason}. Preview cannot start while the worktree is being archived.`,
              reason: "session_closing",
              status: "failed"
            });
            return {
              ok: false,
              error: `Session is ${closingReason}. Preview cannot start while the worktree is being archived.`
            };
          }
          if (!cwd) {
            await writePreviewDiagnostic(context.session, {
              ...diagnosticBase,
              message: "Vibe64 output target root is not available.",
              reason: "missing_target_root",
              status: "failed"
            });
            return {
              ok: false,
              error: "Vibe64 output target root is not available."
            };
          }
          await ensureTerminalSessionSourceGitSelfContained({
            runExclusive: async (operation) => {
              const result = await runVibe64AgentWriteExclusive(context.runtime, sessionId, operation, {
                operation: "prepare-preview-source"
              });
              if (!result.acquired) {
                throw Object.assign(new Error(result.value.error), result.value);
              }
              return result.value;
            },
            session: context.session,
            workdir: cwd
          });

          outputTargets ||= await listOutputTargets(context);
          const outputTarget = findOutputTarget(outputTargets, outputTargetId);
          if (!outputTarget) {
            await writePreviewDiagnostic(context.session, {
              ...diagnosticBase,
              details: {
                availableOutputTargetIds: outputTargets.map((target) => String(target?.id || "")).filter(Boolean)
              },
              message: "Output target is not available.",
              reason: "output_target_missing",
              status: "failed"
            });
            return {
              ok: false,
              error: "Output target is not available."
            };
          }
          if (outputTarget.available === false) {
            await writePreviewDiagnostic(context.session, {
              ...diagnosticBase,
              outputTargetId: outputTarget.id,
              message: outputTarget.disabledReason || "Output target is disabled.",
              reason: "output_target_disabled",
              status: "failed"
            });
            return {
              ok: false,
              error: outputTarget.disabledReason || "Output target is disabled."
            };
          }

          const spec = await createOutputTargetSpec({
            context: {
              ...context,
              outputTarget,
              vibe64User: input.vibe64User || null
            },
            outputTargetId: outputTarget.id
          });
          if (spec?.ok === false) {
            await writePreviewDiagnostic(context.session, {
              ...diagnosticBase,
              outputTargetId: outputTarget.id,
              message: spec.message || "Output target terminal cannot start.",
              reason: "output_target_spec_failed",
              status: "failed"
            });
            return {
              ok: false,
              error: spec.message || "Output target terminal cannot start."
            };
          }
          const commandPreview = commandInvocation(spec);

          const namespace = outputTargetTerminalNamespace(sessionId);
          let terminalSession;
          let outputResultsMarker = "";
          let readinessMarker = "";
          try {
            const terminalEnvRecords = await loadProjectExecutionEnvRecords({
              projectService,
              runCommand,
              runtime: context.runtime,
              session: context.session,
              target: "output-target"
            });
            const terminalEnv = projectExecutionEnvFromRecords(terminalEnvRecords);
            const launchEnvironment = composeLaunchTerminalEnvironment({
              envBase: {},
              hashBase: terminalEnv,
              specEnv: spec.env,
              terminalEnv
            });
            const commandAllowedRoots = [
              context.sessionSourceRoot,
              spec.cwd,
              cwd,
              ...launchSpecAllowedRoots(spec)
            ].filter(Boolean);
            const commandProject = launchExecutionProject(context, terminalEnvRecords);
            const launchEnvHash = executionEnvFingerprint(launchEnvironment.hashEnv);
            const launchRestartBaseline = await createLaunchRestartBaseline({
              restartOnChange: spec.restartOnChange || spec.metadata?.restartOnChange,
              worktreePath: spec.metadata?.runRoot || spec.cwd || cwd
            });
            readinessMarker = readinessMarkerFromSpec(spec);
            outputResultsMarker = String(spec.metadata?.outputResultsMarker || "").trim();
            const webOutput = String(spec.metadata?.outputPresentationKind || "").trim() === "web";
            const previewPublicOrigin = webOutput
              ? previewPublicOriginForLaunch({
                  env,
                  publicHost: input.publicHost,
                  publicProtocol: input.publicProtocol,
                  sessionId
                })
              : "";
            let launchReadyConfirmed = false;
            await closeStoppedLaunchTerminals(sessionId);
            const existingReusableTerminal = forceRestart
              ? null
              : reusableLaunchTerminal(sessionId, {
                  launchEnvHash,
                  outputTargetId: outputTarget.id,
                  namespace,
                  spec
                });
            await cleanupSupersededLaunchTerminals({
              launchPreviewProxies,
              namespace,
              reusableTerminal: existingReusableTerminal,
              sessionId
            });
            terminalSession = await runCommand({
              actor: "daemon",
              allowedRoots: commandAllowedRoots,
              args: spec.args || [],
              command: spec.command,
              cwd: spec.cwd || cwd,
              env: launchEnvironment.env,
              envPolicy: webOutput ? "preview" : "project",
              execution: outputTargetExecutionDescriptor(outputTarget, spec),
              mode: "pty",
              project: commandProject,
              purpose: webOutput ? "preview" : "output",
              runtimes: webOutput ? previewRuntimesForSpec(spec) : normalizeRuntimeList(spec.runtimes),
              session: context.session || {},
              terminal: {
                commandPreview: spec.commandPreview,
                maxRunning: 1,
                metadata: {
                  ...(spec.metadata || {}),
                  attemptedCommand: commandPreview,
                  envHash: launchEnvHash,
                  ...(launchRestartBaseline ? { launchRestartBaseline } : {}),
                  outputTargetId: outputTarget.id,
                  outputTargetLabel: outputTarget.label,
                  ...(previewPublicOrigin ? { previewPublicOrigin } : {}),
                  sessionId,
                  ...terminalNoGithubActorMetadata({
                    ownerUserKey: "output-target",
                    reason: "output-target"
                  })
                },
                namespace,
                namespaceLimitPrefix: namespace,
                onClose: async (event) => {
                  if (event.reason === "exit" && event.exitCode === 0) {
                    await captureOutputResults({
                      context,
                      outputTarget,
                      spec,
                      terminalSessionId: event.id,
                      updateMetadata: (metadata) => updateTerminalSessionMetadata(event.id, metadata, {
                        namespace
                      })
                    });
                  }
                  if (event.reason === "exit") {
                    await writePreviewDiagnostic(context.session, {
                      ...diagnosticBase,
                      commandPreview,
                      exitCode: event.exitCode ?? null,
                      outputTargetId: outputTarget.id,
                      outputTail: event.output,
                      reason: event.exitCode === 0 ? "process_exited" : "process_exited_nonzero",
                      status: event.exitCode === 0 ? "exited" : "failed",
                      terminalSessionId: event.id
                    });
                  }
                  await launchPreviewProxies.close({
                    sessionId,
                    terminalSessionId: event.id
                  });
                  const metadataCleared = await clearLaunchMetadataForTerminal(context.store, sessionId, event.id);
                  if (metadataCleared) {
                    await publishSessionChanged(sessionId, {
                      reason: "output-target-stale-cleared"
                    });
                  }
                  if (typeof spec.onClose === "function") {
                    await spec.onClose(event);
                  }
                },
                onStop: async (event) => {
                  await writePreviewDiagnostic(context.session, {
                    ...diagnosticBase,
                    commandPreview,
                    exitCode: event.exitCode ?? null,
                    outputTargetId: outputTarget.id,
                    outputTail: event.output,
                    reason: "process_stopped",
                    status: "stopped",
                    terminalSessionId: event.id
                  });
                  await launchPreviewProxies.close({
                    sessionId,
                    terminalSessionId: event.id
                  });
                  const metadataCleared = await clearLaunchMetadataForTerminal(context.store, sessionId, event.id);
                  if (metadataCleared) {
                    await publishSessionChanged(sessionId, {
                      reason: "output-target-stale-cleared"
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
                  void writePreviewDiagnostic(context.session, {
                    ...diagnosticBase,
                    commandPreview,
                    outputTargetId: outputTarget.id,
                    outputTail: output,
                    reason: "process_output",
                    status: "running",
                    terminalSessionId: runningTerminalSession.id
                  }, {
                    append: false
                  });
                  if (outputResultsMarkerLineSeen(output, outputResultsMarker)) {
                    void captureOutputResults({
                      context,
                      outputTarget,
                      spec,
                      terminalSessionId: runningTerminalSession.id,
                      updateMetadata
                    });
                  }
                  if (!readinessMarker || launchReadyConfirmed || !launchReadinessMarkerLineSeen(output, readinessMarker)) {
                    return;
                  }
                  void markLaunchReady({
                    namespace,
                    publishSessionChanged,
                    source: "marker",
                    store: context.store,
                    sessionId,
                    terminalSession: runningTerminalSession,
                    updateMetadata
                  }).then(async (result) => {
                    launchReadyConfirmed = result?.ready === true;
                    if (launchReadyConfirmed) {
                      await ensureReadyLaunchPreviewProxy(
                        context,
                        result.terminal || runningTerminalSession,
                        { source: "marker" }
                      );
                    }
                  }).catch((error) => {
                    vibe64SessionDebugLog("server.outputTargetTerminal.readyMarker.error", {
                      error: vibe64SessionDebugError(error),
                      sessionId,
                      terminalSessionId: runningTerminalSession.id
                    }, {
                      level: "warn"
                    });
                  });
                },
                reuseRunning: forceRestart
                  ? false
                  : (runningSession) => {
                      return launchTerminalCanBeReused(runningSession, {
                        launchEnvHash,
                        outputTargetId: outputTarget.id,
                        spec
                      });
                    }
              }
            });
          } catch (error) {
            releaseLaunchSpecReservation(spec);
            await writePreviewDiagnostic(context.session, {
              ...diagnosticBase,
              commandPreview,
              error,
              outputTargetId: outputTarget.id,
              reason: "terminal_start_failed",
              status: "failed"
            });
            throw error;
          }
          if (
            terminalSession?.ok === false ||
            (spec.metadata?.port && String(terminalSession?.metadata?.port || "") !== String(spec.metadata.port))
          ) {
            releaseLaunchSpecReservation(spec);
          }
          if (terminalSession?.ok === false) {
            await writePreviewDiagnostic(context.session, {
              ...diagnosticBase,
              commandPreview,
              error: terminalSession.error || "Output target terminal could not start.",
              outputTargetId: outputTarget.id,
              reason: "terminal_start_rejected",
              status: "failed"
            });
          } else {
            await writePreviewDiagnostic(context.session, {
              ...diagnosticBase,
              commandPreview,
              outputTargetId: outputTarget.id,
              reason: "terminal_started",
              status: "running",
              terminalSessionId: terminalSession.id
            });
          }
          if (terminalSession?.ok !== false && launchTerminalIsReady(terminalSession, readinessMarker)) {
            await writeLaunchMetadata(context.store, sessionId, terminalSession);
            await writePreviewDiagnostic(context.session, {
              ...diagnosticBase,
              commandPreview,
              outputTargetId: outputTarget.id,
              reason: "launch_ready",
              status: "ready",
              terminalSessionId: terminalSession.id
            });
            await ensureReadyLaunchPreviewProxy(context, terminalSession, {
              source: "start"
            });
          }
          return terminalSession;
        } finally {
          admission.release();
        }
      }));
    },

    async stopTerminal(sessionId, terminalSessionId) {
      if (previewTestRuns.has(sessionId)) {
        return { ok: false, code: "vibe64_preview_test_busy", error: "Browser tests own this Preview. Stop the test command before stopping Preview." };
      }
      await launchPreviewProxies.close({
        sessionId,
        terminalSessionId
      });
      const result = stopTerminalSession(terminalSessionId, {
        namespace: outputTargetTerminalNamespace(sessionId)
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
        namespace: outputTargetTerminalNamespace(sessionId)
      });
    },

    writeTerminal(sessionId, terminalSessionId, data) {
      return writeTerminalSession(terminalSessionId, data, {
        namespace: outputTargetTerminalNamespace(sessionId)
      });
    },

    resizeTerminal(sessionId, terminalSessionId, size) {
      return resizeTerminalSession(terminalSessionId, size, {
        namespace: outputTargetTerminalNamespace(sessionId)
      });
    }
  };
  return Object.freeze(controller);
}

function previewPublicOriginForLaunch({
  env = process.env,
  previewPublicDomain = "",
  publicHost = "",
  publicProtocol = "",
  publicUserDomain = "",
  sessionId = ""
} = {}) {
  const hostname = normalizeHostName(String(publicHost || "").trim());
  if (hostname && isLoopbackAddress(hostname)) {
    return "";
  }
  const configuredUserDomain = normalizePublicHostDomain(publicUserDomain || env?.[VIBE64_PUBLIC_USER_DOMAIN_ENV] || "");
  const configuredWorkspace = String(env?.[VIBE64_WORKSPACE_ENV] || "").trim().toLowerCase();
  const studioHostMatch = hostname
    ? studioHostMatchForPreview(hostname, {
        publicUserDomain: configuredUserDomain
      })
    : configuredUserDomain && validPreviewWorkspace(configuredWorkspace)
      ? {
          baseDomain: configuredUserDomain,
          workspace: configuredWorkspace
        }
      : null;
  if (!studioHostMatch) {
    return "";
  }
  const workspace = studioHostMatch.workspace;
  const protocol = normalizePublicProtocol(
    env?.[VIBE64_PUBLIC_PROTOCOL_ENV] ||
      publicProtocol ||
      DEFAULT_PUBLIC_PROTOCOL
  );
  const configuredPreviewDomain = String(
    previewPublicDomain || env?.[VIBE64_PREVIEW_PUBLIC_DOMAIN_ENV] || ""
  ).trim();
  let baseDomain = normalizePublicDomain(
    configuredPreviewDomain ||
      previewPublicBaseDomain(studioHostMatch.baseDomain)
  );
  if (!configuredPreviewDomain) {
    const requestPort = publicDomainPort(
      normalizePublicDomain(publicHost || configuredUserDomain),
      protocol
    );
    if (requestPort) {
      baseDomain = `${baseDomain}:${requestPort}`;
    }
  }
  if (!baseDomain) {
    return "";
  }
  const hashInput = [
    terminalProjectScopeKey(),
    sessionId
  ];
  const publicPort = publicDomainPort(baseDomain, protocol);
  if (publicPort) {
    hashInput.push(`public-port:${publicPort}`);
  }
  const hash = stableHash(hashInput.join("\n")).replace(/[^a-z0-9]/giu, "").toLowerCase().slice(0, 12);
  if (!hash) {
    return "";
  }
  return `${protocol}://${PREVIEW_PUBLIC_HOST_PREFIX}-${hash}--${workspace}.${baseDomain}`;
}

function studioHostMatchForPreview(hostname = "", {
  publicUserDomain = ""
} = {}) {
  const normalizedHostname = normalizePublicHostDomain(hostname);
  const normalizedUserDomain = normalizePublicHostDomain(publicUserDomain);
  if (normalizedUserDomain) {
    const suffix = `.${normalizedUserDomain}`;
    if (!normalizedHostname.endsWith(suffix)) {
      return null;
    }
    const workspace = normalizedHostname.slice(0, -suffix.length);
    return validPreviewWorkspace(workspace)
      ? {
          baseDomain: normalizedUserDomain,
          workspace
        }
      : null;
  }
  const match = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.([a-z0-9][a-z0-9.-]*[a-z0-9])$/u.exec(normalizedHostname);
  return match
    ? {
        baseDomain: match[2],
        workspace: match[1]
      }
    : null;
}

function validPreviewWorkspace(value = "") {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(String(value || "").trim());
}

function normalizePublicProtocol(value = "") {
  return String(value || "").trim().toLowerCase().replace(/:$/u, "") === "http"
    ? "http"
    : "https";
}

function normalizePublicDomain(value = "") {
  const text = String(value || "").trim().toLowerCase();
  if (!text) {
    return "";
  }
  try {
    return new URL(text.includes("://") ? text : `http://${text}`).host.replace(/\.+$/u, "");
  } catch {
    return text.replace(/^\/*/u, "").replace(/\/*$/u, "").replace(/\.+$/u, "");
  }
}

function publicDomainPort(domain = "", protocol = "https") {
  try {
    return new URL(`${protocol}://${domain}`).port;
  } catch {
    return "";
  }
}

function normalizePublicHostDomain(value = "") {
  const domain = normalizePublicDomain(value);
  if (!domain || domain.startsWith("[")) {
    return "";
  }
  return domain.replace(/:\d+$/u, "");
}

function previewPublicBaseDomain(studioBaseDomain = "") {
  const baseDomain = String(studioBaseDomain || "").trim().toLowerCase();
  if (baseDomain.startsWith("users.")) {
    return baseDomain.slice("users.".length);
  }
  return baseDomain;
}

export {
  OUTPUT_METADATA,
  cleanupSupersededLaunchTerminals,
  createLaunchRestartBaseline,
  createOutputTargetSpec,
  launchActionsFromOutput,
  launchReadinessMarkerLineSeen,
  launchRestartState,
  listOutputTargets,
  outputTargetExecutionDescriptor,
  previewIdentityCommandRunnerForLaunchTerminal,
  previewPublicOriginForLaunch,
  workspaceSetupLaunchDisabledReason,
  createOutputTargetTerminalController
};
