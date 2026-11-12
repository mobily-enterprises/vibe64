// How Codex, OpenCode and Claude prepare a message for the Main conversation and record its delivery.

import { randomUUID } from "node:crypto";
import { upstreamMessageId } from "./openCodeConversationStorage.js";
import { vibe64SessionDebugLog } from "@local/vibe64-runtime/server/sessionDebugLog";
import { recordSessionGitCommandActor, sessionGitCommandActorFromMetadata } from "./sessionGitCommandActor.js";
import { clearCodexAppServerContextRefreshPending } from "./codexContextRenewalSignals.js";
import { openCodeModel } from "@jskit-ai/assistant-core/server/opencode-process";
import { conversationActorMetadata, conversationReviewActorMetadata } from "./conversationActor.js";
import { VIBE64_ASSISTANT_ENGINE_IDS } from "@local/vibe64-runtime/shared";
import { claudeConversationError, openCodeError, throwVibe64OpenCodeError } from "./terminalShared.js";
import { codexAppServerTurnSettings } from "@local/vibe64-runtime/server/codexAppServerSessionBridge";
import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";
import { learningSessionExecutionRoot, readSessionConversationContext } from "./mainConversationContext.js";
import { normalizeText, toText } from "@jskit-ai/kernel/shared/support/normalize";
import { doNothing } from "@local/vibe64-core/shared/doNothing";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("./types.js").OpenCodeHostPreparation} OpenCodeHostPreparation */
/** @typedef {import("./types.js").OpenCodeConversationEvents} OpenCodeConversationEvents */
/** @typedef {import("./types.js").OpenCodeConversationPresentation} OpenCodeConversationPresentation */
/** @typedef {import("./types.js").OpenCodeSharedRuntime} OpenCodeSharedRuntime */
/** @typedef {import("@local/vibe64-core/server/types").PublishSessionChanged} PublishSessionChanged */
/** @typedef {import("./types.js").RecordSessionGitCommandActor} RecordSessionGitCommandActor */

// Failed dispatches remembered for admission inspection, newest last.
const MAX_FAILED_OPENCODE_DISPATCHES = 256;

/**
 * Main message policy runs at the existing native owner's preparation and
 * completion phases. Native context/startup and failure health remain host
 * facilities; this binding owns actor admission, Genesis rendering and receipts.
 */
function createCodexMainMessagePreparation(sessionId, env, nativePreparation) {
  async function prepareMessage(input, prepared, { starting, selected }) {
    const { runtime, executionRoot, workdir, messageId, actorContext: vibe64User } = prepared;
    const learningRoot = await learningSessionExecutionRoot(runtime, sessionId);
    if (learningRoot && (executionRoot !== learningRoot || workdir !== learningRoot)) {
      throw new Error("Learning message preparation belongs to a different native execution root.");
    }
    if (!starting) {
      const { turnOwnership } = prepared;
      const { session: currentSession, threadId, turnId } = selected;
      const ownershipMatchesTurn = Boolean(
        turnOwnership &&
        normalizeText(turnOwnership.threadId) === threadId &&
        normalizeText(turnOwnership.turnId) === turnId
      );
      if (ownershipMatchesTurn && turnOwnership.reusable !== true) {
        return {
          value: {
            code: "vibe64_agent_turn_owner_conflict",
            delivered: false,
            error: "This assistant turn belongs to another user. Your message will be sent when that turn finishes.",
            ok: false,
            operationOutcome: "active_turn_owned_by_another_user",
            refreshRecommended: true,
            retryable: true,
            threadId,
            turnId
          },
          session: currentSession
        };
      }
      if (learningRoot) return null;
      let actorMetadata = ownershipMatchesTurn && turnOwnership.reusable === true
        ? sessionGitCommandActorFromMetadata(currentSession)
        : null;
      if (actorMetadata?.ok !== true) {
        actorMetadata = await recordSessionGitCommandActor({
          env,
          reason: "agent-message",
          runtime,
          session: currentSession,
          sourceRoot: executionRoot,
          threadId,
          vibe64User,
          workdir
        });
      } else {
        vibe64SessionDebugLog("server.codexTerminal.appServerMessage.turnOwnershipReused", {
          messageId,
          sessionId,
          threadId,
          turnId
        });
      }
      if (actorMetadata?.ok === false) {
        return {
          value: {
            code: actorMetadata.code || "vibe64_codex_turn_steer_failed",
            error: actorMetadata.error || "GitHub identity is not available for the user who authorized this assistant message.",
            ok: false,
            operationOutcome: "steer_git_actor_unavailable",
            refreshRecommended: true,
            threadId,
            turnId
          }
        };
      }
      return null;
    }
    const { agentSettings, preparedSession, thread, userRequest } = prepared;
    let stageStartedAt = Date.now();
    const actorResult = learningRoot ? null : await recordSessionGitCommandActor({
      env,
      overwrite: true,
      reason: "codex-prompt",
      runtime,
      session: preparedSession,
      sourceRoot: executionRoot,
      threadId: thread.threadId,
      vibe64User,
      workdir
    });
    vibe64SessionDebugLog("server.codexTerminal.appServerPrompt.stage", {
      durationMs: Date.now() - stageStartedAt,
      messageId,
      sessionId,
      stage: "git-actor"
    });
    if (actorResult?.ok === false) {
      throw new Error(actorResult.error || "GitHub identity is not available for the user who authorized this Codex prompt.");
    }
    const refreshMetadata = preparedSession.metadata || {};
    const providerContextRefreshPending = codexContextRefreshPending(preparedSession);
    stageStartedAt = Date.now();
    const genesisTask = normalizeText(input.genesisTask);
    const needsOpeningPrompt = sessionNeedsOpeningPrompt(preparedSession);
    const rendered = genesisTask || needsOpeningPrompt
      ? await runtime.renderPrompt(sessionId, {
        input,
        request: userRequest,
        task: genesisTask || "start"
      })
      : { prompt: userRequest };
    vibe64SessionDebugLog("server.codexTerminal.appServerPrompt.stage", {
      durationMs: Date.now() - stageStartedAt,
      messageId,
      sessionId,
      stage: "prompt-render"
    });
    const renderedPrompt = normalizeText(rendered?.prompt);
    if (!renderedPrompt) {
      throw new Error("The assistant prompt is empty.");
    }
    vibe64SessionDebugLog("server.codexTerminal.appServerPrompt.prepared", {
      messageCount: 1,
      messageId,
      sessionId,
      threadId: thread.threadId
    });
    prepared.refreshMetadata = refreshMetadata;
    prepared.providerContextRefreshPending = providerContextRefreshPending;
    return {
      renderedPrompt,
      get turnSettings() {
        return codexAppServerTurnSettings({ agentSettings, cwd: workdir });
      }
    };
  }

  function finishMessage(input, prepared, outcome) {
    if (Object.hasOwn(outcome, "error")) {
      return nativePreparation.finishMessage(input, prepared, outcome);
    }
    return recordCodexMainMessageDelivery(sessionId, prepared);
  }

  return Object.freeze({
    readContext: nativePreparation.readContext,
    threadPreparation: nativePreparation.threadPreparation,
    prepareMessage,
    finishMessage
  });
}

async function recordCodexMainMessageDelivery(sessionId, prepared) {
  const { runtime } = prepared;
  const { preparedSession, effectiveSettings, providerContextRefreshPending, refreshMetadata, thread } = prepared;
  const briefingWasDelivered = !sessionBriefingIsDelivered(preparedSession);
  const deliveredAt = new Date().toISOString();
  await runtime.store.mutateSession(sessionId, async () => {
    await Promise.all([
      runtime.store.writeMetadataValue(sessionId, "agent_settings_model", effectiveSettings.model),
      runtime.store.writeMetadataValue(sessionId, "agent_settings_provider", effectiveSettings.providerId),
      runtime.store.writeMetadataValue(sessionId, "agent_settings_thinking", effectiveSettings.thinking),
      ...(briefingWasDelivered ? [
        runtime.store.writeMetadataValue(sessionId, "agent_briefing_delivered", "yes"),
        runtime.store.writeMetadataValue(sessionId, "agent_briefing_delivered_at", deliveredAt),
        runtime.store.writeMetadataValue(sessionId, "agent_briefing_transport", "codex_app_server")
      ] : [])
    ]);
  });
  if (providerContextRefreshPending) {
    await clearCodexAppServerContextRefreshPending(runtime.store, sessionId, {
      delivery: "prompt",
      reason: refreshMetadata.codex_context_refresh_reason,
      threadId: refreshMetadata.codex_context_refresh_thread_id || thread.threadId,
      turnId: refreshMetadata.codex_context_refresh_turn_id
    });
  }
}

function sessionBriefingIsDelivered(session = {}) {
  return normalizeText(session.metadata?.agent_briefing_delivered) === "yes";
}

/**
 * A session opens with its briefing until it was delivered, unless a renewal
 * handover already started the conversation. Engines add their own conditions.
 */
function sessionNeedsOpeningPrompt(session = {}) {
  return !sessionBriefingIsDelivered(session) &&
    !normalizeText(session.metadata?.renewal_handover_delivered_at);
}

/**
 * What Claude reads with the person's message while its goal is paused or blocked: its own goal checker is then
 * stood down (`/goal clear`), so without this Claude takes the goal for gone. It names Resume's exact calls, so a
 * person's "continue" resumes the goal in one step.
 * @param {{ status: string, objective?: string }} goal the goal the conversation retains
 */
function retainedGoalNotice(goal) {
  const resume = "\"actionId\":\"vibe64.terminals.main-goal.resume\"";
  return `\n\n[Vibe64: this chat's goal is ${goal.status}, not cleared. A "Goal cleared" line in this chat only means Vibe64 ` +
    `switched Claude's own goal checker off while the goal is ${goal.status}; Vibe64 keeps the goal. ` +
    `Objective: ${JSON.stringify(String(goal.objective || "").slice(0, 500))}. If the person asks to resume or continue the goal, ` +
    `call the application tool assistant_action_contract with {${resume}}, then assistant_action_execute with {${resume},"input":{}}, ` +
    "then end your reply briefly: the goal continues once this reply ends. Otherwise leave it as it is.]";
}

function codexContextRefreshPending(session = {}) {
  return normalizeText(session.metadata?.codex_context_refresh_pending) === "yes";
}

/**
 * The existing Claude owner shares this application policy across its retained entries.
 * Main/scoped/renewal predicates remain the original distinct rules.
 * @param {object} dependencies
 * @param {RuntimeEnv} dependencies.env
 * @param {RecordSessionGitCommandActor} dependencies.recordGitActor
 * @param {PublishSessionChanged} dependencies.publishSessionChanged
 * @param {(timing: object) => void} dependencies.onTiming
 */
function createClaudeConversationMessagePolicy({
  env,
  recordGitActor,
  publishSessionChanged,
  onTiming
}) {
  const error = claudeConversationError;
  const ENGINE = "claude";
  async function prepareMessage(entry, input, { context: ctx, message, steering, renewal, deliveryTiming }) {
    if (entry.profile && message.length > entry.profile.limits.maxInputCharacters) throw error("Claude helper input exceeded its limit.", { code: "vibe64_claude_helper_input_too_large" });
    // JSKIT's delivery observer records these declared marks when it supplies one.
    const started = performance.now();
    const stages = {};
    const mark = stage => {
      if (deliveryTiming) deliveryTiming(stage);
      else stages[stage] = Math.round(performance.now() - started);
    };
    const learningRoot = await learningSessionExecutionRoot(ctx.runtime, ctx.sessionId);
    if (!deliveryTiming) mark("learning-root");
    if (!ctx.assistantScope && !entry.profile && !learningRoot) {
      const actor = await recordGitActor({
        env,
        overwrite: !steering,
        reason: "agent-message",
        runtime: ctx.runtime,
        session: ctx.session,
        sourceRoot: ctx.workdir,
        threadId: entry.id,
        vibe64User: ctx.vibe64User,
        workdir: ctx.workdir
      });
      mark("git-actor");
      if (actor?.ok === false) throw error(actor.error, { code: actor.code });
    }
    let prompt = message;
    // Only Main owns a session briefing; scoped assistant contexts carry no session.
    const needsOpeningPrompt = entry.main && !steering && !entry.sent && sessionNeedsOpeningPrompt(ctx.session);
    if (!renewal && entry.main && !/^\/goal(?:\s|$)/u.test(message) && (needsOpeningPrompt || input.genesisTask)) {
      prompt = (await ctx.runtime.renderPrompt(ctx.sessionId, {
        input,
        request: message,
        task: input.genesisTask || "start"
      }))?.prompt || message;
      mark("genesis-rendered");
    }
    const retainedGoal = entry.main && !renewal && !entry.profile && !ctx.assistantScope && !/^\/goal(?:\s|$)/u.test(message)
      ? entry.pausedGoal || entry.blockedGoal : null;
    if (retainedGoal) prompt += retainedGoalNotice(retainedGoal);
    if (!deliveryTiming) {
      onTiming({
        sessionId: ctx.sessionId,
        conversationId: entry.id,
        messageId: input.messageId,
        stages,
        elapsedMs: Math.round(performance.now() - started)
      });
    }
    // The attachment owner already added validated paths to the prompt.
    if (input.attachments?.length && (entry.profile || ctx.assistantScope)) {
      throw error("These attachments cannot be passed to Claude.", { code: "vibe64_claude_attachments_unsupported" });
    }
    return prompt;
  }

  function skipAdmission(entry, event) {
    return !entry.main || event.renewal;
  }

  function check(entry, ctx) {
    if (entry.turn?.active && ctx.turnOwnership?.reusable === false) {
      throw error("This turn belongs to another user.", { code: "vibe64_agent_turn_owner_conflict" });
    }
  }

  async function messageMetadata(_entry, event) {
    const { input, context: ctx } = event;
    return {
      ...input.turnMetadata,
      ...await conversationActorMetadata({ vibe64User: ctx.vibe64User }),
      ...conversationReviewActorMetadata(input.turnMetadata)
    };
  }

  async function admitMessage(_entry, event) {
    const { input, context: ctx, message, messageId, uuid, actorMetadata } = event;
    const conversationTurn = await ctx.runtime.store.writeConversationUserMessage(ctx.sessionId, {
      messageId,
      text: toText(input.displayMessage) || message,
      attachments: input.displayAttachments,
      turnMetadata: { ...actorMetadata, assistantSelection: ctx.selection, engineId: ENGINE, upstreamMessageId: uuid }
    });
    await publishSessionChanged(ctx.sessionId, {
      reason: "claude-stream-message-delivered",
      payload: {
        conversationLogPatch: { type: "upsert-turn", turn: conversationTurn }
      }
    });
    return conversationTurn;
  }

  return Object.freeze({
    skipAdmission,
    check,
    prepareMessage,
    messageMetadata,
    admitMessage
  });
}

/**
 * @param {object} dependencies
 * @param {ProjectService} dependencies.project
 * @param {RuntimeEnv} dependencies.env
 * @param {RecordSessionGitCommandActor} dependencies.recordGitActor
 * @param {OpenCodeHostPreparation} dependencies.hostPreparation
 * @param {OpenCodeConversationEvents} dependencies.events
 * @param {OpenCodeConversationPresentation} dependencies.presentation
 * @param {OpenCodeSharedRuntime} dependencies.sharedRuntime
 */
function createOpenCodeMainMessagePreparation({
  project,
  env,
  recordGitActor,
  hostPreparation,
  events,
  presentation,
  sharedRuntime
}) {
  const { prepareProcess, storedUpstreamSessionId, upstreamSessionOptions } = hostPreparation;
  const { writeRun, messageMonitorProjection } = events;
  const { publishConversationTurn } = presentation;
  /**
   * This server's own failed dispatches, by native prompt ID: whether the
   * prompt request was made, and the shared OpenCode servers current when it
   * started and when it ended. The request reached one of them, or a server
   * started and replaced in between. Memory only: a dispatch an earlier
   * server made is never proved unsent.
   */
  const failedDispatches = new Map();

  function rememberDispatch(nativeId, dispatch) {
    failedDispatches.delete(nativeId);
    if (dispatch) failedDispatches.set(nativeId, dispatch);
    if (failedDispatches.size > MAX_FAILED_OPENCODE_DISPATCHES) failedDispatches.delete(failedDispatches.keys().next().value);
  }

  /**
   * OpenCode stores a prompt under the ID Vibe64 gave it when it admits it, and
   * only the server process that received the request can store it. A prompt
   * missing from the conversation's complete history therefore never arrived
   * when this server's dispatch of it ended without making the request, or when
   * every server that could have received it has stopped: the process owner
   * replaces a shared server only after proving that its process exited. A
   * turn still dispatching or observing the prompt proves nothing.
   */
  function provedNotAdmitted(nativeId, key) {
    const dispatch = failedDispatches.get(nativeId);
    const turn = sharedRuntime.turns.get(key);
    if (!dispatch || turn?.active && toText(turn.inputMessageId) === nativeId) return false;
    return !dispatch.requested || !dispatch.servers.includes(sharedRuntime.current);
  }

  async function contextFor(sessionId = "", options = {}) {
    return readSessionConversationContext("opencode", project, sessionId, options);
  }

  async function prepareMessageInput(sessionId = "", input = {}, options = {}) {
    const message = toText(input.message);
    if (!message) {
      return {
        value: {
          code: "vibe64_opencode_message_empty",
          delivered: false,
          error: "OpenCode message input is empty.",
          ok: false
        }
      };
    }
    const context = await contextFor(sessionId, options);
    const messageId = toText(input.messageId) || randomUUID();
    return { context, message, messageId };
  }

  async function prepareMessage(sessionId = "", input = {}, options = {}) {
    const { onPromptRejected = doNothing } = input;
    const prepared = await prepareMessageInput(sessionId, input, options);
    if (Object.hasOwn(prepared, "value")) return prepared;
    const { context, message, messageId } = prepared;
    return {
      context,
      message,
      messageId,
      get key() {
        return context.key;
      },
      input: {
        duplicate: undefined,
        get id() {
          return upstreamMessageId(messageId);
        },
        get threadId() {
          return storedUpstreamSessionId(context);
        },
        get workdir() {
          return context.workdir;
        },
        onPromptRejected: () => onPromptRejected()
      },
      application: {
        writeRun: (turn, state, error) => writeRun(context, turn, state, error),
        monitor: messageMonitorProjection(context),
        async prepare() {
          const process = await prepareProcess(context, options);
          return {
            process,
            get session() {
              return upstreamSessionOptions(context);
            }
          };
        },
        commit(conversationTurn) {
          return publishConversationTurn(context, conversationTurn, "opencode-server-message-delivered");
        }
      },
      project(result, actorFailure) {
        if (result.ownerConflict) {
          return {
            code: "vibe64_agent_turn_owner_conflict",
            delivered: false,
            error: "This assistant turn belongs to another user. Your message will be sent when that turn finishes.",
            ok: false,
            refreshRecommended: true,
            retryable: true,
            thread: { id: result.threadId },
            turn: result.turn
          };
        }
        if (result.failure) {
          const { error, threadId: currentThreadId, recovery } = result.failure;
          if (recovery) return throwVibe64OpenCodeError(error);
          if (actorFailure) {
            return actorFailure;
          }
          const failureCode = toText(error?.code).replace(/^assistant_opencode_/u, "vibe64_opencode_");
          if (failureCode.startsWith("vibe64_opencode_")) {
            return {
              code: failureCode,
              delivered: false,
              error: toText(error?.message) || "OpenCode prompt delivery failed.",
              ok: false,
              refreshRecommended: true,
              retryable: error?.retryable === true ||
              ["vibe64_opencode_start_timeout", "vibe64_opencode_events_timeout"].includes(failureCode),
              thread: { id: currentThreadId },
              turn: result.failure.turn
            };
          }
          throw error;
        }
        return result;
      }
    };
  }

  async function prepareMessageInspection(sessionId = "", input = {}, options = {}) {
    const messageId = toText(input.messageId);
    if (!messageId) {
      throw openCodeError("vibe64_opencode_message_id_required", "Admission inspection requires a message ID.");
    }
    const context = await contextFor(sessionId, options);
    const threadId = storedUpstreamSessionId(context);
    if (toText(input.threadId) !== threadId) {
      throw openCodeError("vibe64_opencode_thread_mismatch", "Admission inspection requires the original assistant thread.");
    }
    return {
      process: await prepareProcess(context, options),
      threadId,
      get inputMessageId() {
        return upstreamMessageId(messageId);
      },
      // A history that could not be read decides nothing. A complete one
      // without the prompt proves it never arrived only as provedNotAdmitted says.
      project(observation) {
        if (!observation) return { ok: true, admission: "unknown", messageId, threadId };
        const { accepted } = observation;
        const nativeId = upstreamMessageId(messageId);
        if (accepted) rememberDispatch(nativeId, null);
        return {
          ok: true,
          admission: accepted ? "accepted" : provedNotAdmitted(nativeId, context.key) ? "not-admitted" : "unknown",
          messageId,
          threadId,
          turnId: accepted ? nativeId : ""
        };
      }
    };
  }

  async function prepareDeliveredMessage(sessionId = "", input = {}, options = {}) {
    const { onPromptSending = doNothing } = input;
    const prepared = await prepareMessage(sessionId, input, options);
    if (Object.hasOwn(prepared, "value")) return prepared;
    const { context, message, messageId } = prepared;
    const duplicate = await context.runtime.store.conversationMessageIdExists(context.sessionId, messageId);
    let actorFailure = null;
    let actorMetadata = null;
    // The shared server current as the prompt request starts; unset until dispatch.
    let dispatchServer;
    prepared.input.duplicate = duplicate;
    return {
      key: prepared.key,
      input: prepared.input,
      application: {
        writeRun: prepared.application.writeRun,
        monitor: prepared.application.monitor,
        async prepare({ overwrite, threadId }) {
          const learningRoot = await learningSessionExecutionRoot(context.runtime, context.sessionId);
          const actor = learningRoot ? null : await recordGitActor({
            env,
            overwrite,
            reason: "agent-message",
            runtime: context.runtime,
            session: context.session,
            sourceRoot: sessionSourcePath(context.session),
            threadId,
            vibe64User: options.vibe64User,
            workdir: context.workdir
          });
          if (actor?.ok === false) {
            actorFailure = {
              code: actor.code || "vibe64_opencode_git_actor_unavailable",
              delivered: false,
              error: actor.error || "GitHub identity is not available for this OpenCode message.",
              ok: false,
              refreshRecommended: true,
              retryable: true
            };
            throw new Error(actorFailure.error);
          }
          return prepared.application.prepare();
        },
        async prompt() {
          actorMetadata = {
            ...input.turnMetadata,
            ...await conversationActorMetadata({
              vibe64User: options.vibe64User
            }),
            ...conversationReviewActorMetadata(input.turnMetadata)
          };
          const genesisTask = toText(input.genesisTask);
          const conversation = genesisTask
            ? null
            : await context.runtime.store.readConversationLogPage(context.sessionId, { limit: 1 });
          const needsOpeningPrompt = Boolean(
            genesisTask || (
              !conversation?.pagination?.totalTurnCount &&
            sessionNeedsOpeningPrompt(context.session)
            )
          );
          const rendered = needsOpeningPrompt
            ? await context.runtime.renderPrompt(context.sessionId, {
              input,
              request: message,
              task: genesisTask || "start"
            })
            : { prompt: message };
          const renderedPrompt = toText(rendered?.prompt) || message;
          return {
            get agent() {
              return context.selection.agentId;
            },
            get model() {
              return openCodeModel(context.selection);
            },
            get prompt() {
              return { text: renderedPrompt };
            },
            get attachments() {
              return input.attachments;
            },
            beforeDispatch: threadId => {
              dispatchServer = sharedRuntime.current;
              return onPromptSending({
                threadId, displayAttachments: input.displayAttachments, turnMetadata: actorMetadata
              });
            }
          };
        },
        async commit(admitted) {
          const conversationTurn = await context.runtime.store.writeConversationUserMessage(
            context.sessionId,
            {
              attachments: input.displayAttachments,
              messageId,
              text: toText(input.displayMessage) || message,
              turnMetadata: {
                ...input.turnMetadata,
                assistantSelection: context.selection,
                ...actorMetadata,
                engineId: VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE,
                upstreamMessageId: toText(admitted?.id)
              }
            }
          );
          await prepared.application.commit(conversationTurn);
          return conversationTurn;
        }
      },
      project(result) {
        // A failure after dispatch began is remembered for a later inspection;
        // any other result makes an earlier record of this prompt obsolete.
        rememberDispatch(prepared.input.id, result.failure && dispatchServer !== undefined
          ? { requested: result.failure.attempted === true, servers: [dispatchServer, sharedRuntime.current] }
          : null);
        return prepared.project(result, actorFailure);
      }
    };
  }

  return Object.freeze({
    inspection: prepareMessageInspection,
    contextFor,
    prepareMessageInput,
    message: prepareDeliveredMessage
  });
}

export {
  createClaudeConversationMessagePolicy,
  createCodexMainMessagePreparation,
  createOpenCodeMainMessagePreparation,
  sessionBriefingIsDelivered
};
