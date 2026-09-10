import {
  normalizeText
} from "@local/vibe64-core/server/core";
import stripAnsi from "strip-ansi";

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
  const normalized = normalizeText(value);
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
  const status = normalizeText(source.status);
  const resourceAdmissionId = normalizeText(source.resourceAdmissionId);
  return {
    currentLabel: boundedText(source.currentLabel, 160),
    diagnostic: boundedText(source.diagnostic, WORKSPACE_SETUP_DIAGNOSTIC_MAX_LENGTH),
    finishedAt: normalizeText(source.finishedAt),
    recipeHash: boundedText(source.recipeHash, 128),
    ...(status === "failed" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(resourceAdmissionId)
      ? { resourceAdmissionId } : {}),
    startedAt: normalizeText(source.startedAt),
    status: WORKSPACE_SETUP_STATUSES.has(status) ? status : "unconfigured",
    transcript: workspaceSetupTranscript(source.transcript),
    updatedAt: normalizeText(source.updatedAt)
  };
}

function workspaceSetupStateFromMetadata(metadata = {}) {
  const serialized = normalizeText(metadata?.[WORKSPACE_SETUP_METADATA_NAME]);
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

async function writeWorkspaceSetupState(store, sessionId = "", value = {}, {
  renewal = false
} = {}) {
  const state = workspaceSetupState(value);
  const writeMetadataValue = renewal
    ? store.writeMetadataValueForRenewal
    : store.writeMetadataValue;
  if (typeof writeMetadataValue !== "function") {
    throw new TypeError(
      renewal
        ? "Renewal workspace preparation requires the private metadata writer."
        : "Workspace preparation requires the session metadata writer."
    );
  }
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
