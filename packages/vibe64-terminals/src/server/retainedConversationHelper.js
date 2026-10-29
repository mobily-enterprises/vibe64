import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { authenticatedVibe64User } from "@local/vibe64-core/server/actionContext";
import { VIBE64_AGENT_HELPER_WORKLOAD_LIMITS, vibe64AgentExecutionProfileAuditSnapshot } from "@local/vibe64-runtime/shared";

const DEFAULT_HELPER_TIMEOUT_MS = 120000;

// The original Colleague retained Helper lifetime. The parent supplies its own
// private root, durable receipt and scope prefix (Colleague's summaries keep
// "summary"); native execution remains with Terminals.
function createRetainedConversationHelper({ terminals, root, receipt, scopePrefix = "summary" }) {
  if (!path.isAbsolute(root || "") || typeof receipt?.read !== "function" ||
      typeof receipt?.write !== "function" || !/^[a-z][a-z0-9]{0,31}$/u.test(scopePrefix)) {
    throw new TypeError("A retained Helper requires its original parent root, receipt and scope prefix.");
  }
  const scopePattern = new RegExp(`^${scopePrefix}_[a-f0-9-]+$`, "u");
  // The receipt keeps a Helper whose close is unconfirmed, so it is retried
  // before the next run. Its error names this parent's Helper and keeps the
  // native owner's reason and code.
  function cleanupFailure(reason = "", cause = null) {
    const detail = String(reason || "").trim().slice(0, 512).replace(/[.\s]+$/u, "");
    return Object.assign(new Error(`The ${scopePrefix} Helper could not be closed${detail ? `: ${detail}` : ""}. ` +
      `Retry before starting another ${scopePrefix}.`, cause ? { cause } : undefined), {
      code: "vibe64_retained_helper_cleanup_failed", statusCode: 409
    });
  }
  async function cleanup(context) {
    const helper = await receipt.read();
    if (!helper) return;
    const helperRoot = path.join(root, helper.scope.id);
    if (!scopePattern.test(helper.scope.id) || helper.scope.workdir !== path.join(helperRoot, "workdir") ||
        helper.scope.runtimeRoot !== path.join(helperRoot, "runtime")) throw cleanupFailure(`its saved ${scopePrefix} receipt has invalid cleanup paths`);
    const result = await terminals.deleteEphemeralAgentConversation(helper.scope, {
      conversationId: helper.conversationId, cleanupExecutionId: helper.executionId,
      ...(helper.executionProfile ? { executionProfile: helper.executionProfile } : {})
    }, { assistantSelection: helper.selection, vibe64User: authenticatedVibe64User(context) });
    if (result?.ok !== true) {
      throw cleanupFailure(result?.error, Object.assign(new Error(result?.error || "Its close was not confirmed."), { code: result?.code }));
    }
    await receipt.write(null);
    await rm(helperRoot, { recursive: true, force: true });
  }

  async function requireHelper(context, workloadId) {
    const decision = await terminals.resolveAssistantPurpose({ purpose: workloadId }, { vibe64User: authenticatedVibe64User(context) });
    if (!decision.available) throw Object.assign(new Error(`${decision.message ? `${String(decision.message).slice(0, 512)} ` : ""}Review AI setup, then try again.`), {
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
      const id = `${scopePrefix}_${randomUUID()}`;
      const helperRoot = path.join(root, id);
      const helper = { scope: { id, workdir: path.join(helperRoot, "workdir"), runtimeRoot: path.join(helperRoot, "runtime"), environment: {},
        stableContext },
      selection: decision.effectiveSelection, connectionIdentity: decision.connectionIdentity, conversationId: "", runId: "", executionId: "" };
      await receipt.write(helper);
      const options = { assistantSelection: helper.selection, vibe64User: user, expectedConnectionIdentity: helper.connectionIdentity,
        signal: AbortSignal.any([signal, AbortSignal.timeout(VIBE64_AGENT_HELPER_WORKLOAD_LIMITS[workloadId]?.timeoutMs || DEFAULT_HELPER_TIMEOUT_MS)]),
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
    // A failed run keeps its own reason; its cleanup failure is the cause.
    try { await cleanup(context); } catch (error) { if (failure) failure.cause ??= error; else failure = error; }
    if (failure) throw failure;
    return responseText;
  }

  return Object.freeze({ cleanup, runHelper });
}

export { createRetainedConversationHelper };
