import { rm } from "node:fs/promises";

import { normalizeText } from "@local/vibe64-core/server/core";
import { currentProjectScopeKey } from "@local/vibe64-core/server/projectRequestContext";

import { sourceEditorAgentOperationOptions, sourceEditorExecutionProfileRequest, sourceEditorExecutionProfileSnapshot } from "./explanationProfile.js";
import { deleteSourceEditorExplanationAgentThread, mutateSourceEditorExplanationCleanupRecords, normalizeSourceEditorExplanation, readSourceEditorExplanationCleanupRecord, readSourceEditorExplanationRecord, removeSourceEditorExplanationCleanupRecord, shouldCleanupSourceEditorExplanationRecord, sourceEditorCleanupActiveIds, sourceEditorExplanationMemoryKey, sourceEditorExplanationStore, sourceEditorHelperRoot, writeSourceEditorExplanation } from "./explanationRecords.js";
import { sourceEditorExplanationWithMessage, withSourceEditorExplanationFreshness } from "./explanationStream.js";
import { isPlainObject, sourceEditorError } from "./sourceFiles.js";

// Stopping, cleaning up and deleting source explanations, with the helper
// threads they used.
async function stopSourceEditorExplanation(context = {}, explanationId = "", {
  explanationChats = null,
  explanationTurns,
  terminalService = null
} = {}) {
  const key = sourceEditorExplanationMemoryKey(context, explanationId);
  const pendingTurn = explanationTurns.get(key);
  if (pendingTurn) {
    const current = sourceEditorExplanationStore(explanationChats).get(key);
    if (current) {
      sourceEditorExplanationStore(explanationChats).set(key, { ...current, status: "stopping" });
    }
    pendingTurn.controller.abort();
    await pendingTurn.promise.catch((error) => { if (error?.name !== "AbortError") throw error; });
  }
  if (pendingTurn && !sourceEditorExplanationStore(explanationChats).has(key)) {
    return normalizeSourceEditorExplanation({ id: explanationId, status: "stopped" });
  }
  let explanation = await readSourceEditorExplanationRecord(context, explanationId, { explanationChats });
  const assistantMessageId = explanation.messages.findLast((entry) => entry.role === "assistant")?.id;
  const cleanupRecord = await readSourceEditorExplanationCleanupRecord(context, explanationId);
  const threadId = normalizeText(explanation.agentThreadId);
  const turnId = normalizeText(explanation.agentTurnId);
  if (!pendingTurn && threadId && turnId && cleanupRecord?.helper) {
    const helper = cleanupRecord.helper;
    sourceEditorHelperRoot(context, helper);
    const stopped = await terminalService.stopEphemeralAgentConversation(helper.scope, {
      conversationId: helper.conversationId, runId: helper.runId, cleanupExecutionId: helper.executionId,
      executionProfile: helper.executionProfile
    }, { assistantSelection: helper.selection, vibe64User: context.vibe64User });
    if (stopped?.ok !== true) throw sourceEditorError(stopped?.error || "The source explanation could not be stopped.",
      stopped?.code || "vibe64_source_explanation_agent_interrupt_unconfirmed");
  } else if (!pendingTurn && threadId && turnId) {
    const result = await terminalService.interruptDetachedAgentChatTurn(context.sessionId, {
      executionProfile: sourceEditorExecutionProfileSnapshot(explanation.executionProfile) ||
        sourceEditorExecutionProfileRequest(),
      threadId,
      turnId
    }, sourceEditorAgentOperationOptions(context, {}, {
      providerId: explanation.executionProfile?.providerId
    }));
    if (result?.ok !== true) {
      throw sourceEditorError(
        result?.error || "The agent service did not confirm that this source explanation was stopped.",
        result?.code || "vibe64_source_explanation_agent_interrupt_unconfirmed",
        isPlainObject(result) ? result : { interruptResult: result ?? null },
        result?.statusCode || 502
      );
    }
  }
  // Do not yield between checking the current request and publishing its stopped state.
  const current = sourceEditorExplanationStore(explanationChats).get(
    sourceEditorExplanationMemoryKey(context, explanationId)
  );
  const lastAssistant = current?.messages.findLast((entry) => entry.role === "assistant");
  if (!current || current.agentThreadId !== threadId || current.agentTurnId !== turnId ||
      lastAssistant?.id !== assistantMessageId) {
    return withSourceEditorExplanationFreshness(context, await readSourceEditorExplanationRecord(context, explanationId, {
      explanationChats
    }));
  }
  explanation = current;
  if (lastAssistant?.id) {
    explanation = sourceEditorExplanationWithMessage(explanation, lastAssistant.id, {
      status: "stopped",
      text: lastAssistant.text || "Stopped."
    });
  }
  return withSourceEditorExplanationFreshness(context, await writeSourceEditorExplanation(context, {
    ...explanation,
    error: "",
    status: "stopped"
  }, {
    explanationChats
  }));
}

async function cleanupSourceEditorExplanations(context = {}, input = {}, {
  all = false,
  explanationChats = null,
  explanationTurns,
  terminalService = null
} = {}) {
  const activeIds = sourceEditorCleanupActiveIds(input.activeExplanationIds);
  const originId = normalizeText(input.originId);
  const store = sourceEditorExplanationStore(explanationChats);
  const cleaned = [];
  const cleanedHelpers = [];
  const failures = [];
  const nowMs = Date.now();

  const tasks = [...explanationTurns.values()].filter((task) => task.sessionId === context.sessionId &&
    task.projectScope === currentProjectScopeKey() && (all || shouldCleanupSourceEditorExplanationRecord(task, { activeIds, nowMs, originId })));
  for (const task of tasks) task.controller.abort();
  await Promise.allSettled(tasks.map((task) => task.promise));

  const remaining = await mutateSourceEditorExplanationCleanupRecords(context, async (records) => {
    const nextRecords = [];
    for (const record of records) {
      if (!all && !shouldCleanupSourceEditorExplanationRecord(record, {
        activeIds,
        nowMs,
        originId
      })) {
        nextRecords.push(record);
        continue;
      }

      try {
        const key = sourceEditorExplanationMemoryKey(context, record.id);
        const agentCleanup = await deleteSourceEditorExplanationAgentThread(context, record, {
          terminalService
        });
        store.delete(key);
        if (record.helper) cleanedHelpers.push(record.helper);
        cleaned.push({
          id: record.id,
          status: normalizeText(agentCleanup?.status || "deleted"),
          threadId: record.agentThreadId
        });
      } catch (error) {
        failures.push({
          code: normalizeText(error?.code || "vibe64_source_explanation_cleanup_failed"),
          error: normalizeText(error?.message || "Source explanation cleanup failed."),
          id: record.id,
          threadId: record.agentThreadId
        });
        nextRecords.push(record);
      }
    }
    return nextRecords;
  });

  for (const helper of cleanedHelpers) await rm(sourceEditorHelperRoot(context, helper), { recursive: true, force: true });
  return {
    activeIds: [...activeIds],
    cleaned,
    failureCount: failures.length,
    failures,
    remainingCount: remaining.length
  };
}

async function deleteSourceEditorExplanation(context = {}, explanationId = "", {
  explanationChats = null,
  explanationTurns,
  terminalService = null
} = {}) {
  const store = sourceEditorExplanationStore(explanationChats);
  const key = sourceEditorExplanationMemoryKey(context, explanationId);
  const pendingTurn = explanationTurns.get(key);
  pendingTurn?.controller.abort();
  await pendingTurn?.promise.catch(() => null);
  const explanation = await readSourceEditorExplanationCleanupRecord(context, explanationId) || store.get(key);
  if (!explanation) {
    return {
      agentCleanup: {
        ok: true,
        status: "notFound"
      },
      deleted: false
    };
  }
  const agentCleanup = await deleteSourceEditorExplanationAgentThread(context, explanation, {
    terminalService
  });
  store.delete(key);
  await removeSourceEditorExplanationCleanupRecord(context, explanationId);
  return {
    agentCleanup,
    deleted: true
  };
}

export {
  cleanupSourceEditorExplanations,
  deleteSourceEditorExplanation,
  stopSourceEditorExplanation
};
