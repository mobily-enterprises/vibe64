import { randomUUID } from "node:crypto";
import { conversationObservation, readWatchedConversation } from "./attention.js";
import { stateObservation } from "./watchSources.js";
import { assignmentSummary, suspendAssignment } from "./assignments.js";
import { failure, requireResult } from "./colleagueFailure.js";

/** @typedef {import("@jskit-ai/kernel/server/types").ActionCatalogue} ActionCatalogue */
/** @typedef {import("./types.js").WatchSources} WatchSources */
/** @typedef {import("./types.js").ColleagueRecords} ColleagueRecords */
/** @typedef {import("./types.js").ColleagueThreads} ColleagueThreads */
/** @typedef {import("./types.js").ColleagueNameResolver} ColleagueNameResolver */

/**
 * What a Colleague turn reads before it runs: its action context, with each pending observation re-read under the
 * person's current access, the data its prompt carries, and the watches those observations come from.
 * @param {object} dependencies
 * @param {ActionCatalogue} dependencies.actions
 * @param {WatchSources} dependencies.watchSources
 * @param {ColleagueRecords} dependencies.records
 * @param {ColleagueThreads} dependencies.threads
 * @param {ColleagueNameResolver} dependencies.resolveName
 */
function createColleagueTurnInputs({
  actions,
  watchSources,
  records,
  threads,
  resolveName
}) {
  async function workerContext(state, connection, generation, autonomous, userMessageIds, isCurrent) {
    let context = threads.actionContext(state, connection);
    const observations = [];
    for (const observation of state.record.observations.slice()) {
      // Persisted notifications may outlive their original project access.
      try {
        const watch = state.record.watches.find(item => item.watchId === observation.watchId);
        if (watch?.source) {
          await readWatch(watch, context);
        } else {
          requireResult(await actions.execute({
            actionId: "vibe64.sessions.inspect",
            input: { sessionId: observation.focus.sessionId },
            context: { ...context, projectSlug: observation.focus.projectSlug }
          }));
        }
        observations.push(observation);
      } catch (error) {
        const watch = state.record.watches.find(item => item.watchId === observation.watchId);
        if (watch?.status === "pending") {
          watch.status = "paused";
          watch.error = `Watching paused: ${error.message}`.slice(0, 512);
        }
        suspendAssignment(
          state.record,
          observation.assignmentId,
          "Assignment access could not be verified. Resolve access before resuming."
        );
        state.record.observations = state.record.observations.filter(item => item.id !== observation.id);
        await records.persist(state);
      }
    }
    if (!isCurrent()) return null;
    if (autonomous && !observations.length) {
      state.record.status = "ready";
      await records.persist(state);
      return null;
    }
    const assignmentIds = observations.filter(observation => state.record.assignments?.some(assignment =>
      assignment.assignmentId === observation.assignmentId &&
        ["active", "waiting"].includes(assignment.status))).map(observation => observation.assignmentId);
    const observedAssignmentIds = observations.flatMap(observation => observation.assignmentId ? [observation.assignmentId] : []);
    const canRelay = (state.record.assignments || []).some(assignment => observedAssignmentIds.includes(assignment.assignmentId) &&
      assignment.status !== "cancelled" && assignment.links?.some(link => state.record.assignments.some(target =>
      target.assignmentId === link.assignmentId && ["active", "waiting"].includes(target.status))));
    const readOnly = autonomous && !assignmentIds.length && !canRelay;
    context = {
      ...context,
      colleague: {
        ...context.colleague,
        generation,
        autonomous,
        readOnly,
        userMessageIds,
        assignmentIds,
        observedAssignmentIds,
        observationIds: observations.map(observation => observation.id)
      }
    };
    state.operationRunId = randomUUID();
    state.operationContext = context;
    state.observationIds = autonomous ? context.colleague.observationIds : [];
    return { context, observations, readOnly, observedAssignmentIds };
  }

  async function workerData(state, connection, currentContext, autonomous) {
    return {
      assistantName: await resolveName(),
      focus: connection.focus,
      userMessageIds: currentContext.context.colleague.userMessageIds,
      observations: currentContext.observations,
      readOnly: currentContext.readOnly,
      autonomous,
      assignments: (state.record.assignments || []).filter(item =>
        ["active", "waiting", "needs-user"].includes(item.status) || currentContext.observedAssignmentIds.includes(item.assignmentId))
        .map(item => {
          const {
            assignmentId,
            projectSlug,
            sessionId,
            conversationId,
            status,
            summary,
            turnLimit,
            turnsUsed,
            waitingForAssignmentId,
            links
          } = assignmentSummary(item);
          return {
            assignmentId,
            projectSlug,
            sessionId,
            conversationId,
            status,
            summary,
            turnLimit,
            turnsUsed,
            waitingForAssignmentId,
            links
          };
        }),
      ...(state.record.retiredConversation?.operation ? { previousOperation: state.record.retiredConversation.operation } : {})
    };
  }

  /**
   * A watch without a source is a project's own coding conversation.
   */
  function watchSource(watch) {
    if (!watch.source) return null;
    const source = watchSources.get(watch.source);
    if (!source) throw failure("This watch's source is unavailable in this runtime.", "vibe64_colleague_watch_source_unavailable");
    return source;
  }

  async function readWatch(watch, context) {
    const source = watchSource(watch);
    if (!source) return readWatchedConversation(actions, watch, context);
    if (source.kind === "state") return stateObservation(source, await source.read({ ...watch.input }, context));
    return conversationObservation({
      ...requireResult(await source.read(watch, context)),
      replyDuringWork: watch.condition === "reply" && !watch.assignmentId
    });
  }

  return Object.freeze({
    workerContext,
    workerData,
    watchSource,
    readWatch
  });
}

export { createColleagueTurnInputs };
