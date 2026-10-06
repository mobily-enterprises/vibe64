import {
  CODEX_HELPER_THREAD_LEDGER_SCHEMA_VERSION,
  CODEX_HELPER_THREAD_LIFECYCLES,
  createCodexHelperThreadLedgerOwner
} from "@jskit-ai/assistant-core/server/codex-turn";
import {
  defineVibe64AgentExecutionProfileRequest,
  vibe64AgentExecutionProfileAuditSnapshot
} from "@local/vibe64-runtime/shared";

const PROFILE_KEYS = Object.freeze([
  "limits",
  "model",
  "policy",
  "profileId",
  "providerId",
  "request",
  "revision",
  "thinking",
  "workloadId"
]);
const PROFILE_LIMIT_KEYS = Object.freeze([
  "maxInputCharacters",
  "maxOutputCharacters",
  "timeoutMs"
]);
const PROFILE_POLICY_KEYS = Object.freeze([
  "environmentAccess",
  "networkAccess",
  "repositoryWrite",
  "tools"
]);
const PROFILE_REQUEST_KEYS = Object.freeze([
  "allowProviderModelFallback",
  "reasoning",
  "summary"
]);

function normalizeText(value) {
  return String(value ?? "").trim();
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function ledgerError(message = "", code = "vibe64_codex_helper_ledger_invalid") {
  const error = new Error(normalizeText(message) || "Codex helper ownership record is invalid.");
  error.code = code;
  error.retryable = true;
  return error;
}

function assertExactKeys(value, expectedKeys, label) {
  if (!isRecord(value)) {
    throw ledgerError(`${label} must be an object.`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw ledgerError(`${label} has an unsupported shape.`);
  }
}

function strictExecutionProfile(value) {
  assertExactKeys(value, PROFILE_KEYS, "executionProfile");
  assertExactKeys(value.limits, PROFILE_LIMIT_KEYS, "executionProfile.limits");
  assertExactKeys(value.policy, PROFILE_POLICY_KEYS, "executionProfile.policy");
  assertExactKeys(value.request, PROFILE_REQUEST_KEYS, "executionProfile.request");
  return vibe64AgentExecutionProfileAuditSnapshot(value);
}

function codexAppServerHelperExecutionProfileMatches(recorded = {}, expected = {}) {
  const expectedKeys = Object.keys(expected).sort();
  if (
    expectedKeys.length === 2 &&
    expectedKeys[0] === "profileId" &&
    expectedKeys[1] === "workloadId"
  ) {
    const request = defineVibe64AgentExecutionProfileRequest(expected);
    return recorded.profileId === request.profileId &&
      recorded.workloadId === request.workloadId;
  }
  return JSON.stringify(recorded) === JSON.stringify(
    vibe64AgentExecutionProfileAuditSnapshot(expected)
  );
}

const codexHelperThreadLedgerOwner = Object.freeze({
  ...createCodexHelperThreadLedgerOwner({
    executionProfile: strictExecutionProfile,
    snapshotExecutionProfile: vibe64AgentExecutionProfileAuditSnapshot,
    errorPrefix: "vibe64_codex_helper_"
  }),
  matchesExecutionProfile: codexAppServerHelperExecutionProfileMatches
});
const {
  codexHelperThreadRecordId,
  createCodexHelperThreadLedger,
  defineCodexHelperThreadRecord
} = codexHelperThreadLedgerOwner;

export {
  CODEX_HELPER_THREAD_LEDGER_SCHEMA_VERSION,
  CODEX_HELPER_THREAD_LIFECYCLES,
  codexHelperThreadRecordId,
  codexHelperThreadLedgerOwner,
  createCodexHelperThreadLedger,
  defineCodexHelperThreadRecord
};
