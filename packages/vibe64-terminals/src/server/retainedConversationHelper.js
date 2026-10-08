import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { authenticatedVibe64User } from "@local/vibe64-core/server/actionContext";
import { vibe64AgentExecutionProfileAuditSnapshot } from "@local/vibe64-runtime/shared";

// The original Colleague retained Helper lifetime. The parent supplies its own
// private root and durable receipt; native execution remains with Terminals.
function createRetainedConversationHelper({ terminals, root, receipt, workflowEngineId }) {
  if (!path.isAbsolute(root || "") || typeof receipt?.read !== "function" ||
      typeof receipt?.write !== "function" || typeof workflowEngineId !== "function") {
    throw new TypeError("A retained Helper requires its original parent root, receipt and workflow selection.");
  }
  async function cleanup(context) {
    const helper = await receipt.read();
    if (!helper) return;
    const helperRoot = path.join(root, helper.scope.id);
    if (!/^summary_[a-f0-9-]+$/u.test(helper.scope.id) || helper.scope.workdir !== path.join(helperRoot, "workdir") || helper.scope.runtimeRoot !== path.join(helperRoot, "runtime")) throw new Error("The retained summary has invalid cleanup paths.");
    const result = await terminals.deleteEphemeralAgentConversation(helper.scope, {
      conversationId: helper.conversationId, cleanupExecutionId: helper.executionId,
      ...(helper.executionProfile ? { executionProfile: helper.executionProfile } : {})
    }, { assistantSelection: helper.selection, vibe64User: authenticatedVibe64User(context) });
    if (result?.ok !== true) throw new Error(result?.error || "The summary Helper could not be closed. Retry before starting another summary.");
    await receipt.write(null);
    await rm(helperRoot, { recursive: true, force: true });
  }

  async function requireHelper(context, workloadId) {
    const decision = await terminals.resolveAssistantPurpose({ purpose: workloadId, workflowEngineId: await workflowEngineId(context) }, { vibe64User: authenticatedVibe64User(context) });
    if (!decision.available) throw Object.assign(new Error(`${decision.message ? `${String(decision.message).slice(0, 512)} ` : ""}Choose an available Helper for this workflow in AI Accounts → Model routing, then try again.`), {
      code: "vibe64_colleague_helper_unavailable", statusCode: 409
    });
    return decision;
  }

  async function runHelper(context, { workloadId, stableContext, outputSchema, promptLabel, data, signal }) {
    const user = authenticatedVibe64User(context);
    await cleanup(context);
    let responseText, failure;
    try {
      signal.throwIfAborted();
      const decision = await requireHelper(context, workloadId);
      const id = `summary_${randomUUID()}`;
      const helperRoot = path.join(root, id);
      const helper = { scope: { id, workdir: path.join(helperRoot, "workdir"), runtimeRoot: path.join(helperRoot, "runtime"), environment: {},
        stableContext },
      selection: decision.effectiveSelection, connectionIdentity: decision.connectionIdentity, conversationId: "", runId: "", executionId: "" };
      await receipt.write(helper);
      const options = { assistantSelection: helper.selection, vibe64User: user, expectedConnectionIdentity: helper.connectionIdentity,
        signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]),
        async onEvent(event) {
          if (event.type === "thread") helper.conversationId = String(event.threadId || "");
          else if (event.type === "turn") helper.runId = String(event.turnId || "");
          else if (event.type === "helper-execution") helper.executionId = String(event.executionId || "");
          else return;
          await receipt.write(helper);
        }
      };
      await mkdir(helper.scope.workdir, { recursive: true, mode: 0o700 });
      await mkdir(helper.scope.runtimeRoot, { recursive: true, mode: 0o700 });
      const executionProfile = await terminals.resolveEphemeralAgentExecutionProfile(helper.scope, { profileId: "helper", workloadId }, options);
      helper.executionProfile = vibe64AgentExecutionProfileAuditSnapshot(executionProfile);
      await receipt.write(helper);
      const response = await terminals.runEphemeralAgentChatTurn(helper.scope, {
        executionProfile, outputSchema, promptLabel,
        prompt: JSON.stringify(data)
      }, options);
      if (response?.ok !== true || ["starting", "inProgress", "failed", "interrupted", "cancelled"].includes(response.status)) throw new Error(response?.error || "The Helper did not finish.");
      responseText = response.text;
    } catch (error) { failure = error; }
    try { await cleanup(context); } catch (error) { failure = error; }
    if (failure) throw failure;
    return responseText;
  }

  return Object.freeze({ cleanup, runHelper });
}

export { createRetainedConversationHelper };
