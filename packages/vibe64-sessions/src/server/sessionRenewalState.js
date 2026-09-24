import { assistantRoutingPreferences } from "@local/vibe64-runtime/shared/assistantRouting";
import crypto from "node:crypto";

import {
  isPlainObject,
  normalizeText,
  vibe64Error
} from "@local/vibe64-core/server/core";
import {
  defineVibe64AssistantSelection
} from "@local/vibe64-runtime/shared";

const SESSION_RENEWAL_KIND = "vibe64.session_renewal";
const SESSION_RENEWAL_SCHEMA_VERSION = 1;
const SESSION_RENEWAL_HANDOVER_MAX_CHARACTERS = 20_000;

const SESSION_RENEWAL_STAGE = Object.freeze({
  CANCELLED: "cancelled",
  COMPLETED: "completed",
  DRAFT_GENERATING: "draft_generating",
  DRAFT_READY: "draft_ready",
  FAILURE_RESTORING: "failure_restoring",
  OLD_ARCHIVING: "old_archiving",
  OLD_QUIESCING: "old_quiescing",
  SUCCESSOR_ACKNOWLEDGED: "successor_acknowledged",
  SUCCESSOR_ACTIVATING: "successor_activating",
  SUCCESSOR_CREATING: "successor_creating",
  SUCCESSOR_DISCARDING: "successor_discarding",
  SUCCESSOR_SEEDING: "successor_seeding",
  SUCCESSOR_SETUP: "successor_setup"
});

const SESSION_RENEWAL_STATUS = Object.freeze({
  CANCELLED: "cancelled",
  COMPLETED: "completed",
  FAILED: "failed",
  REVIEW: "review",
  RUNNING: "running"
});

const SESSION_RENEWAL_STAGES = new Set(Object.values(SESSION_RENEWAL_STAGE));
const SESSION_RENEWAL_STATUSES = new Set(Object.values(SESSION_RENEWAL_STATUS));
const SESSION_RENEWAL_MAINTENANCE_STATUSES = new Set([
  "completed",
  "failed",
  "pending"
]);
const SESSION_RENEWAL_MAINTENANCE_STEP = Object.freeze({
  ADMISSION_THAWED: "admissionThawed",
  ARCHIVE_FINALIZED: "archiveFinalized",
  ATTACHMENTS_RELEASED: "attachmentsReleased",
  PREDECESSOR_PROCESS_PROOF_RELEASED: "predecessorProcessProofReleased",
  RESOURCES_RELEASED: "resourcesReleased",
  SOURCE_REMOVED: "sourceRemoved",
  SUCCESSOR_FINALIZED: "successorFinalized"
});
const SESSION_RENEWAL_MAINTENANCE_STEPS = Object.freeze(
  Object.values(SESSION_RENEWAL_MAINTENANCE_STEP)
);

function renewalStateError(message, code, {
  details = null,
  statusCode = 409
} = {}) {
  const error = vibe64Error(message, code);
  error.statusCode = statusCode;
  if (details) {
    error.details = details;
  }
  return error;
}

function renewalTimestamp(value = "") {
  const timestamp = normalizeText(value);
  if (!timestamp || !Number.isFinite(Date.parse(timestamp))) {
    throw renewalStateError(
      "Session renewal has an invalid timestamp.",
      "vibe64_session_renewal_state_invalid",
      { statusCode: 500 }
    );
  }
  return timestamp;
}

function renewalOperationKey(value = "") {
  const key = normalizeText(value);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u.test(key)) {
    throw renewalStateError(
      "Session renewal requires a valid operation key.",
      "vibe64_session_renewal_operation_key_invalid",
      { statusCode: 400 }
    );
  }
  return key;
}

function renewalHandoverText(value = "", {
  allowEmpty = true
} = {}) {
  const handover = String(value ?? "")
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n");
  const characterCount = Array.from(handover).length;
  const hasDisallowedControlCharacter = Array.from(handover).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint === 0x7f || (
      codePoint < 0x20 &&
      codePoint !== 0x09 &&
      codePoint !== 0x0a
    );
  });
  if (hasDisallowedControlCharacter) {
    throw renewalStateError(
      "Session handover must be plain text without control characters.",
      "vibe64_session_renewal_handover_invalid",
      {
        details: {
          characterCount,
          maximumCharacters: SESSION_RENEWAL_HANDOVER_MAX_CHARACTERS
        },
        statusCode: 400
      }
    );
  }
  if (characterCount > SESSION_RENEWAL_HANDOVER_MAX_CHARACTERS) {
    throw renewalStateError(
      `Session handover text cannot exceed ${SESSION_RENEWAL_HANDOVER_MAX_CHARACTERS.toLocaleString("en")} characters.`,
      "vibe64_session_renewal_handover_too_long",
      {
        details: {
          characterCount,
          maximumCharacters: SESSION_RENEWAL_HANDOVER_MAX_CHARACTERS
        },
        statusCode: 400
      }
    );
  }
  if (!allowEmpty && !handover.trim()) {
    throw renewalStateError(
      "Write or generate a handover before renewing this session.",
      "vibe64_session_renewal_handover_required",
      { statusCode: 400 }
    );
  }
  return handover;
}

function renewalHandoverHash(value = "") {
  return crypto.createHash("sha256")
    .update(renewalHandoverText(value), "utf8")
    .digest("hex");
}

function renewalDraft(value = {}, {
  allowEmpty = true
} = {}) {
  const draft = isPlainObject(value) ? value : {};
  const handover = renewalHandoverText(draft.text, { allowEmpty });
  const revision = Number(draft.revision);
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw renewalStateError(
      "Session renewal draft has an invalid revision.",
      "vibe64_session_renewal_state_invalid",
      { statusCode: 500 }
    );
  }
  const hash = renewalHandoverHash(handover);
  if (normalizeText(draft.hash) !== hash) {
    throw renewalStateError(
      "Session renewal draft integrity check failed.",
      "vibe64_session_renewal_state_invalid",
      { statusCode: 500 }
    );
  }
  return {
    hash,
    origin: ["edited", "generated", "manual"].includes(normalizeText(draft.origin))
      ? normalizeText(draft.origin)
      : "manual",
    revision,
    text: handover,
    updatedAt: renewalTimestamp(draft.updatedAt)
  };
}

function renewalActor(value = null) {
  if (!isPlainObject(value)) {
    return null;
  }
  const actor = {
    id: normalizeText(value.id),
    name: normalizeText(value.name)
  };
  return actor.id || actor.name ? actor : null;
}

function renewalCommit(value = null, {
  sessionId = "",
  successorSessionId = ""
} = {}) {
  if (!isPlainObject(value)) {
    return null;
  }
  const normalized = {
    committedAt: renewalTimestamp(value.committedAt),
    selectedBeforeArchive: normalizeText(value.selectedBeforeArchive),
    sourceSessionId: normalizeText(value.sourceSessionId),
    successorSessionId: normalizeText(value.successorSessionId),
    successorWillBeSelected: value.successorWillBeSelected === true
  };
  if (
    normalized.sourceSessionId !== normalizeText(sessionId) ||
    normalized.successorSessionId !== normalizeText(successorSessionId) ||
    ![normalized.sourceSessionId, "none"].includes(normalized.selectedBeforeArchive)
  ) {
    throw renewalStateError(
      "Session renewal has an invalid commit marker.",
      "vibe64_session_renewal_state_invalid",
      { statusCode: 500 }
    );
  }
  return normalized;
}

function renewalMaintenance(value = null, commit = null) {
  if (!commit || !isPlainObject(value)) {
    return null;
  }
  const status = normalizeText(value.status);
  const attempt = Number(value.attempt || 0);
  const steps = isPlainObject(value.steps) ? value.steps : {};
  if (
    !SESSION_RENEWAL_MAINTENANCE_STATUSES.has(status) ||
    !Number.isSafeInteger(attempt) ||
    attempt < 0 ||
    SESSION_RENEWAL_MAINTENANCE_STEPS.some((name) => (
      Object.hasOwn(steps, name) && typeof steps[name] !== "boolean"
    ))
  ) {
    throw renewalStateError(
      "Session renewal has invalid post-commit maintenance state.",
      "vibe64_session_renewal_state_invalid",
      { statusCode: 500 }
    );
  }
  const normalizedSteps = Object.fromEntries(
    SESSION_RENEWAL_MAINTENANCE_STEPS.map((name) => [name, steps[name] === true])
  );
  if (
    status === "completed" &&
    Object.values(normalizedSteps).some((completed) => !completed)
  ) {
    throw renewalStateError(
      "Completed session-renewal maintenance has unfinished work.",
      "vibe64_session_renewal_state_invalid",
      { statusCode: 500 }
    );
  }
  return {
    attempt,
    error: isPlainObject(value.error) ? value.error : null,
    status,
    steps: normalizedSteps,
    updatedAt: renewalTimestamp(value.updatedAt)
  };
}

function normalizeSessionRenewalState(value = {}, {
  expectedSessionId = ""
} = {}) {
  if (
    !isPlainObject(value) ||
    value.kind !== SESSION_RENEWAL_KIND ||
    Number(value.schemaVersion) !== SESSION_RENEWAL_SCHEMA_VERSION
  ) {
    throw renewalStateError(
      "Session renewal state is invalid.",
      "vibe64_session_renewal_state_invalid",
      { statusCode: 500 }
    );
  }
  const sessionId = normalizeText(value.sessionId);
  if (!sessionId || (expectedSessionId && sessionId !== normalizeText(expectedSessionId))) {
    throw renewalStateError(
      "Session renewal state belongs to a different session.",
      "vibe64_session_renewal_state_invalid",
      { statusCode: 500 }
    );
  }
  const stage = normalizeText(value.stage);
  const status = normalizeText(value.status);
  const revision = Number(value.revision);
  if (!SESSION_RENEWAL_STAGES.has(stage) || !SESSION_RENEWAL_STATUSES.has(status)) {
    throw renewalStateError(
      "Session renewal state has an invalid lifecycle.",
      "vibe64_session_renewal_state_invalid",
      { statusCode: 500 }
    );
  }
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw renewalStateError(
      "Session renewal state has an invalid revision.",
      "vibe64_session_renewal_state_invalid",
      { statusCode: 500 }
    );
  }
  const normalized = {
    ...value,
    actor: renewalActor(value.actor) || {},
    ...(value.confirmedBy ? { confirmedBy: renewalActor(value.confirmedBy) } : {}),
    ...(value.continuedBy ? { continuedBy: renewalActor(value.continuedBy) } : {}),
    createdAt: renewalTimestamp(value.createdAt),
    kind: SESSION_RENEWAL_KIND,
    operationKey: renewalOperationKey(value.operationKey),
    ...(value.predecessorArchivedAt
      ? { predecessorArchivedAt: renewalTimestamp(value.predecessorArchivedAt) }
      : {}),
    renewalId: normalizeText(value.renewalId),
    revision,
    schemaVersion: SESSION_RENEWAL_SCHEMA_VERSION,
    sessionId,
    stage,
    status,
    updatedAt: renewalTimestamp(value.updatedAt)
  };
  if (!normalized.renewalId) {
    throw renewalStateError(
      "Session renewal state has no renewal id.",
      "vibe64_session_renewal_state_invalid",
      { statusCode: 500 }
    );
  }
  if (value.draft) {
    normalized.draft = renewalDraft(value.draft, {
      allowEmpty: stage === SESSION_RENEWAL_STAGE.DRAFT_READY
    });
  }
  if (value.approved) {
    normalized.approved = renewalDraft(value.approved, { allowEmpty: false });
  }
  if (isPlainObject(value.successor)) {
    normalized.successor = {
      ...value.successor,
      ...(value.successor.assistantRouting ? { assistantRouting: assistantRoutingPreferences(value.successor.assistantRouting) } : {}),
      ...(value.successor.assistantSelection
        ? {
            assistantSelection: defineVibe64AssistantSelection(
              value.successor.assistantSelection
            )
          }
        : {})
    };
  }
  const successorSessionId = normalizeText(value.successor?.sessionId);
  const commit = renewalCommit(value.commit, {
    sessionId,
    successorSessionId
  });
  if (commit) {
    normalized.commit = commit;
    normalized.maintenance = renewalMaintenance(value.maintenance, commit);
    if (!normalized.maintenance) {
      throw renewalStateError(
        "Committed session renewal has no maintenance ledger.",
        "vibe64_session_renewal_state_invalid",
        { statusCode: 500 }
      );
    }
  }
  if (commit && !(
    (
      stage === SESSION_RENEWAL_STAGE.SUCCESSOR_ACTIVATING &&
      status === SESSION_RENEWAL_STATUS.RUNNING
    ) || (
      stage === SESSION_RENEWAL_STAGE.COMPLETED &&
      status === SESSION_RENEWAL_STATUS.COMPLETED
    )
  )) {
    throw renewalStateError(
      "Session renewal has a commit marker outside its forward-only completion boundary.",
      "vibe64_session_renewal_state_invalid",
      { statusCode: 500 }
    );
  }
  if (normalized.predecessorArchivedAt && !commit) {
    throw renewalStateError(
      "Session renewal claims a predecessor archive before its commit marker.",
      "vibe64_session_renewal_state_invalid",
      { statusCode: 500 }
    );
  }
  const lifecycleValid = (
    status === SESSION_RENEWAL_STATUS.CANCELLED &&
    stage === SESSION_RENEWAL_STAGE.CANCELLED
  ) || (
    status === SESSION_RENEWAL_STATUS.COMPLETED &&
    stage === SESSION_RENEWAL_STAGE.COMPLETED &&
    Boolean(normalized.approved)
  ) || (
    status === SESSION_RENEWAL_STATUS.REVIEW &&
    stage === SESSION_RENEWAL_STAGE.DRAFT_READY &&
    Boolean(normalized.draft)
  ) || (
    [SESSION_RENEWAL_STATUS.RUNNING, SESSION_RENEWAL_STATUS.FAILED].includes(status) &&
    ![
      SESSION_RENEWAL_STAGE.CANCELLED,
      SESSION_RENEWAL_STAGE.COMPLETED,
      SESSION_RENEWAL_STAGE.DRAFT_READY
    ].includes(stage) &&
    (
      stage === SESSION_RENEWAL_STAGE.DRAFT_GENERATING ||
      Boolean(normalized.approved)
    )
  );
  if (!lifecycleValid) {
    throw renewalStateError(
      "Session renewal state has an inconsistent lifecycle.",
      "vibe64_session_renewal_state_invalid",
      { statusCode: 500 }
    );
  }
  if (
    status === SESSION_RENEWAL_STATUS.COMPLETED &&
    (!normalized.commit || !successorSessionId)
  ) {
    throw renewalStateError(
      "Completed session renewal has no durable commit marker.",
      "vibe64_session_renewal_state_invalid",
      { statusCode: 500 }
    );
  }
  return normalized;
}

function createSessionRenewalState({
  actor = {},
  at = new Date().toISOString(),
  operationKey = "",
  renewalId = crypto.randomUUID(),
  sessionId = ""
} = {}) {
  const timestamp = renewalTimestamp(at);
  return normalizeSessionRenewalState({
    actor: {
      id: normalizeText(actor.id),
      name: normalizeText(actor.name)
    },
    createdAt: timestamp,
    error: null,
    kind: SESSION_RENEWAL_KIND,
    operationKey: renewalOperationKey(operationKey),
    renewalId: normalizeText(renewalId),
    revision: 1,
    schemaVersion: SESSION_RENEWAL_SCHEMA_VERSION,
    sessionId: normalizeText(sessionId),
    stage: SESSION_RENEWAL_STAGE.DRAFT_GENERATING,
    status: SESSION_RENEWAL_STATUS.RUNNING,
    updatedAt: timestamp
  }, { expectedSessionId: sessionId });
}

function createSessionRenewalDraft(text = "", {
  at = new Date().toISOString(),
  origin = "manual",
  revision = 1
} = {}) {
  const handover = renewalHandoverText(text);
  return renewalDraft({
    hash: renewalHandoverHash(handover),
    origin,
    revision,
    text: handover,
    updatedAt: renewalTimestamp(at)
  });
}

function assertSessionRenewalOperation(state = {}, operationKey = "") {
  const expected = renewalOperationKey(operationKey);
  if (normalizeText(state.operationKey) !== expected) {
    throw renewalStateError(
      "Another session renewal operation is already in progress.",
      "vibe64_session_renewal_operation_conflict",
      {
        details: {
          currentRenewalId: normalizeText(state.renewalId)
        }
      }
    );
  }
  return state;
}

function assertSessionRenewalDraftVersion(state = {}, {
  expectedHash = "",
  expectedRevision = 0
} = {}) {
  const revision = Number(expectedRevision);
  const hash = normalizeText(expectedHash);
  if (
    !state.draft ||
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    revision !== state.draft.revision ||
    !hash ||
    hash !== state.draft.hash
  ) {
    throw renewalStateError(
      "The handover changed in another tab. Review the latest draft before continuing.",
      "vibe64_session_renewal_draft_stale",
      {
        details: state.draft
          ? { hash: state.draft.hash, revision: state.draft.revision }
          : null
      }
    );
  }
  return state.draft;
}

async function readSessionRenewalState(runtime, sessionId = "") {
  if (typeof runtime?.store?.readSessionRenewalStateRecord !== "function") {
    throw new TypeError("Session renewal state requires the project renewal-state reader.");
  }
  const raw = await runtime.store.readSessionRenewalStateRecord(sessionId);
  if (!normalizeText(raw)) {
    return null;
  }
  try {
    return normalizeSessionRenewalState(JSON.parse(raw), {
      expectedSessionId: sessionId
    });
  } catch (error) {
    if (normalizeText(error?.code).startsWith("vibe64_session_renewal_")) {
      throw error;
    }
    throw renewalStateError(
      "Session renewal state is not readable.",
      "vibe64_session_renewal_state_invalid",
      { statusCode: 500 }
    );
  }
}

async function writeSessionRenewalState(runtime, sessionId = "", value = {}) {
  if (typeof runtime?.store?.writeSessionRenewalStateRecord !== "function") {
    throw new TypeError("Session renewal state requires the project renewal-state writer.");
  }
  const state = normalizeSessionRenewalState(value, {
    expectedSessionId: sessionId
  });
  await runtime.store.writeSessionRenewalStateRecord(sessionId, state);
  return state;
}

async function mutateSessionRenewalState(runtime, sessionId = "", operation) {
  if (typeof operation !== "function") {
    throw new TypeError("Session renewal state mutation requires an operation.");
  }
  if (typeof runtime?.store?.runSessionRenewalStateExclusive !== "function") {
    throw new TypeError("Session renewal state requires the project renewal-state mutation boundary.");
  }
  return runtime.store.runSessionRenewalStateExclusive(sessionId, async () => {
    const current = await readSessionRenewalState(runtime, sessionId);
    const next = await operation(current);
    if (next === undefined) {
      return current;
    }
    return writeSessionRenewalState(runtime, sessionId, {
      ...next,
      revision: current ? current.revision + 1 : Number(next.revision) || 1
    });
  });
}

function publicSessionRenewalState(value = null) {
  if (!value) {
    return null;
  }
  const state = normalizeSessionRenewalState(value, {
    expectedSessionId: value.sessionId
  });
  return {
    actor: state.actor,
    basis: isPlainObject(state.basis) ? state.basis : null,
    createdAt: state.createdAt,
    draft: state.draft || null,
    error: isPlainObject(state.error) ? state.error : null,
    manualRequired: state.manualRequired === true,
    manualTemplateHash: normalizeText(state.manualTemplateHash) || null,
    maintenance: state.maintenance
      ? {
          error: state.maintenance.error,
          status: state.maintenance.status,
          updatedAt: state.maintenance.updatedAt
        }
      : null,
    operationKey: state.operationKey,
    predecessorArchivedAt: normalizeText(state.predecessorArchivedAt) || null,
    renewalId: state.renewalId,
    revision: state.revision,
    sessionId: state.sessionId,
    stage: state.stage,
    status: state.status,
    successor: isPlainObject(state.successor)
      ? {
          sessionId: normalizeText(state.successor.sessionId),
          acknowledgedAt: normalizeText(state.successor.acknowledgedAt),
          availableAt: normalizeText(state.successor.availableAt)
        }
      : null,
    updatedAt: state.updatedAt
  };
}

export {
  SESSION_RENEWAL_HANDOVER_MAX_CHARACTERS,
  SESSION_RENEWAL_KIND,
  SESSION_RENEWAL_MAINTENANCE_STEP,
  SESSION_RENEWAL_SCHEMA_VERSION,
  SESSION_RENEWAL_STAGE,
  SESSION_RENEWAL_STATUS,
  assertSessionRenewalDraftVersion,
  assertSessionRenewalOperation,
  createSessionRenewalDraft,
  createSessionRenewalState,
  mutateSessionRenewalState,
  normalizeSessionRenewalState,
  publicSessionRenewalState,
  readSessionRenewalState,
  renewalHandoverHash,
  renewalHandoverText,
  renewalOperationKey,
  writeSessionRenewalState
};
