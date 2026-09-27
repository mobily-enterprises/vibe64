import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { assistantRoutingFromMetadata } from "@local/vibe64-runtime/shared/assistantRouting";
import {
  vibe64AgentExecutionProfileAuditSnapshot,
  vibe64AssistantSelectionFromMetadata
} from "@local/vibe64-runtime/shared";

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

async function cleanupSessionNamingHelper({ agent, agentContext = {}, taskId, namingError } = {}) {
  const { runtime, session, vibe64User } = agentContext;
  const sessionId = session.sessionId || session.id;
  const task = agentContext.renewalCleanup
    ? (await runtime.store.readSessionForRenewal(sessionId)).backgroundTasks.find(({ id }) => id === taskId)
    : await runtime.store.readBackgroundTask(sessionId, taskId);
  const helper = task?.assistantHelper;
  if (!helper) return;
  const root = path.join(runtime.stateRoot, "assistant-helpers", helper.scope.id);
  if (
    !/^naming_[a-f0-9-]+$/u.test(helper.scope.id) ||
    helper.scope.workdir !== path.join(root, "workdir") ||
    helper.scope.runtimeRoot !== path.join(root, "runtime")
  ) {
    throw namingError("The saved naming task has invalid cleanup paths.");
  }
  const deleted = await agent.deleteEphemeralConversation(helper.scope, {
    conversationId: helper.conversationId,
    cleanupExecutionId: helper.executionId,
    ...(helper.executionProfile ? { executionProfile: helper.executionProfile } : {})
  }, { assistantSelection: helper.selection, vibe64User });
  if (deleted?.ok !== true) {
    throw namingError(
      deleted?.error || "The naming helper could not be closed. Cleanup will be retried when this session closes.",
      deleted?.code, "cleanup_failed"
    );
  }
  const clear = () => runtime.store.writeBackgroundTaskEvent(sessionId, taskId, {
    event: { kind: "naming-helper-closed" },
    patch: { assistantHelper: null }
  });
  if (agentContext.renewalCleanup) await runtime.store.mutateSessionForRenewal(sessionId, clear);
  else await clear();
  await rm(root, { recursive: true, force: true });
}

async function runSessionNamingHelper({
  agent,
  agentContext = {},
  taskId,
  profile,
  outputSchema,
  prompt,
  promptLabel,
  stableContext,
  namingError
} = {}) {
  const { runtime, session, vibe64User } = agentContext;
  const sessionId = session.sessionId || session.id;
  const cleanup = () => cleanupSessionNamingHelper({ agent, agentContext, taskId, namingError });
  // The owning task retains failed cleanup across restarts. Close its exact
  // native conversation before starting another helper.
  await cleanup();
  const workflowEngineId = assistantRoutingFromMetadata(session.metadata)?.workflowEngineId ||
    vibe64AssistantSelectionFromMetadata(session.metadata).engineId;
  const decision = await agent.resolveAssistantPurpose({ purpose: profile.workloadId, workflowEngineId }, agentContext);
  if (!decision.available) throw namingError(decision.message, decision.reasonCode);
  const id = `naming_${randomUUID()}`;
  const root = path.join(runtime.stateRoot, "assistant-helpers", id);
  const helper = {
    scope: {
      id,
      environment: {},
      runtimeRoot: path.join(root, "runtime"),
      workdir: path.join(root, "workdir"),
      stableContext
    },
    selection: decision.effectiveSelection,
    connectionIdentity: decision.connectionIdentity,
    conversationId: "",
    runId: "",
    executionId: ""
  };
  async function retain() {
    await runtime.store.writeBackgroundTaskEvent(sessionId, taskId, {
      event: { kind: "naming-helper" }, patch: { assistantHelper: helper }
    });
  }

  await retain();
  const options = {
    assistantSelection: helper.selection,
    vibe64User,
    expectedConnectionIdentity: helper.connectionIdentity,
    async onEvent(event) {
      if (event.type === "thread") helper.conversationId = text(event.threadId);
      else if (event.type === "turn") helper.runId = text(event.turnId);
      else if (event.type === "helper-execution") helper.executionId = text(event.executionId);
      else return;
      await retain();
    }
  };
  let result;
  let failure;
  try {
    await mkdir(helper.scope.workdir, { recursive: true });
    await mkdir(helper.scope.runtimeRoot, { recursive: true });
    const executionProfile = await agent.resolveEphemeralExecutionProfile(helper.scope, profile, options);
    helper.executionProfile = vibe64AgentExecutionProfileAuditSnapshot(executionProfile);
    await retain();
    result = await agent.runEphemeralChatTurn(helper.scope, {
      executionProfile, outputSchema, prompt, promptLabel
    }, options);
    if (result?.ok !== true) {
      throw namingError(result?.error || "The assistant could not name this work.", result?.code);
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
  const executionProfile = executionProfileSnapshot(result?.executionProfile);
  if (
    !executionProfile ||
    executionProfile.profileId !== profile.profileId ||
    executionProfile.workloadId !== profile.workloadId
  ) {
    throw namingError("The naming helper did not provide a verified execution profile.",
      undefined, "execution_profile_missing");
  }
  return { executionProfile, text: result.text };
}

export { cleanupSessionNamingHelper, runSessionNamingHelper };
