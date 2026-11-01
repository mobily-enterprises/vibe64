import crypto from "node:crypto";

import {
  VIBE64_AGENT_EXECUTION_PROFILE_IDS,
  VIBE64_AGENT_EXECUTION_WORKLOAD_IDS,
  defineVibe64AgentExecutionProfileRequest,
  vibe64AgentExecutionProfileAuditSnapshot
} from "@local/vibe64-runtime/shared";

import { isPlainObject, sourceEditorError } from "./sourceFiles.js";
import { toText } from "@local/vibe64-core/shared/toText";

/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */

// The low-cost assistant profile source explanations run with, and the
// assistant routing, profile resolution and helper turn they use.
const SOURCE_EDITOR_EXPLANATION_EXECUTION_PROFILE = defineVibe64AgentExecutionProfileRequest({
  profileId: VIBE64_AGENT_EXECUTION_PROFILE_IDS.HELPER,
  workloadId: VIBE64_AGENT_EXECUTION_WORKLOAD_IDS.SOURCE_EXPLANATION
});

function sourceEditorExecutionProfileSnapshot(value = null) {
  try {
    return vibe64AgentExecutionProfileAuditSnapshot(value);
  } catch {
    return null;
  }
}

function sourceEditorExecutionProfileFromFailure(value = null) {
  return sourceEditorExecutionProfileSnapshot(value?.executionProfile) ||
    sourceEditorExecutionProfileSnapshot(value?.sourceEditorRejectedThread?.executionProfile) ||
    sourceEditorExecutionProfileSnapshot(value?.details?.executionProfile) ||
    sourceEditorExecutionProfileSnapshot(value?.details?.details?.executionProfile);
}

function requiredSourceEditorExecutionProfile(value = null) {
  const snapshot = sourceEditorExecutionProfileSnapshot(value);
  if (
    !snapshot ||
    snapshot.profileId !== SOURCE_EDITOR_EXPLANATION_EXECUTION_PROFILE.profileId ||
    snapshot.workloadId !== SOURCE_EDITOR_EXPLANATION_EXECUTION_PROFILE.workloadId ||
    !snapshot.providerId ||
    !snapshot.revision ||
    !snapshot.model
  ) {
    throw sourceEditorError(
      "The low-cost assistant required for source explanations did not provide a verified execution profile. Check the selected assistant provider and retry.",
      "vibe64_source_explanation_execution_profile_missing",
      {},
      503
    );
  }
  return snapshot;
}

function resolvedSourceEditorExecutionProfile(value = null) {
  requiredSourceEditorExecutionProfile(value);
  // Keep the manager's in-memory provenance object intact until execution.
  // Persistence, cache identity, events, and responses use sanitized snapshots.
  return value;
}

function sourceEditorExecutionProfileRequest() {
  return { ...SOURCE_EDITOR_EXPLANATION_EXECUTION_PROFILE };
}

function sourceEditorExecutionProfileIdentity(value = null) {
  const snapshot = sourceEditorExecutionProfileSnapshot(value);
  if (
    !snapshot ||
    snapshot.profileId !== SOURCE_EDITOR_EXPLANATION_EXECUTION_PROFILE.profileId ||
    snapshot.workloadId !== SOURCE_EDITOR_EXPLANATION_EXECUTION_PROFILE.workloadId
  ) {
    return "";
  }
  return JSON.stringify([
    snapshot.providerId,
    snapshot.profileId,
    snapshot.workloadId,
    snapshot.revision,
    snapshot.model,
    snapshot.thinking
  ]);
}

function sourceEditorVibe64UserIdentity(vibe64User = null) {
  if (!isPlainObject(vibe64User)) {
    return "";
  }
  const identity = toText(
    vibe64User.username ||
    vibe64User.osUsername ||
    vibe64User.email ||
    vibe64User.id
  ).toLowerCase();
  return identity
    ? crypto.createHash("sha256").update(identity).digest("hex")
    : "";
}

function sourceEditorAgentOperationOptions(context = {}, options = {}, {
  providerId = ""
} = {}) {
  return {
    ...options,
    providerId: toText(providerId || context.agentProviderId),
    runtime: context.runtime || null,
    session: context.session || null,
    vibe64User: context.vibe64User || null
  };
}

/**
 * @param {TerminalsService} terminals
 * @param {object} [context]
 */
async function describeSourceEditorAgentProvider(terminals, context = {}) {
  const decision = await terminals.resolveAssistantPurpose({ purpose: "source_explanation" }, {
    runtime: context.runtime,
    session: context.session,
    vibe64User: context.vibe64User
  });
  if (!decision.available) throw sourceEditorError(decision.message, decision.reasonCode, {}, 409);
  return { providerId: decision.effectiveSelection.engineId, accountIdentitySignature: decision.connectionIdentity, decision };
}

/**
 * @param {TerminalsService} terminals
 * @param {object} [context]
 */
async function resolveSourceEditorAgentExecutionProfile(terminals, context = {}) {
  // readable-check: allow method-probe - test asserts error: a terminal service without the low-cost profile is refused with execution_profile_missing
  if (typeof terminals.resolveEphemeralAgentExecutionProfile !== "function") {
    throw sourceEditorError(
      "The selected assistant provider cannot resolve the low-cost profile required for source explanations.",
      "vibe64_source_explanation_execution_profile_missing",
      {},
      503
    );
  }
  const resolved = await terminals.resolveEphemeralAgentExecutionProfile(
    context.assistantHelper.scope,
    sourceEditorExecutionProfileRequest(),
    {
      assistantSelection: context.assistantHelper.selection,
      vibe64User: context.vibe64User,
      expectedConnectionIdentity: context.assistantHelper.connectionIdentity
    }
  );
  const executionProfile = requiredSourceEditorExecutionProfile(resolved);
  if (executionProfile.providerId !== toText(context.agentProviderId)) {
    throw sourceEditorError(
      "The selected assistant provider returned a low-cost profile for a different provider.",
      "vibe64_source_explanation_execution_profile_missing",
      {},
      503
    );
  }
  return resolved;
}

/**
 * @param {TerminalsService} terminals
 * @param {object} context
 * @param {object} input
 * @param {object} [options]
 */
async function runSourceEditorHelperTurn(terminals, context, input, options = {}) {
  const { onEvent: forwardEvent = async () => {} } = options;
  const helper = context.assistantHelper;
  const result = await terminals.runEphemeralAgentChatTurn(helper.scope, {
    ...input,
    executionProfile: resolvedSourceEditorExecutionProfile(context.agentExecutionProfile)
  }, {
    assistantSelection: helper.selection,
    vibe64User: context.vibe64User,
    expectedConnectionIdentity: helper.connectionIdentity,
    signal: context.signal,
    async onEvent(event) {
      if (event.type === "thread") helper.conversationId = toText(event.threadId);
      else if (event.type === "turn") helper.runId = toText(event.turnId);
      else if (event.type === "helper-execution") helper.executionId = toText(event.executionId);
      if (["thread", "turn", "helper-execution"].includes(event.type)) await context.retainAssistantHelper();
      await forwardEvent(event);
    }
  });
  helper.conversationId = toText(result?.threadId) || helper.conversationId;
  helper.runId = toText(result?.turnId) || helper.runId;
  await context.retainAssistantHelper();
  return result;
}

export {
  describeSourceEditorAgentProvider,
  requiredSourceEditorExecutionProfile,
  resolvedSourceEditorExecutionProfile,
  resolveSourceEditorAgentExecutionProfile,
  runSourceEditorHelperTurn,
  SOURCE_EDITOR_EXPLANATION_EXECUTION_PROFILE,
  sourceEditorAgentOperationOptions,
  sourceEditorExecutionProfileFromFailure,
  sourceEditorExecutionProfileIdentity,
  sourceEditorExecutionProfileRequest,
  sourceEditorExecutionProfileSnapshot,
  sourceEditorVibe64UserIdentity
};
