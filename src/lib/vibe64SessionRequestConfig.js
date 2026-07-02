import {
  VIBE64_SURFACE_ID
} from "@/lib/vibe64RequestConfig.js";
import {
  vibe64ProjectScopedStorageKey,
  vibe64ProjectQueryScope
} from "@/lib/vibe64ProjectScope.js";

const VIBE64_SESSIONS_API_SUFFIX = "/vibe64/sessions";
const VIBE64_API_SUFFIX = "/vibe64";
const VIBE64_SESSION_CHANGED_EVENT = "vibe64.session.changed";
const VIBE64_COMPOSER_CHANGED_EVENT = "vibe64.composer.changed";
const VIBE64_SESSION_VIEW_CHANGED_EVENT = "vibe64.session.view.changed";
const VIBE64_SOURCE_EDITOR_FILE_CHANGED_EVENT = "vibe64.source-editor.file.changed";
const VIBE64_SOURCE_EDITOR_FILE_OPENED_EVENT = "vibe64.source-editor.file.opened";
const DEFAULT_MAX_OPEN_SESSIONS = 3;
const SELECTED_SESSION_STORAGE_KEY = "vibe64:selected-session-id";

function selectedSessionStorageKey(projectSlug) {
  return vibe64ProjectScopedStorageKey(SELECTED_SESSION_STORAGE_KEY, projectSlug);
}

function vibe64SessionsQueryKey(surfaceId, ownershipFilter, projectSlug) {
  return ["vibe64", ...vibe64ProjectQueryScope(projectSlug), surfaceId, ownershipFilter, "sessions"];
}

function vibe64SessionQueryKey(surfaceId, ownershipFilter, projectSlug) {
  return ["vibe64", ...vibe64ProjectQueryScope(projectSlug), surfaceId, ownershipFilter, "session"];
}

function encodePathSegment(value = "") {
  return encodeURIComponent(String(value || "").trim());
}

function vibe64SessionPath(sessionsApiPath = "", sessionId = "", suffix = "") {
  return `${sessionsApiPath}/${encodePathSegment(sessionId)}${suffix}`;
}

function vibe64ProjectToolPath(vibe64ApiPath = "", toolId = "", suffix = "") {
  return `${vibe64ApiPath}/tools/${encodePathSegment(toolId)}${suffix}`;
}

function vibe64ProjectToolRunPath(vibe64ApiPath = "", toolId = "") {
  return vibe64ProjectToolPath(vibe64ApiPath, toolId, "/run");
}

function vibe64ProjectToolFixPath(vibe64ApiPath = "", toolId = "") {
  return vibe64ProjectToolPath(vibe64ApiPath, toolId, "/fix");
}

function vibe64ProjectToolTerminalPath(vibe64ApiPath = "", toolId = "", terminalSessionId = "") {
  return vibe64ProjectToolPath(
    vibe64ApiPath,
    toolId,
    terminalSessionId ? `/terminal/${encodePathSegment(terminalSessionId)}` : "/terminal"
  );
}

function vibe64ActionPath(sessionsApiPath = "", sessionId = "", actionId = "") {
  return vibe64SessionPath(sessionsApiPath, sessionId, `/actions/${encodePathSegment(actionId)}`);
}

function vibe64IntentPath(sessionsApiPath = "", sessionId = "", intentId = "") {
  return vibe64SessionPath(sessionsApiPath, sessionId, `/intents/${encodePathSegment(intentId)}`);
}

function vibe64ArtifactPreviewPath(sessionsApiPath = "", sessionId = "") {
  return vibe64SessionPath(sessionsApiPath, sessionId, "/artifact-preview");
}

function vibe64CodexAttachmentPath(sessionsApiPath = "", sessionId = "") {
  return vibe64SessionPath(sessionsApiPath, sessionId, "/codex-attachments");
}

function vibe64CodexTerminalPath(sessionsApiPath = "", sessionId = "", terminalSessionId = "") {
  return vibe64SessionPath(
    sessionsApiPath,
    sessionId,
    terminalSessionId ? `/codex-terminal/${encodePathSegment(terminalSessionId)}` : "/codex-terminal"
  );
}

function vibe64GlobalCodexTerminalPath(vibe64ApiPath = "", terminalSessionId = "") {
  return terminalSessionId
    ? `${vibe64ApiPath}/codex-terminal/${encodePathSegment(terminalSessionId)}`
    : `${vibe64ApiPath}/codex-terminal`;
}

function vibe64CodexThreadsReconcilePath(vibe64ApiPath = "") {
  return `${vibe64ApiPath}/codex-threads/reconcile`;
}

function vibe64ConversationLogPath(sessionsApiPath = "", sessionId = "") {
  return vibe64SessionPath(sessionsApiPath, sessionId, "/conversation-log");
}

function vibe64ComposerDraftPath(sessionsApiPath = "", sessionId = "") {
  return vibe64SessionPath(sessionsApiPath, sessionId, "/composer-draft");
}

function vibe64SessionViewStatePath(sessionsApiPath = "", sessionId = "") {
  return vibe64SessionPath(sessionsApiPath, sessionId, "/view-state");
}

function vibe64FixCodexTerminalPath(vibe64ApiPath = "", jobId = "", terminalSessionId = "") {
  const base = `${vibe64ApiPath}/fix-codex-jobs/${encodePathSegment(jobId)}/terminal`;
  return terminalSessionId ? `${base}/${encodePathSegment(terminalSessionId)}` : base;
}

function vibe64TerminalFailureFixPath(sessionsApiPath = "", sessionId = "") {
  return vibe64SessionPath(sessionsApiPath, sessionId, "/terminal-failure-fix");
}

function vibe64CommandTerminalPath(sessionsApiPath = "", sessionId = "", terminalSessionId = "") {
  return vibe64SessionPath(
    sessionsApiPath,
    sessionId,
    terminalSessionId ? `/command-terminal/${encodePathSegment(terminalSessionId)}` : "/command-terminal"
  );
}

function vibe64LaunchTargetOpenPath(sessionsApiPath = "", sessionId = "") {
  return vibe64SessionPath(sessionsApiPath, sessionId, "/launch-target/open");
}

function vibe64LaunchTargetsPath(sessionsApiPath = "", sessionId = "") {
  return vibe64SessionPath(sessionsApiPath, sessionId, "/launch-targets");
}

function vibe64LaunchTerminalPath(sessionsApiPath = "", sessionId = "", terminalSessionId = "") {
  return vibe64SessionPath(
    sessionsApiPath,
    sessionId,
    terminalSessionId ? `/launch-terminal/${encodePathSegment(terminalSessionId)}` : "/launch-terminal"
  );
}

function vibe64LaunchTerminalStopPath(sessionsApiPath = "", sessionId = "", terminalSessionId = "") {
  return `${vibe64LaunchTerminalPath(sessionsApiPath, sessionId, terminalSessionId)}/stop`;
}

function vibe64ShellTerminalPath(sessionsApiPath = "", sessionId = "", terminalSessionId = "") {
  return vibe64SessionPath(
    sessionsApiPath,
    sessionId,
    terminalSessionId ? `/shell-terminal/${encodePathSegment(terminalSessionId)}` : "/shell-terminal"
  );
}

function vibe64SourceEditorTreePath(sessionsApiPath = "", sessionId = "", options = {}) {
  const basePath = vibe64SessionPath(sessionsApiPath, sessionId, "/source-editor/tree");
  const params = new URLSearchParams();
  const normalizedPath = String(options?.path || "").trim();
  if (normalizedPath) {
    params.set("path", normalizedPath);
  }
  if (Number.isInteger(Number(options?.offset)) && Number(options.offset) > 0) {
    params.set("offset", String(Number(options.offset)));
  }
  if (Number.isInteger(Number(options?.limit)) && Number(options.limit) > 0) {
    params.set("limit", String(Number(options.limit)));
  }
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

function vibe64SourceEditorFilesPath(sessionsApiPath = "", sessionId = "", query = "") {
  const basePath = vibe64SessionPath(sessionsApiPath, sessionId, "/source-editor/files");
  const normalizedQuery = String(query || "").trim();
  return normalizedQuery ? `${basePath}?q=${encodeURIComponent(normalizedQuery)}` : basePath;
}

function vibe64SourceEditorSearchPath(sessionsApiPath = "", sessionId = "", query = "") {
  const basePath = vibe64SessionPath(sessionsApiPath, sessionId, "/source-editor/search");
  const normalizedQuery = String(query || "").trim();
  return normalizedQuery ? `${basePath}?q=${encodeURIComponent(normalizedQuery)}` : basePath;
}

function vibe64SourceEditorResolvePathPath(sessionsApiPath = "", sessionId = "") {
  return vibe64SessionPath(sessionsApiPath, sessionId, "/source-editor/resolve-path");
}

function vibe64SourceEditorFilePath(sessionsApiPath = "", sessionId = "", sourcePath = "") {
  const basePath = vibe64SessionPath(sessionsApiPath, sessionId, "/source-editor/file");
  const normalizedPath = String(sourcePath || "").trim();
  return normalizedPath ? `${basePath}?path=${encodeURIComponent(normalizedPath)}` : basePath;
}

function vibe64SourceEditorOpenFilePath(sessionsApiPath = "", sessionId = "") {
  return vibe64SessionPath(sessionsApiPath, sessionId, "/source-editor/open-file");
}

function vibe64SourceEditorExplanationsPath(sessionsApiPath = "", sessionId = "") {
  return vibe64SessionPath(sessionsApiPath, sessionId, "/source-editor/explanations");
}

function vibe64SourceEditorExplanationsStreamPath(sessionsApiPath = "", sessionId = "") {
  return `${vibe64SourceEditorExplanationsPath(sessionsApiPath, sessionId)}/stream`;
}

function vibe64SourceEditorExplanationPath(sessionsApiPath = "", sessionId = "", explanationId = "") {
  return vibe64SessionPath(
    sessionsApiPath,
    sessionId,
    `/source-editor/explanations/${encodePathSegment(explanationId)}`
  );
}

function vibe64SourceEditorExplanationFollowupsPath(sessionsApiPath = "", sessionId = "", explanationId = "") {
  return `${vibe64SourceEditorExplanationPath(sessionsApiPath, sessionId, explanationId)}/followups`;
}

function vibe64SourceEditorExplanationFollowupsStreamPath(sessionsApiPath = "", sessionId = "", explanationId = "") {
  return `${vibe64SourceEditorExplanationFollowupsPath(sessionsApiPath, sessionId, explanationId)}/stream`;
}

function vibe64SourceEditorExplanationStopPath(sessionsApiPath = "", sessionId = "", explanationId = "") {
  return `${vibe64SourceEditorExplanationPath(sessionsApiPath, sessionId, explanationId)}/stop`;
}

function vibe64ArtifactPreviewQueryKey(surfaceId, ownershipFilter, sessionId = "", previewId = "", projectSlug) {
  const key = [
    "vibe64",
    ...vibe64ProjectQueryScope(projectSlug),
    surfaceId,
    ownershipFilter,
    "artifact-preview",
    encodePathSegment(sessionId)
  ];
  const encodedPreviewId = encodePathSegment(previewId);
  if (encodedPreviewId) {
    key.push(encodedPreviewId);
  }
  return key;
}

function vibe64ConversationLogQueryKey(surfaceId, ownershipFilter, sessionId = "", projectSlug) {
  return [
    "vibe64",
    ...vibe64ProjectQueryScope(projectSlug),
    surfaceId,
    ownershipFilter,
    "conversation-log",
    encodePathSegment(sessionId)
  ];
}

function vibe64LaunchTargetsQueryKey(surfaceId, ownershipFilter, sessionId = "", projectSlug) {
  return [
    "vibe64",
    ...vibe64ProjectQueryScope(projectSlug),
    surfaceId,
    ownershipFilter,
    "launch-targets",
    encodePathSegment(sessionId)
  ];
}

function agentSettingsInputFromContext(context = {}) {
  return context?.agentSettings && typeof context.agentSettings === "object" && !Array.isArray(context.agentSettings)
    ? {
        agentSettings: context.agentSettings
      }
    : {};
}

function displayInputFromContext(context = {}) {
  return context?.displayInput && typeof context.displayInput === "object" && !Array.isArray(context.displayInput) &&
    Object.keys(context.displayInput).length > 0
    ? {
        displayInput: context.displayInput
      }
    : {};
}

function commandInputFromContext(context = {}) {
  const input = context?.input && typeof context.input === "object" && !Array.isArray(context.input)
    ? context.input
    : {};
  return {
    ...input,
    ...agentSettingsInputFromContext(context),
    ...displayInputFromContext(context)
  };
}

function normalizeVibe64ProjectToolFixInput(input = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  return {
    actionId: String(source.actionId || ""),
    actionLabel: String(source.actionLabel || ""),
    attemptedCommand: String(source.attemptedCommand || ""),
    closeError: String(source.closeError || ""),
    commandPreview: String(source.commandPreview || ""),
    exitCode: source.exitCode == null ? "" : String(source.exitCode),
    output: String(source.output || ""),
    terminalSessionId: String(source.terminalSessionId || ""),
    terminalStatus: String(source.terminalStatus || ""),
    toolId: String(source.toolId || ""),
    toolLabel: String(source.toolLabel || ""),
    userMessage: String(source.userMessage || "")
  };
}

export {
  VIBE64_SESSION_CHANGED_EVENT,
  VIBE64_COMPOSER_CHANGED_EVENT,
  VIBE64_SESSION_VIEW_CHANGED_EVENT,
  VIBE64_SOURCE_EDITOR_FILE_CHANGED_EVENT,
  VIBE64_SOURCE_EDITOR_FILE_OPENED_EVENT,
  VIBE64_API_SUFFIX,
  VIBE64_SESSIONS_API_SUFFIX,
  VIBE64_SURFACE_ID,
  DEFAULT_MAX_OPEN_SESSIONS,
  SELECTED_SESSION_STORAGE_KEY,
  vibe64ActionPath,
  vibe64ArtifactPreviewPath,
  vibe64ArtifactPreviewQueryKey,
  vibe64CodexAttachmentPath,
  vibe64CodexThreadsReconcilePath,
  vibe64CodexTerminalPath,
  vibe64CommandTerminalPath,
  vibe64ConversationLogPath,
  vibe64ConversationLogQueryKey,
  vibe64ComposerDraftPath,
  vibe64SessionViewStatePath,
  vibe64FixCodexTerminalPath,
  vibe64GlobalCodexTerminalPath,
  vibe64IntentPath,
  vibe64LaunchTargetOpenPath,
  vibe64LaunchTargetsPath,
  vibe64LaunchTargetsQueryKey,
  vibe64LaunchTerminalPath,
  vibe64LaunchTerminalStopPath,
  vibe64ProjectToolFixPath,
  vibe64ProjectToolRunPath,
  vibe64ProjectToolTerminalPath,
  vibe64SessionPath,
  vibe64SessionQueryKey,
  selectedSessionStorageKey,
  vibe64ShellTerminalPath,
  vibe64SourceEditorExplanationFollowupsPath,
  vibe64SourceEditorExplanationFollowupsStreamPath,
  vibe64SourceEditorExplanationPath,
  vibe64SourceEditorExplanationStopPath,
  vibe64SourceEditorExplanationsPath,
  vibe64SourceEditorExplanationsStreamPath,
  vibe64SourceEditorFilesPath,
  vibe64SourceEditorFilePath,
  vibe64SourceEditorOpenFilePath,
  vibe64SourceEditorResolvePathPath,
  vibe64SourceEditorSearchPath,
  vibe64SourceEditorTreePath,
  vibe64SessionsQueryKey,
  vibe64TerminalFailureFixPath,
  normalizeVibe64ProjectToolFixInput,
  agentSettingsInputFromContext,
  commandInputFromContext
};
