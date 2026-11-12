import { isDeepStrictEqual } from "node:util";
import stripAnsi from "strip-ansi";
import { isPlainObject } from "@local/vibe64-core/server/core";
import { toText } from "@jskit-ai/kernel/shared/support/normalize";

/** @typedef {import("./types.js").Vibe64SessionStore} Vibe64SessionStore */

const WORKSPACE_SETUP_METADATA_NAME = "workspace_setup";
const PREPARED_COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const PREPARED_CHANGES = /^sha256:[0-9a-f]{64}$/u;
const PREPARED_CONNECTED_NAME = /^[a-z0-9_.-]{1,100}$/u;
// More step records than this are no record: a recipe has far fewer steps that name their inputs.
const MAX_PREPARED_STEPS = 64;
// The statuses whose record of prepared steps still holds: a run records each step as it succeeds.
const PREPARED_STEPS_STATUSES = new Set(["failed", "required", "running", "succeeded"]);
const WORKSPACE_SETUP_DIAGNOSTIC_MAX_LENGTH = 1600;
const WORKSPACE_SETUP_TRANSCRIPT_MAX_LENGTH = 32 * 1024;
const WORKSPACE_SETUP_TRANSCRIPT_TRUNCATED_MARKER = "[Earlier workspace preparation output was truncated.]\n";
const WORKSPACE_SETUP_STATUSES = new Set([
  "ambiguous",
  "failed",
  "required",
  "running",
  "succeeded",
  "unconfigured"
]);

function boundedText(value = "", maxLength = undefined) {
  const normalized = toText(value);
  return Number.isSafeInteger(maxLength)
    ? normalized.slice(0, maxLength)
    : normalized;
}

function workspaceSetupTranscript(value = "") {
  const normalized = [...stripAnsi(String(value ?? ""))
    .replace(/\r\n?/gu, "\n")
  ].filter((character) => {
    const code = character.codePointAt(0);
    return character === "\n" || character === "\t" || (code >= 32 && code !== 127);
  }).join("")
    .trim();
  if (normalized.length <= WORKSPACE_SETUP_TRANSCRIPT_MAX_LENGTH) {
    return normalized;
  }
  return `${WORKSPACE_SETUP_TRANSCRIPT_TRUNCATED_MARKER}${normalized.slice(
    -(WORKSPACE_SETUP_TRANSCRIPT_MAX_LENGTH - WORKSPACE_SETUP_TRANSCRIPT_TRUNCATED_MARKER.length)
  )}`;
}

/**
 * The exact tree a successful preparation prepared: its recipe, the session's commit with a digest of its
 * uncommitted changes, and the same for each connected repository, by name. Anything else is no record.
 * @param {unknown} value
 */
function preparedTree(value) {
  if (!isPlainObject(value) || !Array.isArray(value.connected) || value.connected.length > 32) return null;
  const record = {
    recipeHash: toText(value.recipeHash),
    commit: toText(value.commit),
    changes: toText(value.changes),
    connected: value.connected.map(entry => ({
      name: toText(entry?.name),
      commit: toText(entry?.commit),
      changes: toText(entry?.changes)
    }))
  };
  const repository = ({ commit, changes }) => PREPARED_COMMIT.test(commit) && PREPARED_CHANGES.test(changes);
  return record.recipeHash && record.recipeHash.length <= 128 && repository(record) &&
    value.connected.every(isPlainObject) && record.connected.every(entry => PREPARED_CONNECTED_NAME.test(entry.name) && repository(entry))
    ? record
    : null;
}

/**
 * The steps that name their inputs, each as it last succeeded: a digest of its command (`step`) and one of
 * what its inputs held, with the resources it ran on (`inputs`). Anything else is no record.
 * @param {unknown} value
 * @returns {{ step: string, inputs: string }[]}
 */
function preparedSteps(value) {
  if (!Array.isArray(value) || value.length > MAX_PREPARED_STEPS || !value.every(isPlainObject)) return [];
  const records = value.map(entry => ({ step: toText(entry.step), inputs: toText(entry.inputs) }));
  return records.every(({ step, inputs }) => PREPARED_CHANGES.test(step) && PREPARED_CHANGES.test(inputs)) &&
    new Set(records.map(({ step }) => step)).size === records.length
    ? records
    : [];
}

/**
 * Whether the tree preparation finds now is the one a successful preparation recorded.
 * @param {object | null} current
 * @param {object | null} recorded
 */
function samePreparedTree(current, recorded) {
  const now = preparedTree(current);
  return Boolean(now) && isDeepStrictEqual(now, preparedTree(recorded));
}

function workspaceSetupState(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  const status = toText(source.status);
  const resourceAdmissionId = toText(source.resourceAdmissionId);
  // An Update keeps what was prepared while it marks preparation required: the next
  // preparation skips its steps when it finds that same tree.
  const prepared = ["required", "succeeded"].includes(status) ? preparedTree(source.preparedTree) : null;
  const steps = PREPARED_STEPS_STATUSES.has(status) ? preparedSteps(source.preparedSteps) : [];
  return {
    currentLabel: boundedText(source.currentLabel, 160),
    diagnostic: boundedText(source.diagnostic, WORKSPACE_SETUP_DIAGNOSTIC_MAX_LENGTH),
    finishedAt: toText(source.finishedAt),
    ...(steps.length ? { preparedSteps: steps } : {}),
    ...(prepared ? { preparedTree: prepared } : {}),
    recipeHash: boundedText(source.recipeHash, 128),
    ...((status === "succeeded" || prepared) && typeof source.resourceIdentity === "string" &&
      /^[a-f0-9]{64}$/u.test(source.resourceIdentity)
      ? { resourceIdentity: source.resourceIdentity } : {}),
    ...(status === "failed" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(resourceAdmissionId)
      ? { resourceAdmissionId } : {}),
    // The Stack runtimes the failed preparation used, so its panel can show them.
    ...(status === "failed" && Array.isArray(source.runtimes) && source.runtimes.length
      ? {
          runtimes: [...new Set(source.runtimes.map((runtime) => toText(runtime))
            .filter((runtime) => /^[a-z0-9-]{1,40}$/u.test(runtime)))].slice(0, 16)
        } : {}),
    startedAt: toText(source.startedAt),
    status: WORKSPACE_SETUP_STATUSES.has(status) ? status : "unconfigured",
    transcript: workspaceSetupTranscript(source.transcript),
    updatedAt: toText(source.updatedAt)
  };
}

function workspaceSetupStateFromMetadata(metadata) {
  const serialized = toText(metadata?.[WORKSPACE_SETUP_METADATA_NAME]);
  if (!serialized) {
    return workspaceSetupState();
  }
  try {
    return workspaceSetupState(JSON.parse(serialized));
  } catch {
    return workspaceSetupState({
      diagnostic: "Stored workspace preparation status is invalid.",
      status: "failed"
    });
  }
}

function publicSessionMetadata(metadata = {}) {
  return Object.fromEntries(Object.entries(
    metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {}
  ).filter(([name]) => name !== WORKSPACE_SETUP_METADATA_NAME));
}

/**
 * @param {Vibe64SessionStore} store
 * @param {string} [sessionId]
 * @param {object} [value]
 * @param {object} [options]
 * @param {boolean} [options.renewal]
 */
async function writeWorkspaceSetupState(store, sessionId = "", value = {}, options = {}) {
  const {
    renewal = false
  } = options;
  const state = workspaceSetupState(value);
  const writeMetadataValue = renewal
    ? store.writeMetadataValueForRenewal
    : store.writeMetadataValue;
  await writeMetadataValue.call(
    store,
    sessionId,
    WORKSPACE_SETUP_METADATA_NAME,
    JSON.stringify(state)
  );
  return state;
}

const __testables = Object.freeze({
  WORKSPACE_SETUP_TRANSCRIPT_MAX_LENGTH,
  WORKSPACE_SETUP_TRANSCRIPT_TRUNCATED_MARKER
});

export {
  WORKSPACE_SETUP_METADATA_NAME,
  publicSessionMetadata,
  samePreparedTree,
  workspaceSetupState,
  workspaceSetupStateFromMetadata,
  workspaceSetupTranscript,
  writeWorkspaceSetupState,
  __testables
};
