import { vibe64RealtimeOriginPayload } from "./vibe64BrowserTabOrigin.js";
import {
  VIBE64_SURFACE_ID
} from "@/lib/vibe64RequestConfig.js";
import {
  vibe64ProjectScopedStorageKey,
  vibe64ProjectQueryScope
} from "@/lib/vibe64ProjectScope.js";

const VIBE64_SESSIONS_API_SUFFIX = "/vibe64/sessions";
const VIBE64_ARCHIVED_SESSIONS_API_SUFFIX = `${VIBE64_SESSIONS_API_SUFFIX}/archived`;
const VIBE64_ASSISTANTS_API_SUFFIX = "/vibe64/assistants/capabilities";
const VIBE64_ASSISTANT_MODEL_ACCESS_API_SUFFIX = "/vibe64/assistants/model-access";
const VIBE64_CURRENT_SESSION_API_SUFFIX = `${VIBE64_SESSIONS_API_SUFFIX}/current`;
const VIBE64_API_SUFFIX = "/vibe64";
const VIBE64_SESSION_CHANGED_EVENT = "vibe64.session.changed";
const VIBE64_SOURCE_EDITOR_FILE_CHANGED_EVENT = "vibe64.source-editor.file.changed";
const VIBE64_SOURCE_EDITOR_SYNC_ERROR_EVENT = "vibe64.source-editor.sync.error";
const VIBE64_SOURCE_EDITOR_SYNC_READY_EVENT = "vibe64.source-editor.sync.ready";
const DEFAULT_MAX_OPEN_SESSIONS = 3;
const SELECTED_SESSION_STORAGE_KEY = "vibe64:selected-session-id";

function agentTurnControlPayloadFromContext(context = {}) {
  const source = context && typeof context === "object" && !Array.isArray(context) ? context : {};
  const {
    agentSettings: _agentSettings,
    sessionId: _sessionId,
    ...body
  } = source;
  return vibe64RealtimeOriginPayload({
    ...body,
    ...agentSettingsInputFromContext(source)
  });
}

function selectedSessionStorageKey(projectSlug) {
  return vibe64ProjectScopedStorageKey(SELECTED_SESSION_STORAGE_KEY, projectSlug);
}

function vibe64SessionsQueryKey(surfaceId, ownershipFilter, projectSlug) {
  return ["vibe64", ...vibe64ProjectQueryScope(projectSlug), surfaceId, ownershipFilter, "sessions"];
}

function vibe64SessionQueryKey(surfaceId, ownershipFilter, projectSlug) {
  return ["vibe64", ...vibe64ProjectQueryScope(projectSlug), surfaceId, ownershipFilter, "session"];
}

function vibe64AssistantCapabilitiesQueryKey(
  surfaceId,
  ownershipFilter,
  projectSlug,
  scope = "overview"
) {
  return [
    "vibe64",
    ...vibe64ProjectQueryScope(projectSlug),
    surfaceId,
    ownershipFilter,
    "assistant-capabilities",
    String(scope || "overview")
  ];
}

function encodePathSegment(value = "") {
  return encodeURIComponent(String(value || "").trim());
}

function vibe64SessionPath(sessionsApiPath = "", sessionId = "", suffix = "") {
  return `${sessionsApiPath}/${encodePathSegment(sessionId)}${suffix}`;
}

function vibe64AssistantModelAccessPath(capabilitiesApiPath = "") {
  return String(capabilitiesApiPath || "").replace(
    /\/assistants\/capabilities(?=\?|#|$)/u,
    "/assistants/model-access"
  );
}

function vibe64RepositoryApiPath(sessionsApiPath = "") {
  const normalized = String(sessionsApiPath || "").replace(/\/+$/u, "");
  return normalized.endsWith(VIBE64_SESSIONS_API_SUFFIX)
    ? `${normalized.slice(0, -VIBE64_SESSIONS_API_SUFFIX.length)}/vibe64/repository`
    : `${normalized}/repository`;
}

function vibe64RepositoryHistoryPath(sessionsApiPath = "", options = {}) {
  const params = new URLSearchParams();
  const sessionId = String(options?.sessionId || "").trim();
  const cursor = String(options?.cursor || "").trim();
  if (sessionId) {
    params.set("sessionId", sessionId);
  }
  if (cursor) {
    params.set("cursor", cursor);
  }
  const query = params.toString();
  const base = `${vibe64RepositoryApiPath(sessionsApiPath)}/history`;
  return query ? `${base}?${query}` : base;
}

function vibe64RepositoryVersionFilesPath(
  sessionsApiPath = "",
  commit = "",
  options = {}
) {
  const params = new URLSearchParams();
  const sessionId = String(options?.sessionId || "").trim();
  const historySnapshotCommit = String(options?.historySnapshotCommit || "").trim();
  if (sessionId) {
    params.set("sessionId", sessionId);
  }
  if (historySnapshotCommit) {
    params.set("historySnapshotCommit", historySnapshotCommit);
  }
  if (Number.isInteger(Number(options?.offset)) && Number(options.offset) > 0) {
    params.set("offset", String(Number(options.offset)));
  }
  if (Number.isInteger(Number(options?.limit)) && Number(options.limit) > 0) {
    params.set("limit", String(Number(options.limit)));
  }
  const query = params.toString();
  const base = `${vibe64RepositoryApiPath(sessionsApiPath)}/history/${encodePathSegment(commit)}/files`;
  return query ? `${base}?${query}` : base;
}

function vibe64RepositoryVersionDiffPath(
  sessionsApiPath = "",
  commit = "",
  sourcePath = "",
  options = {}
) {
  const params = new URLSearchParams({ path: String(sourcePath || "") });
  const sessionId = String(options?.sessionId || "").trim();
  const historySnapshotCommit = String(options?.historySnapshotCommit || "").trim();
  if (sessionId) {
    params.set("sessionId", sessionId);
  }
  if (historySnapshotCommit) {
    params.set("historySnapshotCommit", historySnapshotCommit);
  }
  return `${vibe64RepositoryApiPath(sessionsApiPath)}/history/${encodePathSegment(commit)}/diff?${params.toString()}`;
}

function vibe64SessionChangesPath(sessionsApiPath = "", sessionId = "", options = {}) {
  const params = new URLSearchParams();
  if (Number.isInteger(Number(options?.offset)) && Number(options.offset) > 0) {
    params.set("offset", String(Number(options.offset)));
  }
  if (Number.isInteger(Number(options?.limit)) && Number(options.limit) > 0) {
    params.set("limit", String(Number(options.limit)));
  }
  const query = params.toString();
  const base = vibe64SessionPath(sessionsApiPath, sessionId, "/changes");
  return query ? `${base}?${query}` : base;
}

function vibe64SessionCheckUpdatesPath(sessionsApiPath = "", sessionId = "") {
  return vibe64SessionPath(sessionsApiPath, sessionId, "/updates/check");
}

function vibe64SessionChangeDiffPath(
  sessionsApiPath = "",
  sessionId = "",
  sourcePath = ""
) {
  return `${vibe64SessionPath(sessionsApiPath, sessionId, "/changes/diff")}?path=${encodeURIComponent(String(sourcePath || ""))}`;
}

function vibe64AgentAttachmentPath(sessionsApiPath = "", sessionId = "") {
  return vibe64SessionPath(sessionsApiPath, sessionId, "/agent-attachments");
}

function vibe64AgentAttachmentFilePath(
  sessionsApiPath = "",
  sessionId = "",
  attachmentId = ""
) {
  return `${vibe64AgentAttachmentPath(sessionsApiPath, sessionId)}/${encodePathSegment(attachmentId)}`;
}

function vibe64TemporaryConversationsPath(sessionsApiPath = "", sessionId = "") {
  return vibe64SessionPath(sessionsApiPath, sessionId, "/temporary-conversations");
}

function vibe64TemporaryConversationPath(
  sessionsApiPath = "",
  sessionId = "",
  conversationId = ""
) {
  return `${vibe64TemporaryConversationsPath(sessionsApiPath, sessionId)}/${encodePathSegment(conversationId)}`;
}

function vibe64TemporaryConversationTurnsPath(
  sessionsApiPath = "",
  sessionId = "",
  conversationId = ""
) {
  return `${vibe64TemporaryConversationPath(sessionsApiPath, sessionId, conversationId)}/turns`;
}

function vibe64TemporaryConversationStopPath(
  sessionsApiPath = "",
  sessionId = "",
  conversationId = ""
) {
  return `${vibe64TemporaryConversationPath(sessionsApiPath, sessionId, conversationId)}/stop`;
}

function vibe64AgentTerminalPath(sessionsApiPath = "", sessionId = "", terminalSessionId = "") {
  return vibe64SessionPath(
    sessionsApiPath,
    sessionId,
    terminalSessionId ? `/agent-terminal/${encodePathSegment(terminalSessionId)}` : "/agent-terminal"
  );
}

function vibe64AgentTerminalControlTextPath(
  sessionsApiPath = "",
  sessionId = "",
  terminalSessionId = ""
) {
  return `${vibe64AgentTerminalPath(
    sessionsApiPath,
    sessionId,
    terminalSessionId
  )}/control/text`;
}

function vibe64GlobalCodexTerminalPath(vibe64ApiPath = "", terminalSessionId = "") {
  return terminalSessionId
    ? `${vibe64ApiPath}/codex-terminal/${encodePathSegment(terminalSessionId)}`
    : `${vibe64ApiPath}/codex-terminal`;
}

function vibe64AgentSessionsReconcilePath(vibe64ApiPath = "") {
  return `${vibe64ApiPath}/agent-sessions/reconcile`;
}

function vibe64ConversationLogPath(sessionsApiPath = "", sessionId = "") {
  return vibe64SessionPath(sessionsApiPath, sessionId, "/conversation-log");
}

function vibe64SessionPromptHintsPath(sessionsApiPath = "", sessionId = "") {
  return vibe64SessionPath(sessionsApiPath, sessionId, "/prompt-hints");
}

function vibe64SessionPromptHintsCancelPath(sessionsApiPath = "", sessionId = "") {
  return `${vibe64SessionPromptHintsPath(sessionsApiPath, sessionId)}/cancel`;
}

function vibe64SessionPreviewStatePath(sessionsApiPath = "", sessionId = "") {
  return vibe64SessionPath(sessionsApiPath, sessionId, "/preview-state");
}

function vibe64OutputOpenPath(sessionsApiPath = "", sessionId = "") {
  return vibe64SessionPath(sessionsApiPath, sessionId, "/output-runs/open");
}

function vibe64OutputsPath(sessionsApiPath = "", sessionId = "") {
  return vibe64SessionPath(sessionsApiPath, sessionId, "/outputs");
}

function vibe64PreviewIdentityPath(sessionsApiPath = "", sessionId = "") {
  return vibe64SessionPath(sessionsApiPath, sessionId, "/preview-identity");
}

function vibe64OutputRunPath(sessionsApiPath = "", sessionId = "", terminalSessionId = "") {
  return vibe64SessionPath(
    sessionsApiPath,
    sessionId,
    terminalSessionId
      ? `/output-runs/${encodePathSegment(terminalSessionId)}/terminal`
      : "/output-runs"
  );
}

function vibe64OutputRunStopPath(sessionsApiPath = "", sessionId = "", terminalSessionId = "") {
  return vibe64SessionPath(
    sessionsApiPath,
    sessionId,
    `/output-runs/${encodePathSegment(terminalSessionId)}/stop`
  );
}

function vibe64OutputResultPath(sessionsApiPath = "", sessionId = "", resultId = "") {
  return vibe64SessionPath(
    sessionsApiPath,
    sessionId,
    `/output-results/${encodePathSegment(resultId)}`
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

function vibe64SourceEditorCreateFilePath(sessionsApiPath = "", sessionId = "") {
  return vibe64SessionPath(sessionsApiPath, sessionId, "/source-editor/file");
}

function vibe64SourceEditorStarsPath(sessionsApiPath = "", sessionId = "") {
  return vibe64SessionPath(sessionsApiPath, sessionId, "/source-editor/stars");
}

function vibe64SourceEditorDownloadPath(sessionsApiPath = "", sessionId = "", sourcePath = "") {
  return `${vibe64SessionPath(sessionsApiPath, sessionId, "/source-editor/download")}?path=${encodeURIComponent(sourcePath)}`;
}

function vibe64SourceEditorChangesStreamPath(sessionsApiPath = "", sessionId = "", sourcePath = "") {
  const basePath = vibe64SessionPath(sessionsApiPath, sessionId, "/source-editor/changes/stream");
  const normalizedPath = String(sourcePath || "").trim();
  return normalizedPath ? `${basePath}?path=${encodeURIComponent(normalizedPath)}` : basePath;
}

function vibe64SourceEditorExplanationsPath(sessionsApiPath = "", sessionId = "") {
  return vibe64SessionPath(sessionsApiPath, sessionId, "/source-editor/explanations");
}

function vibe64SourceEditorExplanationsStreamPath(sessionsApiPath = "", sessionId = "") {
  return `${vibe64SourceEditorExplanationsPath(sessionsApiPath, sessionId)}/stream`;
}

function vibe64SourceEditorExplanationsCleanupPath(sessionsApiPath = "", sessionId = "") {
  return `${vibe64SourceEditorExplanationsPath(sessionsApiPath, sessionId)}/cleanup`;
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

function vibe64OutputsQueryKey(surfaceId, ownershipFilter, sessionId = "", projectSlug) {
  return [
    "vibe64",
    ...vibe64ProjectQueryScope(projectSlug),
    surfaceId,
    ownershipFilter,
    "outputs",
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

export {
  agentTurnControlPayloadFromContext,
  VIBE64_ASSISTANTS_API_SUFFIX,
  VIBE64_ARCHIVED_SESSIONS_API_SUFFIX,
  VIBE64_ASSISTANT_MODEL_ACCESS_API_SUFFIX,
  VIBE64_SESSION_CHANGED_EVENT,
  VIBE64_SOURCE_EDITOR_FILE_CHANGED_EVENT,
  VIBE64_SOURCE_EDITOR_SYNC_ERROR_EVENT,
  VIBE64_SOURCE_EDITOR_SYNC_READY_EVENT,
  VIBE64_API_SUFFIX,
  VIBE64_CURRENT_SESSION_API_SUFFIX,
  VIBE64_SESSIONS_API_SUFFIX,
  VIBE64_SURFACE_ID,
  DEFAULT_MAX_OPEN_SESSIONS,
  SELECTED_SESSION_STORAGE_KEY,
  agentSettingsInputFromContext,
  vibe64AgentAttachmentFilePath,
  vibe64AgentAttachmentPath,
  vibe64AssistantCapabilitiesQueryKey,
  vibe64AssistantModelAccessPath,
  vibe64AgentTerminalControlTextPath,
  vibe64AgentSessionsReconcilePath,
  vibe64AgentTerminalPath,
  vibe64ConversationLogPath,
  vibe64ConversationLogQueryKey,
  vibe64SessionPromptHintsCancelPath,
  vibe64SessionPromptHintsPath,
  vibe64SessionPreviewStatePath,
  vibe64GlobalCodexTerminalPath,
  vibe64OutputOpenPath,
  vibe64OutputResultPath,
  vibe64OutputRunPath,
  vibe64OutputRunStopPath,
  vibe64OutputsPath,
  vibe64OutputsQueryKey,
  vibe64PreviewIdentityPath,
  vibe64RepositoryApiPath,
  vibe64RepositoryHistoryPath,
  vibe64RepositoryVersionDiffPath,
  vibe64RepositoryVersionFilesPath,
  vibe64SessionChangeDiffPath,
  vibe64SessionCheckUpdatesPath,
  vibe64SessionChangesPath,
  vibe64SessionPath,
  vibe64SessionQueryKey,
  selectedSessionStorageKey,
  vibe64SourceEditorCreateFilePath,
  vibe64SourceEditorDownloadPath,
  vibe64SourceEditorStarsPath,
  vibe64SourceEditorChangesStreamPath,
  vibe64SourceEditorExplanationFollowupsPath,
  vibe64SourceEditorExplanationFollowupsStreamPath,
  vibe64SourceEditorExplanationPath,
  vibe64SourceEditorExplanationStopPath,
  vibe64SourceEditorExplanationsCleanupPath,
  vibe64SourceEditorExplanationsPath,
  vibe64SourceEditorExplanationsStreamPath,
  vibe64SourceEditorFilesPath,
  vibe64SourceEditorFilePath,
  vibe64SourceEditorResolvePathPath,
  vibe64SourceEditorSearchPath,
  vibe64SourceEditorTreePath,
  vibe64TemporaryConversationPath,
  vibe64TemporaryConversationsPath,
  vibe64TemporaryConversationStopPath,
  vibe64TemporaryConversationTurnsPath,
  vibe64SessionsQueryKey
};
