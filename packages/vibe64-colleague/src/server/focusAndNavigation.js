import { randomUUID } from "node:crypto";
import { learningPlaceOpenTo, learningVocabulary, trainingGuideCommand, trainingGuideRequest } from "@local/vibe64-training/shared/learning-vocabulary";
import { authenticatedVibe64User } from "@local/vibe64-core/server/actionContext";
import { VIBE64_COLLEAGUE_SESSION_PANES } from "../shared/navigationPanes.js";
import { failure } from "./colleagueFailure.js";
import { answerPendingNavigation } from "./colleaguePresentation.js";

/** @typedef {import("./types.js").ColleagueThreads} ColleagueThreads */

/**
 * What a person's browser shows Colleague and what Colleague opens there: the
 * focus each browser reports, and navigation and guide commands for the
 * initiating browser to acknowledge.
 * @param {object} dependencies
 * @param {ColleagueThreads} dependencies.threads
 */
function createColleagueFocusAndNavigation({ threads }) {
  async function readContext(_input, context = {}) {
    const state = await threads.stateFor(context);
    threads.assertCurrentConversation(state, context.colleague?.conversationId);
    if (context.colleague?.userKey && context.colleague.userKey !== state.userKey) {
      throw failure("This Colleague conversation is unavailable.", "conversation_forbidden", 403);
    }
    if (context.requestMeta?.request) state.requestContext = context;
    const connection = state.connections.get(context.colleague?.clientId);
    const focused = context.colleague?.focus || connection?.focus || null;
    return { ok: true, focus: focused || {} };
  }

  async function reportFocus(input, context, { browserBinding } = {}) {
    const state = await threads.stateFor(context);
    if (browserBinding && !browserBinding.current()) throw failure("This browser focus update is no longer current.");
    const connection = state.connections.get(input.clientId) || { clientId: input.clientId };
    connection.focus = input.focus;
    state.connections.set(input.clientId, connection);
    if (browserBinding) {
      if (connection.browserBinding?.owner !== browserBinding.owner) {
        const owner = browserBinding.owner;
        connection.browserBinding = { owner, async release() {
          const current = state.connections.get(input.clientId);
          if (current?.browserBinding?.owner !== owner) return;
          state.connections.delete(input.clientId);
          answerPendingNavigation(current, { ok: false, error: "The initiating browser disconnected." });
          current.focus = null;
        } };
      }
      browserBinding.onRelease(connection.browserBinding.release);
    }
    state.requestContext = context;
    return { ok: true, focus: connection.focus };
  }

  async function navigate(input, context) {
    const state = await threads.stateFor(context);
    if (input.learning && typeof input.learning.open === "boolean" && (input.learning.attemptId || input.learning.stepId)) {
      return { ok: false, error: "open opens or closes the Courses catalogue only. To show a lesson step in the Lesson pane, send learning={attemptId, stepId} without open." };
    }
    if (input.learning?.stepId && !input.learning.attemptId) {
      return { ok: false, error: "Choose the exact lesson attempt before its step." };
    }
    if (input.learning && typeof input.learning.open !== "boolean" && !input.learning.attemptId) {
      return { ok: false, error: "Send learning={open:true|false} for Courses, or learning={attemptId, stepId} for a lesson step." };
    }
    if (input.planView && (!input.sessionId || input.pane || input.conversationId)) {
      return { ok: false, error: "Choose the exact session's Main chat, without another pane or conversation, to open its plan viewer." };
    }
    if (input.databaseTable && (input.databaseView !== "data" || input.pane !== "database" || !input.sessionId)) {
      return { ok: false, error: "Choose the exact session and Database Data view before selecting a table." };
    }
    if (input.databaseView && (input.pane !== "database" || !input.sessionId)) {
      return { ok: false, error: "Choose the exact session and Database pane before selecting a database view." };
    }
    if ((input.integrationId || input.integrationEnvironment) && (input.pane !== "integrations" ||
        (input.integrationEnvironment !== "production" && !input.sessionId))) {
      return { ok: false, error: "Choose Integrations and either a development session or the production environment." };
    }
    if (!input.sessionId && (input.conversationId || VIBE64_COLLEAGUE_SESSION_PANES.includes(input.pane))) {
      return { ok: false, error: "Choose the exact session before opening this conversation or session view." };
    }
    const connection = state.connections.get(context.colleague?.clientId);
    if (!connection) return { ok: false, error: "The initiating browser is no longer connected." };
    if (connection.navigation?.status === "pending") return { ok: false, error: "The browser is still opening the previous view." };
    const command = { id: randomUUID(), projectSlug: input.projectSlug,
      ...(input.pane ? { pane: input.pane } : {}),
      ...(input.integrationId ? { integrationId: input.integrationId } : {}),
      ...(input.integrationEnvironment ? { integrationEnvironment: input.integrationEnvironment } : {}),
      ...(input.databaseView ? { databaseView: input.databaseView } : {}),
      ...(input.databaseTable ? { databaseTable: input.databaseTable } : {}),
      ...(input.planView ? { planView: input.planView } : {}),
      ...(input.learning ? { learning: typeof input.learning.open === "boolean" ? { open: input.learning.open }
        : { attemptId: input.learning.attemptId, ...(input.learning.stepId ? { stepId: input.learning.stepId } : {}) } } : {}),
      sessionId: input.sessionId || "", conversationId: input.conversationId || "", status: "pending" };
    return state.navigation.begin(connection, command);
  }

  // Point at one place of this installation's vocabulary, or open it first:
  // a studio page by its route, Courses, or a project view in the project
  // and session the person has open (the browser's own focus).
  async function guide(input, context) {
    const state = await threads.stateFor(context);
    let guided;
    try { guided = trainingGuideRequest(input); }
    catch (error) { return { ok: false, error: error.message }; }
    const place = learningVocabulary.place(guided.target);
    const user = authenticatedVibe64User(context);
    if (!learningPlaceOpenTo(place, { owner: !user || user.role === "owner" })) {
      return { ok: false, error: `${place.label} is only for the workspace owner, so it cannot be shown to this person.` };
    }
    const connection = state.connections.get(context.colleague?.clientId);
    if (!connection) return { ok: false, error: "The initiating browser is no longer connected." };
    if (connection.navigation?.status === "pending") return { ok: false, error: "The browser is still opening the previous view." };
    const focus = connection.focus || {};
    if (guided.navigate && place.open.pane) {
      if (!focus.projectSlug) return { ok: false, error: `${place.label} is in a project. Open the project with navigation.open first, then guide again.` };
      if (place.open.pane !== "preview" && !focus.sessionId) {
        return { ok: false, error: `${place.label} belongs to a session. Open one of the project's sessions first, then guide again.` };
      }
    }
    const project = guided.navigate && place.open.pane ? { projectSlug: focus.projectSlug, sessionId: focus.sessionId || "" } : {};
    return state.navigation.begin(connection, trainingGuideCommand(guided, { id: randomUUID(), ...project }));
  }

  async function acknowledgeNavigation(input, context) {
    const state = await threads.stateFor(context);
    const connection = state.connections.get(input.clientId);
    return state.navigation.acknowledge(connection, input);
  }

  return Object.freeze({
    context: readContext,
    focus: reportFocus,
    navigate,
    guide,
    acknowledgeNavigation
  });
}

export { createColleagueFocusAndNavigation };
