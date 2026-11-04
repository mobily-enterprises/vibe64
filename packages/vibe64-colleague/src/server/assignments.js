import { randomUUID } from "node:crypto";
import { readWatchedConversation, watchUpdate } from "./attention.js";
import { failure } from "./colleagueFailure.js";
import {
  ACTION_COLLEAGUE_ASSIGNMENT_MESSAGE_SEND,
  ACTION_COLLEAGUE_ASSIGNMENT_RELAY,
  ACTION_COLLEAGUE_ASSIGNMENT_REVIEW_CREATE,
  ACTION_COLLEAGUE_ASSIGNMENT_UPDATE
} from "./colleagueActions.js";

/** @typedef {import("@jskit-ai/kernel/server/types").ActionCatalogue} ActionCatalogue */
/** @typedef {ReturnType<typeof import("@jskit-ai/assistant-core/server/conversation").createConversationTranscript>} ConversationTranscript */

const assignmentCommands = new Set([
  ACTION_COLLEAGUE_ASSIGNMENT_MESSAGE_SEND, ACTION_COLLEAGUE_ASSIGNMENT_REVIEW_CREATE, ACTION_COLLEAGUE_ASSIGNMENT_UPDATE,
  ACTION_COLLEAGUE_ASSIGNMENT_RELAY
]);
const openStatuses = new Set(["active", "waiting", "needs-user"]);

/**
 * An open assignment that cannot proceed waits for the person, optionally
 * with its watches paused.
 */
function suspendAssignment(record, assignmentId, summary, options = {}) {
  const { pauseWatches = false } = options;
  const assignment = record.assignments?.find((item) => item.assignmentId === assignmentId);
  if (!assignment || !["active", "waiting"].includes(assignment.status)) return;
  assignment.status = "needs-user";
  assignment.summary = summary;
  if (pauseWatches) for (const watch of record.watches) if (watch.assignmentId === assignmentId) watch.status = "paused";
}

/**
 * An assignment as Colleague reads it: the list form, or with its links' requests, its turns and its amendments.
 */
function describeAssignment(assignment, detail) {
  return {
    assignmentId: assignment.assignmentId,
    requestMessageId: assignment.requestMessageId,
    projectSlug: assignment.projectSlug,
    sessionId: assignment.sessionId,
    conversationId: assignment.conversationId,
    reviewerConversationId: assignment.reviewerConversationId || "",
    request: detail ? assignment.request : assignment.request.slice(0, 1000),
    requestTruncated: !detail && assignment.request.length > 1000,
    criteria: assignment.criteria,
    status: assignment.status,
    summary: assignment.summary,
    evidence: assignment.evidence || "",
    turnLimit: assignment.turnLimit,
    turnsUsed: assignment.turns.filter((turn) => turn.status !== "rejected").length,
    links: (assignment.links || []).map(({ request, ...link }) => detail ? { ...link, request } : link),
    waitingForAssignmentId: assignment.waitingForAssignmentId || "",
    ...(detail ? { turns: assignment.turns.map(({ message, ...turn }) => turn), amendments: assignment.amendments } : {})
  };
}

function assignmentSummary(assignment) {
  return describeAssignment(assignment, false);
}

function assignmentDetail(assignment) {
  return describeAssignment(assignment, true);
}

/**
 * Assignments retain intent and account for sends. Native turns, product actions,
 * watches and Colleague's existing worker still own execution and wakeups.
 * @param {object} dependencies
 * @param {ActionCatalogue} dependencies.actions
 * @param {(state: object) => Promise<unknown>} dependencies.persist
 * @param {ConversationTranscript} dependencies.transcript
 */
function createAssignmentOperations({
  actions,
  persist,
  transcript
}) {
  function scoped(context, assignment) {
    return {
      surface: "app",
      channel: "automation",
      requestMeta: context.requestMeta,
      projectSlug: assignment.projectSlug,
      colleague: context.colleague
    };
  }
  async function execute(context, assignment, actionId, input) {
    const result = await actions.execute({ actionId, input, context: scoped(context, assignment) });
    if (result?.ok === false || result?.readError) {
      throw failure(result.error || "The agent operation failed.", "vibe64_colleague_assignment_agent_failed", result.statusCode || 409);
    }
    return result;
  }
  function find(state, id) {
    const assignment = state.record.assignments?.find((item) => item.assignmentId === id);
    if (!assignment) throw failure("This assignment does not exist. Read the assignment list first.", "vibe64_colleague_assignment_missing");
    return assignment;
  }
  function requireUser(context) {
    if (!context.colleague?.userMessageIds?.length) throw failure("This change needs a new user instruction to Colleague.", "vibe64_colleague_assignment_instruction_required");
  }
  function requireAuthority(context, assignment) {
    if (!context.colleague?.userMessageIds?.length && !context.colleague?.assignmentIds?.includes(assignment.assignmentId)) {
      throw failure("This update does not authorize work on that assignment.", "vibe64_colleague_assignment_unauthorized");
    }
    if (!openStatuses.has(assignment.status)) throw failure("This assignment has ended. A new user instruction is needed.", "vibe64_colleague_assignment_ended");
    if (!context.colleague?.userMessageIds?.length && assignment.status === "needs-user") {
      throw failure("This assignment is waiting for the user.", "vibe64_colleague_assignment_waiting_for_user");
    }
  }
  async function inspect(context, assignment, conversationId = assignment.conversationId) {
    return readWatchedConversation(actions, { ...assignment, conversationId }, scoped(context, assignment));
  }
  async function idle(context, assignment) {
    for (const conversationId of [assignment.conversationId, ...(assignment.reviewCreated ? [assignment.reviewerConversationId] : [])]) {
      if ((await inspect(context, assignment, conversationId)).working) {
        throw failure("Wait for the assignment's current agent turn to finish before sending more work or starting review.", "vibe64_colleague_assignment_agent_working");
      }
    }
  }
  async function userMessages(state, context) {
    requireUser(context);
    const ids = context.colleague.userMessageIds;
    return (await Promise.all([state.record, ...state.record.previousConversations].map(chat =>
      transcript.readConversationLog(chat.runtimeId)))).flatMap(log => log.flatMap(turn => turn.messages))
      .filter((message) => message.role === "user" && ids.includes(message.messageId));
  }
  function cancelWatches(state, assignment) {
    for (const watch of state.record.watches) if (watch.assignmentId === assignment.assignmentId) watch.status = "cancelled";
  }
  function suspendDependencies(state) {
    // A stopped prerequisite cannot wake its dependents. Propagate that state
    // through the bounded assignment list without another model or scheduler.
    let changed;
    do {
      changed = false;
      for (const assignment of state.record.assignments || []) {
        if (assignment.status !== "waiting" || !assignment.waitingForAssignmentId) continue;
        const dependency = find(state, assignment.waitingForAssignmentId);
        if (["active", "waiting", "ready"].includes(dependency.status)) continue;
        assignment.status = "needs-user";
        assignment.summary = `The required assignment ${dependency.assignmentId} ${dependency.status === "cancelled" ? "was cancelled" : "needs the user"}. Resolve this dependency before resuming.`;
        cancelWatches(state, assignment);
        changed = true;
      }
    } while (changed);
  }

  async function read(state, input) {
    return input.assignmentId ? { ok: true, assignment: assignmentDetail(find(state, input.assignmentId)) }
      : { ok: true, assignments: (state.record.assignments || []).map((item) => assignmentSummary(item)) };
  }

  async function create(state, input, context) {
    const messages = await userMessages(state, context);
    const request = messages.find((message) => message.messageId === input.requestMessageId);
    if (!request) throw failure("Use the message ID of the user's current assignment request.", "vibe64_colleague_assignment_request_missing");
    const existing = state.record.assignments?.find((item) => item.assignmentId === input.assignmentId);
    if (existing) {
      if (existing.requestMessageId !== input.requestMessageId || existing.projectSlug !== input.projectSlug ||
          existing.sessionId !== input.sessionId || existing.conversationId !== (input.conversationId || "")) {
        throw failure("That assignment ID already belongs to another request or target.", "vibe64_colleague_assignment_conflict");
      }
      return { ok: true, assignment: assignmentDetail(existing) };
    }
    const retained = state.record.assignments || [];
    if (retained.filter((item) => openStatuses.has(item.status)).length >= 16) {
      throw failure("Finish or cancel an assignment first; up to 16 can remain open.", "vibe64_colleague_assignment_limit");
    }
    if (retained.some((item) =>
      openStatuses.has(item.status) && item.projectSlug === input.projectSlug && item.sessionId === input.sessionId)) {
      throw failure("This session already has an open assignment. Amend it or choose another session to avoid overlapping source work.", "vibe64_colleague_assignment_session_busy");
    }
    const assignment = {
      assignmentId: input.assignmentId,
      requestMessageId: input.requestMessageId,
      request: request.text,
      criteria: input.criteria,
      projectSlug: input.projectSlug,
      sessionId: input.sessionId,
      conversationId: input.conversationId || "",
      turnLimit: input.turnLimit ?? 8,
      status: "active",
      summary: "Ready to send the agreed request.",
      evidence: "",
      turns: [],
      amendments: []
    };
    await idle(context, assignment);
    const linked = new Set(
      retained.filter((item) => openStatuses.has(item.status)).flatMap((item) => (item.links || []).map((link) => link.assignmentId))
    );
    const keep = new Set(retained.filter((item) => !openStatuses.has(item.status)).slice(-7));
    state.record.assignments = retained.filter((item) => openStatuses.has(item.status) || linked.has(item.assignmentId) || keep.has(item))
      .concat(assignment);
    await persist(state);
    return { ok: true, assignment: assignmentDetail(assignment) };
  }

  async function linkAssignments(state, input, context) {
    const request = (await userMessages(state, context)).find((message) => message.messageId === input.requestMessageId);
    if (!request) throw failure("Use the current user instruction authorizing communication between these assignments.", "vibe64_colleague_assignment_link_request_missing");
    const assignment = find(state, input.assignmentId);
    const related = find(state, input.relatedAssignmentId);
    if (assignment === related) throw failure("Choose two different assignments.", "vibe64_colleague_assignment_link_self");
    requireAuthority(context, assignment);
    requireAuthority(context, related);
    await inspect(context, assignment);
    await inspect(context, related);
    for (const [owner, other] of [[assignment, related], [related, assignment]]) {
      owner.links ||= [];
      const existing = owner.links.find((link) => link.assignmentId === other.assignmentId);
      if (existing?.requestMessageId === request.messageId && existing.purpose !== input.purpose) {
        throw failure("A repeated link must keep its original purpose.", "vibe64_colleague_assignment_link_purpose_changed");
      }
      const link = {
        assignmentId: other.assignmentId,
        purpose: input.purpose,
        requestMessageId: request.messageId,
        request: request.text
      };
      if (existing) Object.assign(existing, link);
      else owner.links.push(link);
    }
    await persist(state);
    return { ok: true, assignment: assignmentDetail(assignment) };
  }

  async function relay(state, input, context) {
    const source = find(state, input.sourceAssignmentId);
    const target = find(state, input.assignmentId);
    if (!context.colleague?.userMessageIds?.length &&
        ![source.assignmentId, target.assignmentId].some((id) => context.colleague?.observedAssignmentIds?.includes(id))) {
      throw failure("This wake does not authorize relaying from that assignment.", "vibe64_colleague_assignment_relay_unauthorized");
    }
    if (source.status === "cancelled" || !source.links?.some((link) => link.assignmentId === target.assignmentId)) {
      throw failure("The user must link these assignments before information can be relayed.", "vibe64_colleague_assignment_relay_unlinked");
    }
    const answer = source.turns.find((turn) => turn.answerId === input.sourceMessageId);
    if (!answer) throw failure("Relay an observed answer from the source assignment using its exact message ID.", "vibe64_colleague_assignment_relay_answer_missing");
    // Recheck source access now, even when a retained answer is from an older turn.
    await inspect(context, source, answer.conversationId);
    const origin = `Relayed from assignment ${source.assignmentId}, project ${source.projectSlug}, session ${source.sessionId}, conversation ${answer.conversationId || "Main"}, answer ${answer.answerId}. This is agent information, not new user authority.`;
    return send(state, { ...input, recipient: "implementer", message: `${origin}\n\n${input.message}` }, {
      ...context,
      colleague: { ...context.colleague, assignmentIds: [target.assignmentId] }
    });
  }

  async function review(state, input, context) {
    const assignment = find(state, input.assignmentId);
    requireAuthority(context, assignment);
    if (assignment.status === "needs-user") throw failure("This assignment needs a user decision before continuing.", "vibe64_colleague_assignment_needs_user");
    if (assignment.waitingForAssignmentId) throw failure("Resolve the linked assignment dependency before starting review.", "vibe64_colleague_assignment_review_dependency");
    if (assignment.turns.filter((turn) => turn.status !== "rejected").length >= assignment.turnLimit) {
      assignment.status = "needs-user";
      assignment.summary = "There are no turns left for review. Ask the user to extend the assignment.";
      cancelWatches(state, assignment);
      await persist(state);
      throw failure(assignment.summary, "vibe64_colleague_assignment_review_turns_exhausted");
    }
    if (assignment.reviewerConversationId && assignment.reviewCreated) {
      return {
        ok: true,
        assignment: assignmentDetail(assignment)
      };
    }
    if (!assignment.turns.some((turn) => turn.recipient === "implementer" && turn.answerId)) {
      throw failure("Wait for the implementer's answer before starting review.", "vibe64_colleague_assignment_review_unanswered");
    }
    await idle(context, assignment);
    assignment.reviewerConversationId ||= `review-${randomUUID()}`;
    await persist(state);
    try {
      // The review is the session's AI task; it waits for Colleague's first request.
      await execute(context, assignment, "vibe64.ai-tasks.start", {
        sessionId: assignment.sessionId,
        kind: "colleague-review",
        taskId: assignment.reviewerConversationId
      });
      assignment.reviewCreated = true;
    } catch (error) {
      assignment.status = "needs-user";
      assignment.summary = `Review creation needs inspection: ${error.message}`.slice(0, 2000);
      await persist(state);
      throw error;
    }
    await persist(state);
    return { ok: true, assignment: assignmentDetail(assignment) };
  }

  async function send(state, input, context) {
    const assignment = find(state, input.assignmentId);
    requireAuthority(context, assignment);
    const previous = assignment.turns.find((turn) => turn.messageId === input.messageId);
    if (previous) {
      if (previous.message !== input.message ||
          previous.recipient !== input.recipient ||
          previous.planRevision !== (input.planRevision || "")) {
        throw failure("A retry must keep its original message, recipient and plan revision.", "vibe64_colleague_assignment_retry_changed");
      }
      if (previous.status !== "sent") {
        throw failure(
          "This send was not confirmed. Inspect its conversation before deciding what to do; it will not be repeated automatically.",
          "vibe64_colleague_assignment_send_unconfirmed"
        );
      }
      return { ok: true, assignment: assignmentDetail(assignment) };
    }
    if (assignment.status === "needs-user") throw failure("This assignment needs a user decision before continuing.", "vibe64_colleague_assignment_needs_user");
    if (assignment.waitingForAssignmentId && assignment.waitingForAssignmentId !== input.sourceAssignmentId) {
      throw failure("This assignment is waiting for an answer from its linked assignment. Relay that answer or update the wait first.", "vibe64_colleague_assignment_waiting_for_link");
    }
    if (assignment.turns.some((turn) => ["reserved", "unknown"].includes(turn.status))) {
      throw failure("Inspect and reconcile the interrupted send before starting another agent turn.", "vibe64_colleague_assignment_send_interrupted");
    }
    if (assignment.turns.filter((turn) => turn.status !== "rejected").length >= assignment.turnLimit) {
      assignment.status = "needs-user";
      assignment.summary = "The agent-turn allowance is exhausted. Ask the user whether to add turns.";
      cancelWatches(state, assignment);
      await persist(state);
      throw failure(assignment.summary, "vibe64_colleague_assignment_turns_exhausted");
    }
    if (input.recipient === "reviewer" && !assignment.reviewCreated) throw failure("Create the same-session review conversation first.", "vibe64_colleague_assignment_review_missing");
    await idle(context, assignment);
    const conversationId = input.recipient === "reviewer" ? assignment.reviewerConversationId : assignment.conversationId;
    const baseline = await inspect(context, assignment, conversationId);
    const replacesWatch = (watch) => watch.assignmentId === assignment.assignmentId && watch.conversationId === conversationId;
    if (state.record.watches.filter((watch) =>
      !replacesWatch(watch) && ["active", "pending", "paused"].includes(watch.status)).length >= 16) {
      throw failure("Cancel or finish an existing watch before sending this request.", "vibe64_colleague_assignment_watch_limit");
    }
    const turn = {
      messageId: input.messageId,
      message: input.message,
      recipient: input.recipient,
      conversationId,
      planRevision: input.planRevision || "",
      status: "reserved",
      answerId: "",
      ...(input.sourceAssignmentId ? { sourceAssignmentId: input.sourceAssignmentId, sourceMessageId: input.sourceMessageId } : {}),
      implementationTurn: assignment.turns.filter((item) => item.recipient === "implementer" && item.status === "sent").length
    };
    const watch = {
      watchId: randomUUID(),
      assignmentId: assignment.assignmentId,
      messageId: input.messageId,
      projectSlug: assignment.projectSlug,
      sessionId: assignment.sessionId,
      conversationId,
      question: "Follow this assignment through within its original requirements and remaining allowance.",
      condition: "reply",
      once: true,
      status: "dispatching",
      error: "",
      cursor: watchUpdate({}, baseline).cursor
    };
    assignment.turns.push(turn);
    assignment.status = "waiting";
    delete assignment.waitingForAssignmentId;
    assignment.summary = `Waiting for ${input.recipient}.`;
    // The next request supersedes this participant's old wait. Keep any
    // admitted observation until the worker replies, but never watch two
    // different request IDs against the same participant's next answer.
    for (const previousWatch of state.record.watches) if (replacesWatch(previousWatch)) previousWatch.status = "cancelled";
    state.record.watches = state.record.watches.filter((item) => !["delivered", "cancelled"].includes(item.status)).concat(watch);
    await persist(state);
    try {
      const result = await execute(
        context,
        assignment,
        conversationId ? "vibe64.terminals.ai-task-conversation.turn.start" : "vibe64.sessions.agent-message.send",
        {
          sessionId: assignment.sessionId,
          ...(conversationId ? { conversationId } : {}),
          messageId: input.messageId,
          message: input.message,
          submissionKind: "send",
          ...(input.planRevision ? { planRevision: input.planRevision } : {})
        }
      );
      turn.status = "sent";
      watch.expectedRunId = String(result.runId || "");
      watch.status = "active";
    } catch (error) {
      turn.status = error.statusCode >= 400 && error.statusCode < 500 ? "rejected" : "unknown";
      watch.status = "paused";
      assignment.status = "needs-user";
      assignment.summary = `Agent request needs attention: ${error.message}`.slice(0, 2000);
      await persist(state);
      throw error;
    }
    await persist(state);
    return { ok: true, assignment: assignmentDetail(assignment) };
  }

  async function update(state, input, context) {
    const assignment = find(state, input.assignmentId);
    requireAuthority(context, assignment);
    if (input.waitingForAssignmentId === "" && assignment.waitingForAssignmentId) requireUser(context);
    if (input.waitingForAssignmentId) {
      if (input.status !== "waiting" || !assignment.links?.some((link) => link.assignmentId === input.waitingForAssignmentId)) {
        throw failure("A dependency wait needs a user-authorized link and waiting status.", "vibe64_colleague_assignment_wait_unlinked");
      }
      const dependency = find(state, input.waitingForAssignmentId);
      if (!["active", "waiting"].includes(dependency.status)) {
        throw failure("That assignment is no longer progressing. Read its result or ask the user to resolve the dependency.", "vibe64_colleague_assignment_dependency_stopped");
      }
      const seen = new Set([assignment.assignmentId]);
      for (let current = dependency; current; current = current.waitingForAssignmentId
        ? find(state, current.waitingForAssignmentId)
        : null) {
        if (seen.has(current.assignmentId)) {
          throw failure("These assignments would wait on each other. Ask the user to resolve the dependency.", "vibe64_colleague_assignment_dependency_cycle");
        }
        seen.add(current.assignmentId);
      }
    }
    if (input.status === "active" || input.extraTurns) {
      const messages = await userMessages(state, context);
      const grantId = messages.at(-1)?.messageId;
      if (!grantId) throw failure("The current user instruction could not be found.", "vibe64_colleague_assignment_instruction_missing");
      if (input.status === "active") {
        // A saved receipt may precede a crash. Observe admission by its actual
        // message ID; absence from a bounded page is never proof of rejection.
        for (const turn of assignment.turns.filter((item) => ["reserved", "unknown"].includes(item.status))) {
          const observed = await inspect(context, assignment, turn.conversationId);
          if (!observed.userMessageIds.includes(turn.messageId)) {
            throw failure(
              "The interrupted message is not confirmed in the current conversation range. Inspect older messages before deciding; no send has been repeated.",
              "vibe64_colleague_assignment_message_unconfirmed"
            );
          }
          turn.status = "sent";
        }
        if (assignment.reviewerConversationId && !assignment.reviewCreated) {
          const observed = await execute(context, assignment, "vibe64.terminals.ai-task-conversation.read", {
            sessionId: assignment.sessionId,
            conversationId: assignment.reviewerConversationId,
            messageLimit: 1
          });
          if (observed.conversationId !== assignment.reviewerConversationId) {
            throw failure("The interrupted review creation is not confirmed. Inspect that conversation before continuing.", "vibe64_colleague_assignment_review_unconfirmed");
          }
          assignment.reviewCreated = true;
        }
      }
      const extraTurns = assignment.budgetGrants?.includes(grantId) ? 0 : (input.extraTurns || 0);
      if (assignment.turnLimit + extraTurns > 64) {
        throw failure("An assignment can use at most 64 agent turns; start a new scoped assignment after this one ends.", "vibe64_colleague_assignment_turn_limit");
      }
      for (const message of messages) {
        if (!assignment.amendments.some((item) => item.messageId === message.messageId)) {
          assignment.amendments.push({ messageId: message.messageId, text: message.text });
        }
      }
      assignment.turnLimit += extraTurns;
      if (extraTurns) (assignment.budgetGrants ||= []).push(grantId);
    }
    if (input.status === "ready") {
      if (assignment.waitingForAssignmentId) throw failure("Resolve the linked assignment dependency before marking this work ready.", "vibe64_colleague_assignment_ready_dependency");
      await idle(context, assignment);
      const implementationTurns = assignment.turns.filter((turn) => turn.recipient === "implementer" && turn.status === "sent").length;
      if (!input.evidence ||
          !assignment.turns.some((turn) =>
            turn.recipient === "reviewer" && turn.answerId && turn.implementationTurn === implementationTurns)) {
        throw failure("Ready for testing needs concrete evidence and a completed review after the latest implementation turn.", "vibe64_colleague_assignment_ready_unreviewed");
      }
    }
    assignment.status = input.status;
    if (input.status !== "waiting") delete assignment.waitingForAssignmentId;
    else if (input.waitingForAssignmentId !== undefined) assignment.waitingForAssignmentId = input.waitingForAssignmentId;
    assignment.summary = input.summary;
    if (input.evidence !== undefined) assignment.evidence = input.evidence;
    if (input.status === "active") {
      for (const watch of state.record.watches) {
        if (watch.assignmentId !== assignment.assignmentId) continue;
        const latest = assignment.turns.findLast((turn) => turn.conversationId === watch.conversationId && turn.status === "sent");
        if (latest?.messageId === watch.messageId && !latest.answerId) {
          watch.status = "active";
          // Explicit resumption reconciles even a result that was observed
          // while another failed read had suspended the assignment.
          delete watch.cursor;
        } else {
          watch.status = "cancelled";
        }
      }
    } else if (input.status !== "waiting") {
      cancelWatches(state, assignment);
    }
    if (input.status === "cancelled") {
      state.record.observations = state.record.observations.filter((item) => item.assignmentId !== assignment.assignmentId);
    }
    await persist(state);
    if (assignment.reviewCreated && ["ready", "cancelled"].includes(input.status)) await endReview(context, assignment, input.status);
    return { ok: true, assignment: assignmentDetail(assignment) };
  }

  /**
   * The assignment ended, so its review task does too: Finish when the work is ready, Cancel otherwise or when the
   * review still waits on something, so it never holds the session's one AI task.
   */
  async function endReview(context, assignment, status) {
    const target = { sessionId: assignment.sessionId, taskId: assignment.reviewerConversationId };
    try {
      const finished = status === "ready" ? await execute(context, assignment, "vibe64.ai-tasks.finish", target) : null;
      if (!["done", "not_done"].includes(finished?.task?.phase)) await execute(context, assignment, "vibe64.ai-tasks.cancel", target);
    } catch {
      // A person already closed the review: the assignment's outcome stands either way.
    }
  }

  return Object.freeze({
    suspendDependencies,
    read,
    create,
    link: linkAssignments,
    relay,
    review,
    send,
    update
  });
}

export { assignmentCommands, assignmentSummary, createAssignmentOperations, suspendAssignment };
