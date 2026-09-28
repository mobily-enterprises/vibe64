import { randomUUID } from "node:crypto";
import { readWatchedConversation, watchUpdate } from "./attention.js";

const assignmentCommands = new Set([
  "vibe64.colleague.assignment.message.send", "vibe64.colleague.assignment.review.create", "vibe64.colleague.assignment.update"
]);
const openStatuses = new Set(["active", "waiting", "needs-user"]);
const fail = (message) => Object.assign(new Error(message), { statusCode: 409, code: "vibe64_colleague_assignment_conflict" });

function assignmentSummary(assignment, detail = false) {
  return {
    assignmentId: assignment.assignmentId, requestMessageId: assignment.requestMessageId,
    projectSlug: assignment.projectSlug, sessionId: assignment.sessionId, conversationId: assignment.conversationId,
    reviewerConversationId: assignment.reviewerConversationId || "",
    request: assignment.request.slice(0, detail ? 24000 : 1000), requestTruncated: !detail && assignment.request.length > 1000,
    criteria: assignment.criteria, status: assignment.status, summary: assignment.summary, evidence: assignment.evidence || "",
    turnLimit: assignment.turnLimit, turnsUsed: assignment.turns.filter((turn) => turn.status !== "rejected").length,
    ...(detail ? { turns: assignment.turns.map(({ message, ...turn }) => turn), amendments: assignment.amendments } : {})
  };
}

// Assignments retain intent and account for sends. Native turns, product actions,
// watches and Colleague's existing worker still own execution and wakeups.
function createAssignmentOperations({ actions, persist, transcript }) {
  function scoped(context, assignment) {
    return { surface: "app", channel: "automation", requestMeta: context.requestMeta,
      projectSlug: assignment.projectSlug, colleague: context.colleague };
  }
  async function execute(context, assignment, actionId, input) {
    const result = await actions.execute({ actionId, input, context: scoped(context, assignment) });
    if (result?.ok === false || result?.readError) throw Object.assign(fail(result.error || "The agent operation failed."), { statusCode: result.statusCode || 409 });
    return result;
  }
  function find(state, id) {
    const assignment = state.record.assignments?.find((item) => item.assignmentId === id);
    if (!assignment) throw fail("This assignment does not exist. Read the assignment list first.");
    return assignment;
  }
  function requireUser(context) {
    if (!context.colleague?.userMessageIds?.length) throw fail("This change needs a new user instruction to Colleague.");
  }
  function requireAuthority(context, assignment) {
    if (!context.colleague?.userMessageIds?.length && !context.colleague?.assignmentIds?.includes(assignment.assignmentId)) {
      throw fail("This update does not authorize work on that assignment.");
    }
    if (!openStatuses.has(assignment.status)) throw fail("This assignment has ended. A new user instruction is needed.");
    if (!context.colleague?.userMessageIds?.length && assignment.status === "needs-user") throw fail("This assignment is waiting for the user.");
  }
  async function inspect(context, assignment, conversationId = assignment.conversationId) {
    return readWatchedConversation(actions, { ...assignment, conversationId }, scoped(context, assignment));
  }
  async function idle(context, assignment) {
    for (const conversationId of [assignment.conversationId, ...(assignment.reviewCreated ? [assignment.reviewerConversationId] : [])]) {
      if ((await inspect(context, assignment, conversationId)).working) throw fail("Wait for the assignment's current agent turn to finish before sending more work or starting review.");
    }
  }
  async function userMessages(state, context) {
    requireUser(context);
    const ids = context.colleague.userMessageIds;
    return (await transcript.readConversationLog(state.key)).flatMap((turn) => turn.messages)
      .filter((message) => message.role === "user" && ids.includes(message.messageId));
  }
  function cancelWatches(state, assignment) {
    for (const watch of state.record.watches) if (watch.assignmentId === assignment.assignmentId) watch.status = "cancelled";
  }
  return {
    async read(state, input) {
      return input.assignmentId ? { ok: true, assignment: assignmentSummary(find(state, input.assignmentId), true) }
        : { ok: true, assignments: (state.record.assignments || []).map((item) => assignmentSummary(item)) };
    },
    async create(state, input, context) {
      const messages = await userMessages(state, context);
      const request = messages.find((message) => message.messageId === input.requestMessageId);
      if (!request) throw fail("Use the message ID of the user's current assignment request.");
      const existing = state.record.assignments?.find((item) => item.assignmentId === input.assignmentId);
      if (existing) {
        if (existing.requestMessageId !== input.requestMessageId || existing.projectSlug !== input.projectSlug ||
            existing.sessionId !== input.sessionId || existing.conversationId !== (input.conversationId || "")) throw fail("That assignment ID already belongs to another request or target.");
        return { ok: true, assignment: assignmentSummary(existing, true) };
      }
      const retained = state.record.assignments || [];
      if (retained.filter((item) => openStatuses.has(item.status)).length >= 16) throw fail("Finish or cancel an assignment first; up to 16 can remain open.");
      if (retained.some((item) => openStatuses.has(item.status) && item.projectSlug === input.projectSlug && item.sessionId === input.sessionId)) {
        throw fail("This session already has an open assignment. Amend it or choose another session to avoid overlapping source work.");
      }
      const assignment = { assignmentId: input.assignmentId, requestMessageId: input.requestMessageId,
        request: request.text, criteria: input.criteria, projectSlug: input.projectSlug, sessionId: input.sessionId,
        conversationId: input.conversationId || "", turnLimit: input.turnLimit ?? 8,
        status: "active", summary: "Ready to send the agreed request.", evidence: "", turns: [], amendments: [] };
      await idle(context, assignment);
      state.record.assignments = retained.filter((item) => openStatuses.has(item.status)).concat(
        retained.filter((item) => !openStatuses.has(item.status)).slice(-7), assignment);
      await persist(state);
      return { ok: true, assignment: assignmentSummary(assignment, true) };
    },
    async review(state, input, context) {
      const assignment = find(state, input.assignmentId);
      requireAuthority(context, assignment);
      if (assignment.status === "needs-user") throw fail("This assignment needs a user decision before continuing.");
      if (assignment.turns.filter((turn) => turn.status !== "rejected").length >= assignment.turnLimit) {
        assignment.status = "needs-user";
        assignment.summary = "There are no turns left for review. Ask the user to extend the assignment.";
        cancelWatches(state, assignment);
        await persist(state);
        throw fail(assignment.summary);
      }
      if (assignment.reviewerConversationId && assignment.reviewCreated) return { ok: true, assignment: assignmentSummary(assignment, true) };
      if (!assignment.turns.some((turn) => turn.recipient === "implementer" && turn.answerId)) throw fail("Wait for the implementer's answer before starting review.");
      await idle(context, assignment);
      assignment.reviewerConversationId ||= `review-${randomUUID()}`;
      await persist(state);
      try {
        await execute(context, assignment, "vibe64.terminals.temporary-conversation.create", {
          sessionId: assignment.sessionId, conversationId: assignment.reviewerConversationId,
          presentation: { title: "Colleague review" }
        });
        assignment.reviewCreated = true;
      } catch (error) {
        assignment.status = "needs-user";
        assignment.summary = `Review creation needs inspection: ${error.message}`.slice(0, 2000);
        await persist(state);
        throw error;
      }
      await persist(state);
      return { ok: true, assignment: assignmentSummary(assignment, true) };
    },
    async send(state, input, context) {
      const assignment = find(state, input.assignmentId);
      requireAuthority(context, assignment);
      const previous = assignment.turns.find((turn) => turn.messageId === input.messageId);
      if (previous) {
        if (previous.message !== input.message || previous.recipient !== input.recipient || previous.planRevision !== (input.planRevision || "")) throw fail("A retry must keep its original message, recipient and plan revision.");
        if (previous.status !== "sent") throw fail("This send was not confirmed. Inspect its conversation before deciding what to do; it will not be repeated automatically.");
        return { ok: true, assignment: assignmentSummary(assignment, true) };
      }
      if (assignment.status === "needs-user") throw fail("This assignment needs a user decision before continuing.");
      if (assignment.turns.some((turn) => ["reserved", "unknown"].includes(turn.status))) throw fail("Inspect and reconcile the interrupted send before starting another agent turn.");
      if (assignment.turns.filter((turn) => turn.status !== "rejected").length >= assignment.turnLimit) {
        assignment.status = "needs-user";
        assignment.summary = "The agent-turn allowance is exhausted. Ask the user whether to add turns.";
        cancelWatches(state, assignment);
        await persist(state);
        throw fail(assignment.summary);
      }
      if (input.recipient === "reviewer" && !assignment.reviewCreated) throw fail("Create the same-session review conversation first.");
      await idle(context, assignment);
      const conversationId = input.recipient === "reviewer" ? assignment.reviewerConversationId : assignment.conversationId;
      const baseline = await inspect(context, assignment, conversationId);
      const replacesWatch = (watch) => watch.assignmentId === assignment.assignmentId && watch.conversationId === conversationId;
      if (state.record.watches.filter((watch) => !replacesWatch(watch) && ["active", "pending", "paused"].includes(watch.status)).length >= 16) throw fail("Cancel or finish an existing watch before sending this request.");
      const turn = { messageId: input.messageId, message: input.message, recipient: input.recipient,
        conversationId, planRevision: input.planRevision || "", status: "reserved", answerId: "",
        implementationTurn: assignment.turns.filter((item) => item.recipient === "implementer" && item.status === "sent").length };
      const watch = { watchId: randomUUID(), assignmentId: assignment.assignmentId, messageId: input.messageId,
        projectSlug: assignment.projectSlug, sessionId: assignment.sessionId, conversationId,
        question: "Follow this assignment through within its original requirements and remaining allowance.",
        condition: "reply", once: true, status: "dispatching", error: "", cursor: watchUpdate({}, baseline).cursor };
      assignment.turns.push(turn);
      assignment.status = "waiting";
      assignment.summary = `Waiting for ${input.recipient}.`;
      // The next request supersedes this participant's old wait. Keep any
      // admitted observation until the worker replies, but never watch two
      // different request IDs against the same participant's next answer.
      for (const previousWatch of state.record.watches) if (replacesWatch(previousWatch)) previousWatch.status = "cancelled";
      state.record.watches = state.record.watches.filter((item) => !["delivered", "cancelled"].includes(item.status)).concat(watch);
      await persist(state);
      try {
        const result = await execute(context, assignment, conversationId ? "vibe64.terminals.temporary-conversation.turn.start" : "vibe64.sessions.agent-message.send", {
          sessionId: assignment.sessionId, ...(conversationId ? { conversationId } : {}),
          messageId: input.messageId, message: input.message, submissionKind: "send",
          ...(input.planRevision ? { planRevision: input.planRevision } : {})
        });
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
      return { ok: true, assignment: assignmentSummary(assignment, true) };
    },
    async update(state, input, context) {
      const assignment = find(state, input.assignmentId);
      requireAuthority(context, assignment);
      if (input.status === "active" || input.extraTurns) {
        const messages = await userMessages(state, context);
        const grantId = messages.at(-1)?.messageId;
        if (!grantId) throw fail("The current user instruction could not be found.");
        if (input.status === "active") {
          // A saved receipt may precede a crash. Observe admission by its actual
          // message ID; absence from a bounded page is never proof of rejection.
          for (const turn of assignment.turns.filter((item) => ["reserved", "unknown"].includes(item.status))) {
            const observed = await inspect(context, assignment, turn.conversationId);
            if (!observed.userMessageIds.includes(turn.messageId)) throw fail("The interrupted message is not confirmed in the current conversation range. Inspect older messages before deciding; no send has been repeated.");
            turn.status = "sent";
          }
          if (assignment.reviewerConversationId && !assignment.reviewCreated) {
            const observed = await execute(context, assignment, "vibe64.terminals.temporary-conversation.read", {
              sessionId: assignment.sessionId, conversationId: assignment.reviewerConversationId, messageLimit: 1
            });
            if (observed.conversationId !== assignment.reviewerConversationId) throw fail("The interrupted review creation is not confirmed. Inspect that conversation before continuing.");
            assignment.reviewCreated = true;
          }
        }
        const extraTurns = assignment.budgetGrants?.includes(grantId) ? 0 : (input.extraTurns || 0);
        if (assignment.turnLimit + extraTurns > 64) throw fail("An assignment can use at most 64 agent turns; start a new scoped assignment after this one ends.");
        for (const message of messages) if (!assignment.amendments.some((item) => item.messageId === message.messageId)) {
          assignment.amendments.push({ messageId: message.messageId, text: message.text });
        }
        assignment.turnLimit += extraTurns;
        if (extraTurns) (assignment.budgetGrants ||= []).push(grantId);
      }
      if (input.status === "ready") {
        await idle(context, assignment);
        const implementationTurns = assignment.turns.filter((turn) => turn.recipient === "implementer" && turn.status === "sent").length;
        if (!input.evidence || !assignment.turns.some((turn) => turn.recipient === "reviewer" && turn.answerId && turn.implementationTurn === implementationTurns)) {
          throw fail("Ready for testing needs concrete evidence and a completed review after the latest implementation turn.");
        }
      }
      assignment.status = input.status;
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
          } else watch.status = "cancelled";
        }
      } else if (input.status !== "waiting") cancelWatches(state, assignment);
      if (input.status === "cancelled") state.record.observations = state.record.observations.filter((item) => item.assignmentId !== assignment.assignmentId);
      await persist(state);
      return { ok: true, assignment: assignmentSummary(assignment, true) };
    }
  };
}

export { assignmentCommands, assignmentSummary, createAssignmentOperations };
