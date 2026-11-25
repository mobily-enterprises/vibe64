import { readSessionTimeline } from "@local/vibe64-core/server/sessionTimelineCli";
import { PROBLEM_REPORT_LIMITS } from "@local/vibe64-core/shared/problemReport";
import { vibe64AssistantSelectionFromMetadata } from "@local/vibe64-runtime/shared";
import { assistantRoutingRequestForDisplay, assistantRoutingRequestFromMetadata } from "@local/vibe64-runtime/shared/assistantRouting";
import { workPlanStatusLine, workPlanStep } from "../../shared/assistantWorkPlan.js";
import { readWorkPlan } from "../assistantWorkPlan.js";

// What a problem report says about one session (Report a problem): its routed request (the state Senior, Junior and
// their automatic next steps saved), its plan, its newest turns as who and which AI (never their words), its
// timeline's events in the report's window, its Preview, and the AI it uses. With the person's leave, the chat's
// messages too. Each part is read on its own: one that can't be read says so (`unreadable` with its code) and the
// rest still come. Every value is picked by name from its record, never copied whole; the bundle's masking
// (vibe64-core/shared/problemReport.js) then runs over all of it.

// A timeline line's at, kind and event, and the 24 fields it keeps at most (vibe64-core's sessionTimeline.js).
const EVENT_FIELDS = 27;
const text = (value) => (typeof value === "string" ? value : undefined);
const count = (value) => (Number.isSafeInteger(value) ? value : undefined);
const flag = (value) => (typeof value === "boolean" ? value : undefined);

/** @param {any} error */
function unreadable(error) {
  return { unreadable: String(error?.code || "vibe64_problem_report_part_unreadable") };
}

/** @param {any} selection */
function selectionFacts(selection) {
  if (!selection || typeof selection !== "object") return null;
  return { engineId: text(selection.engineId), modelId: text(selection.modelId), variantId: text(selection.variantId) };
}

/**
 * The routed request as its saved state has it: its stage, status, delivery, error and counts, and which AI each role
 * was given. Never who submitted it (their email) or the follow-up's copies of the conversation's messages.
 * @param {any} metadata
 */
function routingFacts(metadata) {
  const request = assistantRoutingRequestFromMetadata(metadata);
  if (!request) return null;
  const assignments = request.assignments && typeof request.assignments === "object"
    ? Object.fromEntries(Object.entries(request.assignments).map(([role, selection]) => [role, selectionFacts(selection)]))
    : undefined;
  return {
    messageId: text(request.messageId),
    mode: text(request.mode),
    role: text(request.resolvedMode),
    stage: text(request.stage),
    status: text(request.status),
    delivery: text(request.delivery),
    error: text(request.error),
    createdAt: text(request.createdAt),
    resumeAt: text(request.resumeAt),
    steps: count(request.steps),
    stalledTurns: count(request.stalledTurns),
    workflow: flag(request.workflow),
    stopped: flag(request.stopped),
    planInvolved: flag(request.planInvolved),
    attempted: Boolean(request.attemptedMessageId),
    // The automatic next step waiting to be sent: Vibe64's own words for it, never the request or messages it carries.
    followup: request.followup && typeof request.followup === "object"
      ? {
          messageId: text(request.followup.messageId),
          planRevision: text(request.followup.planRevision),
          step: text(request.followup.displayMessage),
          resume: flag(request.followup.resume),
          planCheck: flag(request.followup.planCheck)
        }
      : null,
    engineId: text(request.workflowEngineId),
    assignments,
    submittedByRole: text(request.submittedBy?.role)
  };
}

/** @param {any} plan @param {any} request */
function planFacts(plan, request) {
  if (!plan) return null;
  const step = workPlanStep(plan);
  return {
    status: text(plan.status),
    revision: text(plan.revision),
    title: text(plan.title),
    items: { total: count(plan.total), built: count(plan.built), proven: count(plan.checked) },
    step: step ? { step: step.step, item: count(step.item), items: count(step.items), title: text(step.title) } : null,
    waitsFor: step ? workPlanStatusLine(step, { request }) : undefined,
    archivedAt: text(plan.archivedAt)
  };
}

/**
 * One turn of the chat as the report describes it: when it started and last answered, who asked, which AI and in
 * which role, and how many messages it has, never their words.
 * @param {any} turn
 */
function turnFacts(turn) {
  const messages = Array.isArray(turn?.messages) ? turn.messages : [];
  const metadata = turn?.metadata || {};
  const times = messages.map((message) => text(message?.at)).filter(Boolean).sort();
  return {
    turnId: text(turn?.turnId),
    startedAt: times[0],
    lastAt: times.at(-1),
    asked: Boolean(turn?.user),
    automatic: metadata.actorId === "app" || Boolean(metadata.assistantRouting?.parentMessageId),
    actor: text(metadata.actorDisplayName),
    actorId: text(metadata.actorId),
    role: text(metadata.assistantRouting?.resolvedMode),
    requestedRole: text(metadata.assistantRouting?.requestedMode),
    reason: text(metadata.assistantRouting?.reason),
    engineId: text(metadata.engineId),
    modelId: text(metadata.assistantSelection?.modelId),
    answered: Boolean(turn?.assistant),
    messages: messages.length
  };
}

/** The chat's messages, oldest first, each with who wrote it: only when the person includes them. */
function chatMessages(turns) {
  const messages = turns.flatMap((turn) => (Array.isArray(turn?.messages) ? turn.messages : [])
    .filter((message) => message?.role === "user" || message?.role === "assistant")
    .map((message) => ({
      at: text(message.at),
      role: message.role,
      actor: message.role === "user" ? text(turn?.metadata?.actorDisplayName) : text(turn?.metadata?.assistantRouting?.resolvedMode),
      text: text(message.text) ?? ""
    })));
  return messages.slice(-PROBLEM_REPORT_LIMITS.messages);
}

/** @param {any} status the outputs' status */
function previewFacts(status) {
  if (!status || status.ok === false) {
    return status ? { unreadable: String(status.code || "vibe64_problem_report_part_unreadable"), message: text(status.error) } : null;
  }
  const preview = status.preview || {};
  return {
    state: text(preview.state),
    message: text(preview.message),
    reason: text(preview.reason),
    stopped: flag(preview.stoppedIntent),
    targets: (Array.isArray(status.outputTargets) ? status.outputTargets : []).slice(0, PROBLEM_REPORT_LIMITS.outputs)
      .map((target) => ({ id: text(target?.id), mode: text(target?.mode), presentation: text(target?.presentation?.kind) })),
    testRun: status.previewTestRun ? { targetId: text(status.previewTestRun.targetId), state: text(status.previewTestRun.state) } : null
  };
}

/**
 * A timeline event as its line holds it: the timeline keeps only short strings, numbers and booleans, so anything else
 * in a line (one written by hand or by an older editor) is left out.
 * @param {any} event
 */
function eventFacts(event) {
  return Object.fromEntries(Object.entries(event && typeof event === "object" ? event : {})
    .filter(([, value]) => ["string", "number", "boolean"].includes(typeof value))
    .slice(0, EVENT_FIELDS));
}

async function part(read, facts) {
  try {
    return facts(await read());
  } catch (error) {
    return unreadable(error);
  }
}

/**
 * Reads one session's part of a problem report.
 * @param {object} dependencies
 * @param {{ sessionContext: (sessionId: string) => Promise<{ runtime: any, session: any }> }} dependencies.sessionAccess
 *   whose sessionContext is the session as
 *   the assistant reads it (its runtime, with its store and state root)
 * @param {{ outputTargetStatus: (sessionId: string) => Promise<any> }} dependencies.projectRuntime whose
 *   outputTargetStatus is the session's outputs and Preview
 */
function createProblemReportSessionReader({ sessionAccess, projectRuntime }) {
  /**
   * @param {string} sessionId
   * @param {{ since: number, until: number, includeChat?: boolean }} window
   */
  async function read(sessionId, { since, until, includeChat = false }) {
    const context = await sessionAccess.sessionContext(sessionId);
    const metadata = context.session?.metadata || {};
    const request = assistantRoutingRequestForDisplay(metadata);
    const tail = await context.runtime.store.readConversationTail(sessionId, {
      userLimit: Math.max(PROBLEM_REPORT_LIMITS.turns, PROBLEM_REPORT_LIMITS.messages)
    }).catch((error) => ({ error }));
    const turns = Array.isArray(tail) ? tail : [];
    return {
      sessionId,
      status: text(context.session?.status),
      engine: await part(() => vibe64AssistantSelectionFromMetadata(metadata, { required: false }), selectionFacts),
      routing: await part(() => metadata, routingFacts),
      plan: await part(() => readWorkPlan(context), (plan) => planFacts(plan, request)),
      turns: Array.isArray(tail) ? turns.slice(-PROBLEM_REPORT_LIMITS.turns).map(turnFacts) : unreadable(tail.error),
      events: await part(
        () => readSessionTimeline(context.runtime.stateRoot, sessionId, { since, until }),
        (events) => events.slice(-PROBLEM_REPORT_LIMITS.events).map(eventFacts)
      ),
      preview: await part(() => projectRuntime.outputTargetStatus(sessionId), previewFacts),
      chat: includeChat
        ? { kind: "main", messages: Array.isArray(tail) ? chatMessages(turns) : unreadable(tail.error) }
        : null
    };
  }

  return Object.freeze({ read });
}

export { createProblemReportSessionReader, routingFacts };
