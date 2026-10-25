import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { vibe64AgentExecutionProfileAuditSnapshot } from "@local/vibe64-runtime/shared";

// One lifecycle for short tool-less assistant helpers (session naming, Save
// commit subjects, prompt hints). Each feature supplies only its prompt and the
// durable record that retains the helper until its native conversation closes:
// record = { read() -> helper | null, write(helper), retire() }.
// fail(message, code, reason, details) builds the feature's own error; reason is
// one of cleanup_paths_invalid, cleanup_failed, failed, conversation_missing or
// execution_profile_missing.

function text(value = "") {
  return String(value || "").trim();
}

function executionProfileSnapshot(value) {
  try {
    return vibe64AgentExecutionProfileAuditSnapshot(value);
  } catch {
    return null;
  }
}

function helperRoot(stateRoot, id) {
  return path.join(stateRoot, "assistant-helpers", id);
}

async function cleanupAssistantHelper({ agent, fail, prefix, record, stateRoot, vibe64User = null } = {}) {
  const helper = await record.read();
  if (!helper) return;
  const id = text(helper.scope?.id);
  const root = helperRoot(stateRoot, id);
  if (
    !new RegExp(`^${prefix}_[a-f0-9-]+$`, "u").test(id) ||
    helper.scope.workdir !== path.join(root, "workdir") ||
    helper.scope.runtimeRoot !== path.join(root, "runtime")
  ) {
    throw fail("The saved assistant helper has invalid cleanup paths.", undefined, "cleanup_paths_invalid");
  }
  const deleted = await agent.deleteEphemeralConversation(helper.scope, {
    conversationId: helper.conversationId,
    cleanupExecutionId: helper.executionId,
    ...(helper.executionProfile ? { executionProfile: helper.executionProfile } : {})
  }, { assistantSelection: helper.selection, vibe64User });
  if (deleted?.ok !== true) {
    throw fail(
      deleted?.error || "The assistant helper could not be closed. Cleanup will be retried when this session closes.",
      deleted?.code, "cleanup_failed", deleted?.details
    );
  }
  // Retire ownership after native cleanup, before removing the workdir a
  // cleanup retry would need.
  await record.retire();
  await rm(root, { recursive: true, force: true });
}

async function runAssistantHelperTurn({
  agent,
  fail,
  outputSchema,
  prefix,
  profile,
  prompt,
  promptLabel,
  record,
  resolveIdentity,
  signal = null,
  stableContext,
  stateRoot,
  vibe64User = null
} = {}) {
  const cleanup = () => cleanupAssistantHelper({ agent, fail, prefix, record, stateRoot, vibe64User });
  // The record retains a failed cleanup across restarts. Close its exact
  // native conversation before starting another helper.
  await cleanup();
  const { connectionIdentity, selection } = await resolveIdentity();
  const id = `${prefix}_${randomUUID()}`;
  const root = helperRoot(stateRoot, id);
  const helper = {
    scope: {
      id,
      environment: {},
      runtimeRoot: path.join(root, "runtime"),
      workdir: path.join(root, "workdir"),
      stableContext
    },
    selection,
    connectionIdentity,
    conversationId: "",
    runId: "",
    executionId: ""
  };
  const retain = () => record.write(helper);
  const options = {
    assistantSelection: selection,
    vibe64User,
    expectedConnectionIdentity: connectionIdentity,
    ...(signal ? { signal } : {}),
    async onEvent(event = {}) {
      if (event.type === "thread" || event.type === "turn") {
        if (text(event.threadId)) helper.conversationId = text(event.threadId);
        if (event.type === "turn") helper.runId = text(event.turnId);
      } else if (event.type === "helper-execution") {
        helper.executionId = text(event.executionId);
      } else {
        return;
      }
      await retain();
    }
  };
  let result;
  let resolvedProfile = null;
  let failure;
  try {
    await retain();
    await mkdir(helper.scope.workdir, { recursive: true });
    await mkdir(helper.scope.runtimeRoot, { recursive: true });
    signal?.throwIfAborted();
    const executionProfile = await agent.resolveEphemeralExecutionProfile(helper.scope, profile, options);
    resolvedProfile = vibe64AgentExecutionProfileAuditSnapshot(executionProfile);
    helper.executionProfile = resolvedProfile;
    await retain();
    signal?.throwIfAborted();
    result = await agent.runEphemeralChatTurn(helper.scope, {
      executionProfile,
      outputSchema,
      prompt: typeof prompt === "function" ? prompt(resolvedProfile) : prompt,
      promptLabel
    }, options);
    if (result?.ok !== true) {
      throw fail(result?.error || "The assistant helper did not finish.", result?.code, "failed");
    }
    if (!helper.conversationId) {
      throw fail("The assistant helper did not identify its native conversation.", undefined, "conversation_missing");
    }
  } catch (error) {
    failure = error;
  }
  try {
    await cleanup();
  } catch (error) {
    if (failure && error !== failure) error.cause = failure;
    failure = error;
  }
  if (failure) throw failure;
  // The helper must report running on exactly the profile it was given.
  const executionProfile = executionProfileSnapshot(result.executionProfile);
  if (
    !executionProfile ||
    executionProfile.profileId !== profile.profileId ||
    executionProfile.workloadId !== profile.workloadId ||
    JSON.stringify(executionProfile) !== JSON.stringify(resolvedProfile)
  ) {
    throw fail("The assistant helper did not provide a verified execution profile.", undefined, "execution_profile_missing");
  }
  return { executionProfile, text: result.text };
}

// The record a session background task keeps for its helper.
function backgroundTaskHelperRecord(agentContext = {}, taskId = "") {
  const { runtime, session } = agentContext;
  const sessionId = session.sessionId || session.id;
  const write = (assistantHelper, kind) => runtime.store.writeBackgroundTaskEvent(sessionId, taskId, {
    event: { kind }, patch: { assistantHelper }
  });
  return {
    async read() {
      const task = agentContext.renewalCleanup
        ? (await runtime.store.readSessionForRenewal(sessionId)).backgroundTasks.find(({ id }) => id === taskId)
        : await runtime.store.readBackgroundTask(sessionId, taskId);
      return task?.assistantHelper || null;
    },
    write: (helper) => write(helper, "naming-helper"),
    async retire() {
      const clear = () => write(null, "naming-helper-closed");
      if (agentContext.renewalCleanup) await runtime.store.mutateSessionForRenewal(sessionId, clear);
      else await clear();
    }
  };
}

function cleanupBackgroundTaskHelper({ agent, agentContext = {}, fail, prefix, taskId } = {}) {
  return cleanupAssistantHelper({
    agent, fail, prefix,
    record: backgroundTaskHelperRecord(agentContext, taskId),
    stateRoot: agentContext.runtime.stateRoot,
    vibe64User: agentContext.vibe64User
  });
}

function runBackgroundTaskHelperTurn({ agent, agentContext = {}, fail, prefix, profile, taskId, ...turn } = {}) {
  return runAssistantHelperTurn({
    ...turn,
    agent, fail, prefix, profile,
    record: backgroundTaskHelperRecord(agentContext, taskId),
    async resolveIdentity() {
      const decision = await agent.resolveAssistantPurpose({ purpose: profile.workloadId }, agentContext);
      if (!decision.available) throw fail(decision.message, decision.reasonCode, "failed");
      return { connectionIdentity: decision.connectionIdentity, selection: decision.effectiveSelection };
    },
    stateRoot: agentContext.runtime.stateRoot,
    vibe64User: agentContext.vibe64User
  });
}

export {
  cleanupAssistantHelper,
  cleanupBackgroundTaskHelper,
  runAssistantHelperTurn,
  runBackgroundTaskHelperTurn
};
