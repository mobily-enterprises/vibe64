import { openCodeModel } from "@jskit-ai/assistant-core/server/opencode-process";
import { normalizeObject } from "@jskit-ai/kernel/shared/support/normalize";
import { toText } from "@local/vibe64-core/shared/toText";
import { openCodeMessageError } from "./openCodeConversationEvents.js";
import { upstreamMessageId, writeOpenCodeSessionMetadata } from "./openCodeConversationStorage.js";
import {
  defineSessionRenewalApprovedHandover,
  defineSessionRenewalOperationId,
  parseSessionRenewalAcknowledgement,
  parseSessionRenewalHandoverOutput,
  sessionRenewalClientMessageId,
  sessionRenewalHandoverPrompt,
  sessionRenewalSeedPrompt
} from "./sessionRenewalHandover.js";
import { sessionRenewalSeedAcknowledgementMetadata } from "./sessionRenewalReceipts.js";
import { openCodeError } from "./terminalShared.js";

/** @typedef {import("./types.js").OpenCodeHostPreparation} OpenCodeHostPreparation */
/** @typedef {import("./types.js").OpenCodeMainMessagePreparation} OpenCodeMainMessagePreparation */
/** @typedef {import("./types.js").OpenCodeLifecyclePreparation} OpenCodeLifecyclePreparation */

/**
 * The handover turn's result, once its handover hash and turn identity are written to the predecessor.
 * @param {object} prepared
 * @param {object} prepared.input
 * @param {string} prepared.operationId
 * @param {string} prepared.clientMessageId
 * @param {object} prepared.context
 * @param {object} nativeResult
 */
async function completeOpenCodeSessionRenewalHandover({
  input,
  operationId,
  clientMessageId,
  context
}, nativeResult) {
  const result = { ...nativeResult, clientMessageId };
  const parsed = parseSessionRenewalHandoverOutput(result.text, {
    source: input.source
  });
  await writeOpenCodeSessionMetadata(context, {
    agent_renewal_handover_hash: parsed.handoverHash,
    agent_renewal_handover_operation_id: operationId,
    agent_renewal_handover_thread_id: result.threadId,
    agent_renewal_handover_turn_id: result.turnId
  });
  return {
    ...parsed,
    ...result,
    ok: true,
    operationId,
    source: input.source
  };
}

/**
 * The successor's seed receipt: it parses the acknowledgement, writes it with the session briefing, and completes the
 * seed result.
 * @param {object} seed
 * @param {string} seed.operationId
 * @param {object} seed.approved the approved renewal handover
 * @param {string} seed.clientMessageId
 * @param {object} seed.context
 */
function createOpenCodeSessionRenewalSeedReceipt({
  operationId,
  approved,
  clientMessageId,
  context
}) {
  let acknowledgement = null;
  let acknowledgedAt = "";

  async function acknowledge(result) {
    try {
      acknowledgement = parseSessionRenewalAcknowledgement(result.text, {
        handoverHash: approved.handoverHash,
        source: approved.source
      });
    } catch (error) {
      error.details = {
        ...(normalizeObject(error.details)),
        clientMessageId,
        handoverPromptAccepted: true,
        threadId: result.threadId,
        turnId: result.turnId
      };
      throw error;
    }
    acknowledgedAt = new Date().toISOString();
    await writeOpenCodeSessionMetadata(context, sessionRenewalSeedAcknowledgementMetadata({
      acknowledgedAt,
      handoverHash: approved.handoverHash,
      operationId,
      threadId: result.threadId,
      transport: "opencode_server",
      turnId: result.turnId
    }));
  }

  async function complete(nativeResult) {
    const result = { ...nativeResult, clientMessageId };
    const proof = result.processExitProof;
    return {
      ...result,
      acknowledgement,
      acknowledgedAt,
      freshThread: result.freshThread,
      handoverHash: approved.handoverHash,
      ok: proof?.exited !== false,
      operationId,
      processExitProof: proof,
      source: approved.source,
      subscriptionDeferred: true
    };
  }

  return Object.freeze({
    acknowledge,
    complete
  });
}

/**
 * OpenCode's session renewal turns: the predecessor's handover and the successor's seed, prepared on the Main
 * conversation's context and host settings. The shared native runtime performs each turn.
 * @param {object} dependencies
 * @param {OpenCodeMainMessagePreparation} dependencies.mainMessagePreparation
 * @param {OpenCodeHostPreparation} dependencies.hostPreparation
 * @param {OpenCodeLifecyclePreparation} dependencies.lifecyclePreparation
 */
function createOpenCodeSessionRenewalPreparation({
  mainMessagePreparation,
  hostPreparation,
  lifecyclePreparation
}) {
  const { contextFor } = mainMessagePreparation;
  const { prepareProcess, upstreamSessionOptions } = hostPreparation;
  const { processRelease } = lifecyclePreparation;
  const OPENCODE_RENEWAL_TIMEOUT_MS = 3 * 60 * 1000;

  function prepareRenewalTurn(target = {}, input = {}, renewal = {}) {
    const { clientMessageId = "" } = input;
    return {
      input: {
        inputMessageId: upstreamMessageId(clientMessageId),
        get prompt() {
          return input.prompt;
        },
        agent: toText(target.selection?.agentId),
        model: openCodeModel(target.selection),
        timeoutMs: OPENCODE_RENEWAL_TIMEOUT_MS,
        readError: openCodeMessageError,
        createError(reason, message, { inputAccepted, ...details }) {
          if (reason === "thread_mismatch") {
            return openCodeError(
              "vibe64_session_renewal_thread_mismatch",
              "The OpenCode predecessor history changed before handover generation.",
              details
            );
          }
          if (reason === "fresh_thread_required") {
            return openCodeError(
              "vibe64_session_renewal_fresh_thread_required",
              "The renewed OpenCode session does not own the expected fresh native history.",
              details
            );
          }
          if (reason === "unrelated_history") {
            return openCodeError(
              "vibe64_session_renewal_fresh_thread_required",
              "The successor OpenCode history contains unrelated conversation and cannot be used for renewal.",
              details
            );
          }
          return openCodeError(
            `vibe64_session_renewal_turn_${reason}`,
            message || (reason === "unreadable"
              ? "The exact OpenCode renewal turn did not produce a readable result."
              : "OpenCode did not finish the session renewal turn."),
            { clientMessageId, handoverPromptAccepted: inputAccepted, ...details },
            502
          );
        }
      },
      options: renewal
    };
  }

  async function prepareRenewalHandover(sessionId = "", input = {}, options = {}) {
    const operationId = defineSessionRenewalOperationId(input.operationId || input.operationKey);
    const context = await contextFor(sessionId, options);
    return {
      process: () => prepareProcess(context, options),
      session: () => upstreamSessionOptions(context),
      turn(target) {
        const clientMessageId = sessionRenewalClientMessageId("handover", operationId);
        const prepared = prepareRenewalTurn(target, {
          clientMessageId,
          get prompt() {
            return sessionRenewalHandoverPrompt({ source: input.source });
          }
        }, { expectedThreadId: toText(input.expectedThreadId) });
        return {
          ...prepared,
          completeResult: nativeResult => completeOpenCodeSessionRenewalHandover({
            input,
            operationId,
            clientMessageId,
            context
          }, nativeResult)
        };
      }
    };
  }

  async function prepareRenewalSeed(sessionId = "", input = {}, options = {}) {
    const operationId = defineSessionRenewalOperationId(input.operationId || input.operationKey);
    const approved = defineSessionRenewalApprovedHandover({
      handover: input.handover,
      handoverHash: input.handoverHash,
      source: input.source
    });
    const context = await contextFor(sessionId, options);
    return {
      process: () => prepareProcess(context, options),
      session: () => upstreamSessionOptions(context),
      turn(target) {
        const clientMessageId = sessionRenewalClientMessageId("seed", operationId);
        const receipt = createOpenCodeSessionRenewalSeedReceipt({
          operationId,
          approved,
          clientMessageId,
          context
        });
        const prepared = prepareRenewalTurn(target, {
          clientMessageId,
          get prompt() {
            return sessionRenewalSeedPrompt(approved);
          }
        }, {
          expectedThreadId: toText(input.expectedThreadId),
          forbiddenThreadId: toText(input.forbiddenThreadId || input.oldThreadId),
          requireFreshHistory: true,
          completeResult: receipt.acknowledge
        });
        return { ...prepared, release: processRelease, completeResult: receipt.complete };
      }
    };
  }

  return Object.freeze({
    prepareRenewalHandover,
    prepareRenewalSeed
  });
}

export {
  createOpenCodeSessionRenewalPreparation
};
