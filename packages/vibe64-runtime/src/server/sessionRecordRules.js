import { isDeepStrictEqual } from "node:util";
import { isPlainObject, vibe64Error } from "@local/vibe64-core/server/core";
import { deepFreeze } from "@local/vibe64-core/server/deepFreeze";
import { SESSION_RENEWAL_ID_PATTERN } from "./sessionRenewalIds.js";
import { toText } from "@local/vibe64-core/shared/toText";

// What a stored session record may hold: schema versions, statuses, session,
// metadata, agent-run and background-task ids and states, list filters,
// renewal archive links and learning-session bindings.

const VIBE64_SESSION_SCHEMA_VERSION = 2;
const VIBE64_SESSION_ARCHIVE_SCHEMA_VERSION = 2;
const SESSION_LABEL_METADATA = "label";
const LEARNING_SESSION_METADATA = "learning_session";
const SESSION_LABEL_MAX_LENGTH = 120;
const VIBE64_SESSION_STATUS = deepFreeze({
  ACTIVE: "active",
  ARCHIVED: "archived",
  BLOCKED: "blocked",
  RENEWAL_ACTIVATING: "renewal_activating",
  RENEWAL_PENDING: "renewal_pending",
  RENEWAL_QUIESCED: "renewal_quiesced"
});
const VIBE64_SESSION_STATUSES = new Set(Object.values(VIBE64_SESSION_STATUS));
const OPEN_VIBE64_SESSION_STATUSES = new Set([
  VIBE64_SESSION_STATUS.ACTIVE,
  VIBE64_SESSION_STATUS.BLOCKED,
  VIBE64_SESSION_STATUS.RENEWAL_QUIESCED
]);
const HIDDEN_VIBE64_SESSION_STATUSES = new Set([
  VIBE64_SESSION_STATUS.RENEWAL_ACTIVATING,
  VIBE64_SESSION_STATUS.RENEWAL_PENDING
]);
const RENEWAL_TRANSITION_VIBE64_SESSION_STATUSES = new Set([
  ...HIDDEN_VIBE64_SESSION_STATUSES,
  VIBE64_SESSION_STATUS.RENEWAL_QUIESCED
]);
const SESSION_ARCHIVE_KIND = "vibe64.session_archive";
const RENEWAL_ARCHIVE_SELECTION_METADATA = "renewal_selected_before_archive";
const RENEWAL_ARCHIVE_SELECTION_NONE = "none";
const SESSION_ARCHIVE_INDEX_METADATA_NAMES = Object.freeze([
  LEARNING_SESSION_METADATA,
  "repository_branch",
  "github_pull_request",
  "base_branch",
  "base_commit",
  "canonical_commit",
  "branch",
  "renewal_acknowledged_at",
  "renewal_activated_at",
  "renewal_actor_display_name",
  "renewal_actor_id",
  "renewal_archived_at",
  "renewal_confirmed_at",
  "renewal_finalized_at",
  "renewal_handover_delivered_at",
  "renewal_id",
  "renewal_quiesced_at",
  "renewal_quiesced_id",
  "renewal_restored_at",
  "renewal_restored_id",
  "renewal_rolled_back_at",
  "renewal_started_at",
  "renewal_successor_created_at",
  "renewed_at",
  "renewed_from",
  "renewed_to",
  "source_default_branch",
  "source_kind",
  "source_path",
  "source_recovery_base_branch",
  "source_recovery_base_commit",
  "source_recovery_branch",
  "source_recovery_bundle_artifact",
  "source_recovery_checkpoint_bundle_artifact",
  "source_recovery_default_branch",
  "source_recovery_dirty",
  "source_recovery_head",
  "source_recovery_kind",
  "source_recovery_patch_artifact",
  "source_recovery_remote_url",
  "source_recovery_saved",
  "source_recovery_saved_at",
  "source_recovery_session_name",
  "source_recovery_source_path",
  "source_recovery_untracked_artifact",
  "source_recovery_untracked_count",
  "source_remote_url",
  "source_removed"
]);
const SESSION_ARCHIVE_TIMEOUT_MS = 60_000;
const COMMAND_BUFFER_BYTES = 50 * 1024 * 1024;
const BACKGROUND_TASK_EVENT_LIMIT = 200;
const AGENT_RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,191}$/u;
const ARTIFACT_PATH_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u;
const BACKGROUND_TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,191}$/u;
const UUID_V4_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const SESSION_RENEWAL_STATE_FILE_PATTERN = /^([A-Za-z0-9][A-Za-z0-9_-]{0,127})\.json$/u;
const CONVERSATION_MESSAGE_ROLES = deepFreeze([
  "assistant",
  "commentary",
  "system",
  "thinking",
  "user"
]);
const CONVERSATION_MESSAGE_FILE_PATTERN =
  /^(user|assistant|commentary|system|thinking)\.(\d{8}T\d{9}Z)(?:\.([A-Za-z0-9][A-Za-z0-9_-]{0,127}))?\.md$/u;
const CONVERSATION_TURN_ID_PATTERN = /^\d{6}$/u;
const CONVERSATION_TURN_ATTACHMENTS_FILE = "attachments.json";
const CONVERSATION_TURN_METADATA_FILE = "metadata.json";
const SESSION_SOURCE_DESCRIPTOR_METADATA_NAMES = Object.freeze([
  "base_commit",
  "canonical_commit",
  "repository_mode",
  "source",
  "source_kind",
  "source_path",
  "source_path_authority",
  "source_removed"
]);
const METADATA_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u;
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const BACKGROUND_TASK_STATUS = Object.freeze({
  FAILED: "failed",
  READY: "ready",
  RUNNING: "running"
});
const BACKGROUND_TASK_STATUSES = new Set(Object.values(BACKGROUND_TASK_STATUS));
const VIBE64_AGENT_RUN_STATE = Object.freeze({
  ACTIVE: "active",
  CANCELLED: "cancelled",
  COMPLETED: "completed",
  FAILED: "failed",
  FINALIZING: "finalizing",
  INTERRUPTED: "interrupted",
  STARTING: "starting",
  TIMED_OUT: "timed_out"
});
const AGENT_RUN_STATES = new Set(Object.values(VIBE64_AGENT_RUN_STATE));
const TERMINAL_AGENT_RUN_STATES = new Set([
  VIBE64_AGENT_RUN_STATE.CANCELLED,
  VIBE64_AGENT_RUN_STATE.COMPLETED,
  VIBE64_AGENT_RUN_STATE.FAILED,
  VIBE64_AGENT_RUN_STATE.INTERRUPTED,
  VIBE64_AGENT_RUN_STATE.TIMED_OUT
]);

const ACTIVE_AGENT_RUN_STATES = new Set([
  VIBE64_AGENT_RUN_STATE.ACTIVE,
  VIBE64_AGENT_RUN_STATE.FINALIZING,
  VIBE64_AGENT_RUN_STATE.STARTING
]);

function isValidVibe64SessionId(sessionId) {
  const normalizedSessionId = toText(sessionId);
  return SESSION_ID_PATTERN.test(normalizedSessionId);
}

function isSafeAgentRunId(runId) {
  return AGENT_RUN_ID_PATTERN.test(toText(runId));
}

function isSafeBackgroundTaskId(taskId) {
  return BACKGROUND_TASK_ID_PATTERN.test(toText(taskId));
}

/**
 * A session id that is not one of this project's sessions: every caller
 * answers the same clean 404, whichever operation looked it up.
 */
function unknownSessionError(sessionId) {
  return Object.assign(vibe64Error(`Unknown vibe64 session: ${sessionId}`, "vibe64_session_not_found"), { statusCode: 404 });
}

function assertValidVibe64SessionId(sessionId) {
  const normalizedSessionId = toText(sessionId);
  if (!isValidVibe64SessionId(normalizedSessionId)) {
    throw vibe64Error(`Invalid vibe64 session id: ${normalizedSessionId || "(empty)"}`, "vibe64_invalid_session_id");
  }
  return normalizedSessionId;
}

function assertSafeMetadataName(name) {
  const normalizedName = toText(name);
  if (!METADATA_NAME_PATTERN.test(normalizedName)) {
    throw vibe64Error(`Invalid vibe64 metadata name: ${normalizedName || "(empty)"}`, "vibe64_invalid_metadata_name");
  }
  return normalizedName;
}

function assertSafeAgentRunId(runId) {
  const normalizedRunId = toText(runId);
  if (!isSafeAgentRunId(normalizedRunId)) {
    throw vibe64Error(
      `Invalid vibe64 agent run id: ${normalizedRunId || "(empty)"}`,
      "vibe64_invalid_agent_run_id"
    );
  }
  return normalizedRunId;
}

function assertSafeBackgroundTaskId(taskId) {
  const normalizedTaskId = toText(taskId);
  if (!isSafeBackgroundTaskId(normalizedTaskId)) {
    throw vibe64Error(
      `Invalid vibe64 background task id: ${normalizedTaskId || "(empty)"}`,
      "vibe64_invalid_background_task_id"
    );
  }
  return normalizedTaskId;
}

// Renewal markers a predecessor archive never keeps, and the handoff record it
// always carries; the prepared snapshot and the committed archive share both.
const RENEWAL_ARCHIVE_RESET_METADATA_NAMES = Object.freeze([
  "renewal_activated_at",
  "renewal_archived_at",
  "renewal_finalized_at",
  "renewal_restored_at",
  "renewal_restored_id",
  "renewal_rolled_back_at"
]);

function renewalArchiveMetadata(fromMetadata = {}, options = {}) {
  const {
    archivedAt = "",
    renewalId = "",
    selectedBeforeArchive = "",
    successorSessionId = ""
  } = options;
  return {
    renewal_acknowledged_at: toText(fromMetadata.renewal_acknowledged_at),
    renewal_actor_display_name: toText(fromMetadata.renewal_actor_display_name),
    renewal_actor_id: toText(fromMetadata.renewal_actor_id),
    renewal_archived_at: archivedAt,
    renewal_confirmed_at: toText(fromMetadata.renewal_confirmed_at),
    renewal_handover_delivered_at: toText(fromMetadata.renewal_handover_delivered_at),
    renewal_id: renewalId,
    renewal_started_at: toText(fromMetadata.renewal_started_at),
    renewal_successor_created_at: toText(fromMetadata.renewal_successor_created_at),
    renewed_at: toText(fromMetadata.renewed_at),
    renewed_to: successorSessionId,
    [RENEWAL_ARCHIVE_SELECTION_METADATA]: selectedBeforeArchive
  };
}

function assertRenewalSuccessorLink(metadata = {}, options = {}) {
  const { renewalId = "", sourceSessionId = "", successorSessionId = "" } = options;
  if (
    toText(metadata.renewal_id) !== renewalId ||
    toText(metadata.renewed_from) !== sourceSessionId
  ) {
    throw vibe64Error(
      `Renewal successor does not match renewal ${renewalId}: ${successorSessionId}`,
      "vibe64_session_renewal_link_mismatch"
    );
  }
}

function sessionIsUnfinishedRenewalRecord(session = {}) {
  const metadata = isPlainObject(session.metadata) ? session.metadata : {};
  const renewalId = session.status === VIBE64_SESSION_STATUS.RENEWAL_QUIESCED
    ? toText(metadata.renewal_quiesced_id)
    : toText(metadata.renewal_id);
  if (
    !SESSION_RENEWAL_ID_PATTERN.test(renewalId) ||
    (
      session.status !== VIBE64_SESSION_STATUS.RENEWAL_QUIESCED &&
      toText(metadata.renewal_finalized_at)
    )
  ) {
    return false;
  }
  if ([
    VIBE64_SESSION_STATUS.RENEWAL_ACTIVATING,
    VIBE64_SESSION_STATUS.RENEWAL_PENDING
  ].includes(session.status)) {
    return isValidVibe64SessionId(metadata.renewed_from);
  }
  if (session.status === VIBE64_SESSION_STATUS.RENEWAL_QUIESCED) {
    return Boolean(toText(metadata.renewal_quiesced_at));
  }
  if (session.status === VIBE64_SESSION_STATUS.ARCHIVED) {
    return isValidVibe64SessionId(metadata.renewed_to);
  }
  return session.status === VIBE64_SESSION_STATUS.ACTIVE &&
    isValidVibe64SessionId(metadata.renewed_from) &&
    !toText(metadata.renewed_to);
}

function normalizeVibe64AgentRunState(state) {
  const normalizedState = toText(state) || VIBE64_AGENT_RUN_STATE.STARTING;
  if (!AGENT_RUN_STATES.has(normalizedState)) {
    throw vibe64Error(
      `Invalid vibe64 agent run state: ${normalizedState}`,
      "vibe64_invalid_agent_run_state"
    );
  }
  return normalizedState;
}

function vibe64AgentRunStateIsActive(state) {
  return ACTIVE_AGENT_RUN_STATES.has(normalizeVibe64AgentRunState(state));
}

function vibe64AgentRunStateIsTerminal(state) {
  return TERMINAL_AGENT_RUN_STATES.has(normalizeVibe64AgentRunState(state));
}

function normalizeBackgroundTaskStatus(status) {
  const normalizedStatus = toText(status) || BACKGROUND_TASK_STATUS.RUNNING;
  if (!BACKGROUND_TASK_STATUSES.has(normalizedStatus)) {
    throw vibe64Error(
      `Invalid vibe64 background task status: ${normalizedStatus}`,
      "vibe64_invalid_background_task_status"
    );
  }
  return normalizedStatus;
}

function assertVibe64SessionStatus(status) {
  const normalizedStatus = toText(status) || VIBE64_SESSION_STATUS.ACTIVE;
  if (!VIBE64_SESSION_STATUSES.has(normalizedStatus)) {
    throw vibe64Error(`Invalid vibe64 session status: ${normalizedStatus}`, "vibe64_invalid_session_status");
  }
  return normalizedStatus;
}

function vibe64SessionStatusIsOpen(status) {
  return OPEN_VIBE64_SESSION_STATUSES.has(assertVibe64SessionStatus(status));
}

function vibe64SessionStatusIsHidden(status) {
  return HIDDEN_VIBE64_SESSION_STATUSES.has(assertVibe64SessionStatus(status));
}

function assertNormalSessionIsReadable(session = {}) {
  const status = assertVibe64SessionStatus(session.status);
  if (HIDDEN_VIBE64_SESSION_STATUSES.has(status)) {
    throw vibe64Error(
      `Vibe64 session is reserved for an in-progress renewal: ${toText(session.sessionId) || "(unknown)"}`,
      "vibe64_session_renewal_private"
    );
  }
  return session;
}

function assertNormalSessionIsMutable(session = {}) {
  const readable = assertNormalSessionIsReadable(session);
  if (readable.status === VIBE64_SESSION_STATUS.RENEWAL_QUIESCED) {
    throw vibe64Error(
      `Vibe64 session is read-only while its renewal is in progress: ${toText(session.sessionId) || "(unknown)"}`,
      "vibe64_session_renewal_quiesced"
    );
  }
  return readable;
}

function normalizeSessionListStatusGroup(statusGroup = "") {
  const normalizedStatusGroup = toText(statusGroup);
  if (!normalizedStatusGroup) {
    return "";
  }
  if (["all", "archived", "open"].includes(normalizedStatusGroup)) {
    return normalizedStatusGroup;
  }
  throw vibe64Error(`Invalid vibe64 session list status group: ${normalizedStatusGroup}`, "vibe64_invalid_session_list_status_group");
}

function normalizeSessionListStatuses(statuses = []) {
  return new Set((Array.isArray(statuses) ? statuses : [])
    .map((status) => toText(status))
    .filter(Boolean)
    .map(assertVibe64SessionStatus));
}

function normalizeSessionListOptions(options = {}) {
  return {
    statusGroup: normalizeSessionListStatusGroup(options.statusGroup),
    statuses: normalizeSessionListStatuses(options.statuses)
  };
}

function sessionStatusMatchesListOptions(status, {
  statusGroup = "",
  statuses = new Set()
} = {}) {
  const normalizedStatus = toText(status) || VIBE64_SESSION_STATUS.ACTIVE;
  if (HIDDEN_VIBE64_SESSION_STATUSES.has(normalizedStatus)) {
    return false;
  }
  if (statuses.size > 0 && !statuses.has(normalizedStatus)) {
    return false;
  }
  if (statusGroup === "open") {
    return OPEN_VIBE64_SESSION_STATUSES.has(normalizedStatus);
  }
  if (statusGroup === "archived") {
    return normalizedStatus === VIBE64_SESSION_STATUS.ARCHIVED;
  }
  return OPEN_VIBE64_SESSION_STATUSES.has(normalizedStatus) ||
    normalizedStatus === VIBE64_SESSION_STATUS.ARCHIVED;
}

function sessionListMayIncludeArchived({
  statusGroup = "",
  statuses = new Set()
} = {}) {
  return statusGroup !== "open" && (
    statuses.size < 1 ||
    statuses.has(VIBE64_SESSION_STATUS.ARCHIVED)
  );
}

/**
 * The saved practice binding (noExercise:false) that the published, immutable
 * 20261008-learning-practice-* upgrades write and verify. This constructor
 * contract validates identity and preserves that opaque exact pin; it grants
 * no Training/content authority and never accepts a browser purpose flag.
 */
function validateLearningSessionScope(value) {
  if (value === undefined || value === null) return null;
  const invalid = () => vibe64Error("Learning sessions require an authorized learner, exact attempt/pin and exercise scope.",
    "vibe64_learning_scope_invalid");
  if (!isPlainObject(value) || Object.keys(value).some(name => !["learnerId", "attemptId", "pin", "noExercise"].includes(name)) ||
      typeof value.learnerId !== "string" || !value.learnerId || value.learnerId.trim() !== value.learnerId ||
      // eslint-disable-next-line no-control-regex -- Match the existing authenticated learner identity contract.
      Buffer.byteLength(value.learnerId) > 128 || /[\u0000-\u001f\u007f]/u.test(value.learnerId) ||
      typeof value.attemptId !== "string" || !UUID_V4_PATTERN.test(value.attemptId) ||
      value.noExercise !== false || !isPlainObject(value.pin) ||
      !["course", "topic", "lesson"].every(name => isPlainObject(value.pin[name]))) throw invalid();
  let bytes, pin;
  try {
    bytes = JSON.stringify(value.pin);
    pin = JSON.parse(bytes);
  } catch { throw invalid(); }
  if (Buffer.byteLength(bytes) > 4096 || !isDeepStrictEqual(pin, value.pin)) throw invalid();
  return deepFreeze({ learnerId: value.learnerId, attemptId: value.attemptId, pin, noExercise: value.noExercise });
}

function learningSessionBinding(metadata, learningScope, sessionId) {
  const raw = metadata?.[LEARNING_SESSION_METADATA];
  if (!learningScope && raw === undefined) return null;
  const expected = learningScope && { schemaVersion: 1, ...learningScope, conversationId: sessionId };
  let binding;
  try { binding = JSON.parse(raw); } catch { /* Refuse missing or malformed claimed purpose. */ }
  if (!expected || !isDeepStrictEqual(binding, expected)) {
    throw vibe64Error("This learning session does not match its admitted owner, attempt, pin or exercise purpose.",
      "vibe64_learning_session_scope_mismatch");
  }
  return binding;
}

/**
 * A Working (unscoped) list leaves out a genuine lesson binding: its Learning
 * list owns that session. Malformed claims still reach the refusing reader.
 */
function genuineLearningBinding(raw, sessionId) {
  let binding;
  try { binding = JSON.parse(raw); } catch { return false; }
  if (!isPlainObject(binding) || binding.schemaVersion !== 1 || binding.conversationId !== sessionId ||
      Object.keys(binding).length !== 6) return false;
  try {
    validateLearningSessionScope({
      learnerId: binding.learnerId,
      attemptId: binding.attemptId,
      pin: binding.pin,
      noExercise: binding.noExercise
    });
    return true;
  } catch { return false; }
}

export {
  ARTIFACT_PATH_SEGMENT_PATTERN,
  BACKGROUND_TASK_EVENT_LIMIT,
  BACKGROUND_TASK_STATUS,
  COMMAND_BUFFER_BYTES,
  CONVERSATION_MESSAGE_FILE_PATTERN,
  CONVERSATION_MESSAGE_ROLES,
  CONVERSATION_TURN_ATTACHMENTS_FILE,
  CONVERSATION_TURN_ID_PATTERN,
  CONVERSATION_TURN_METADATA_FILE,
  HIDDEN_VIBE64_SESSION_STATUSES,
  LEARNING_SESSION_METADATA,
  METADATA_NAME_PATTERN,
  OPEN_VIBE64_SESSION_STATUSES,
  RENEWAL_ARCHIVE_RESET_METADATA_NAMES,
  RENEWAL_ARCHIVE_SELECTION_METADATA,
  RENEWAL_ARCHIVE_SELECTION_NONE,
  RENEWAL_TRANSITION_VIBE64_SESSION_STATUSES,
  SESSION_ARCHIVE_INDEX_METADATA_NAMES,
  SESSION_ARCHIVE_KIND,
  SESSION_ARCHIVE_TIMEOUT_MS,
  SESSION_LABEL_MAX_LENGTH,
  SESSION_LABEL_METADATA,
  SESSION_RENEWAL_STATE_FILE_PATTERN,
  SESSION_SOURCE_DESCRIPTOR_METADATA_NAMES,
  UUID_V4_PATTERN,
  VIBE64_AGENT_RUN_STATE,
  VIBE64_SESSION_ARCHIVE_SCHEMA_VERSION,
  VIBE64_SESSION_SCHEMA_VERSION,
  VIBE64_SESSION_STATUS,
  assertNormalSessionIsMutable,
  assertNormalSessionIsReadable,
  assertRenewalSuccessorLink,
  assertSafeAgentRunId,
  assertSafeBackgroundTaskId,
  assertSafeMetadataName,
  assertValidVibe64SessionId,
  assertVibe64SessionStatus,
  genuineLearningBinding,
  isSafeAgentRunId,
  isSafeBackgroundTaskId,
  isValidVibe64SessionId,
  learningSessionBinding,
  normalizeBackgroundTaskStatus,
  normalizeSessionListOptions,
  normalizeVibe64AgentRunState,
  renewalArchiveMetadata,
  sessionIsUnfinishedRenewalRecord,
  sessionListMayIncludeArchived,
  sessionStatusMatchesListOptions,
  unknownSessionError,
  validateLearningSessionScope,
  vibe64AgentRunStateIsActive,
  vibe64AgentRunStateIsTerminal,
  vibe64SessionStatusIsHidden,
  vibe64SessionStatusIsOpen
};
