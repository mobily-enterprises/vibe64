import stripAnsi from "strip-ansi";
import { toText } from "@local/vibe64-core/shared/toText";

/** @typedef {import("./types.js").Vibe64SessionStore} Vibe64SessionStore */

const WORKSPACE_SETUP_METADATA_NAME = "workspace_setup";
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

function workspaceSetupState(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  const status = toText(source.status);
  const resourceAdmissionId = toText(source.resourceAdmissionId);
  return {
    currentLabel: boundedText(source.currentLabel, 160),
    diagnostic: boundedText(source.diagnostic, WORKSPACE_SETUP_DIAGNOSTIC_MAX_LENGTH),
    finishedAt: toText(source.finishedAt),
    recipeHash: boundedText(source.recipeHash, 128),
    ...(status === "succeeded" && typeof source.resourceIdentity === "string" && /^[a-f0-9]{64}$/u.test(source.resourceIdentity)
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

export {
  WORKSPACE_SETUP_METADATA_NAME,
  WORKSPACE_SETUP_TRANSCRIPT_MAX_LENGTH,
  WORKSPACE_SETUP_TRANSCRIPT_TRUNCATED_MARKER,
  publicSessionMetadata,
  workspaceSetupState,
  workspaceSetupStateFromMetadata,
  workspaceSetupTranscript,
  writeWorkspaceSetupState
};
