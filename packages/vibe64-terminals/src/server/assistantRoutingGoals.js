import {
  VIBE64_ASSISTANT_SELECTION_METADATA,
  serializeVibe64AssistantSelection,
  sameVibe64AssistantSelection,
  vibe64AssistantSelectionFromMetadata
} from "@local/vibe64-runtime/shared";
import {
  assistantGoalObjective,
  assistantRoutingFromMetadata,
  assistantRoutingGoalFromMetadata,
  assistantGoalIsActive
} from "@local/vibe64-runtime/shared/assistantRouting";
import { withSelection, failure } from "./assistantRoutingRequests.js";

/** @typedef {import("./types.js").SessionAgentManager} SessionAgentManager */
/** @typedef {import("./types.js").AssistantRoutingRecords} AssistantRoutingRecords */
/** @typedef {import("./types.js").AssistantRoutingDecisions} AssistantRoutingDecisions */

/**
 * A goal's routing: the selection a goal pins, and its rebinding when the chosen model changes.
 * @param {object} dependencies
 * @param {AssistantRoutingRecords} dependencies.records
 * @param {AssistantRoutingDecisions} dependencies.decisions
 * @param {SessionAgentManager} dependencies.agent
 * @param {(sessionId: string, selection: object, context: object) => Promise<unknown>} dependencies.prepareSelection
 */
function createAssistantRoutingGoals({
  records,
  decisions,
  agent,
  prepareSelection
}) {
  async function applyGoalSelection(sessionId, selection, preferences, context) {
    const observed = await agent.readGoal(sessionId, context);
    if (observed?.status !== "available") return "unobserved";
    if (!assistantGoalIsActive(observed.goal)) return "none";
    const previous = assistantRoutingGoalFromMetadata(context.session.metadata);
    const current = previous?.selection || vibe64AssistantSelectionFromMetadata(context.session.metadata);
    if ((selection?.engineId || current.engineId) !== current.engineId || preferences.mode === "auto") return "after-goal";
    const goal = { ...observed.goal, objective: assistantGoalObjective(observed.goal.objective, previous) };
    let selected = selection ? withSelection(context, selection) : context;
    const prepared = await prepareGoal(sessionId, { action: "rebind", selection, goal }, {
      ...selected,
      session: {
        ...selected.session,
        metadata: {
          ...selected.session.metadata,
          assistant_routing: JSON.stringify(preferences)
        }
      }
    });
    selection ||= prepared.pinned.selection;
    selected = withSelection(context, selection);
    const result = await agent.updateSessionSettings(sessionId, {
      threadId: observed.threadId,
      model: selection.modelId,
      effort: selection.variantId
    }, selected);
    if (result?.ok === false) throw Object.assign(new Error(result.error), result);
    // Preserve a concurrent pause/cancel or replacement's objective and status.
    return context.runtime.store.mutateSession(sessionId, async () => {
      const latest = assistantRoutingGoalFromMetadata({
        assistant_routing_goal: await context.runtime.store.readMetadataValue(sessionId, "assistant_routing_goal")
      });
      if (latest?.objective !== previous?.objective || latest?.selection && latest.selection.engineId !== current.engineId) {
        return "after-goal";
      }
      await context.runtime.store.writeMetadataValue(sessionId, "assistant_routing_goal", JSON.stringify({
        ...prepared.pinned,
        ...(latest?.status !== previous?.status ? { status: latest.status } : {})
      }));
      return "next-turn";
    });
  }

  async function prepareGoal(sessionId, input, context) {
    const preferences = assistantRoutingFromMetadata(context.session.metadata);
    if (!preferences) return { input, context };
    const previous = assistantRoutingGoalFromMetadata(context.session.metadata);
    if (preferences.mode === "auto" && !(input.action === "resume" && previous)) {
      throw failure("Choose Senior or Junior before starting a goal.");
    }
    const rebind = input.action === "rebind";
    if (rebind && !input.goal) throw failure("The native goal is unavailable. Read its status again before changing its model.");
    const saved = await records.readRoutingSettings();
    const current = vibe64AssistantSelectionFromMetadata(context.session.metadata);
    const resume = input.action === "resume" && previous;
    const changedPreferences = resume && (preferences.mode !== previous.mode ||
      (preferences.override ? !sameVibe64AssistantSelection(preferences.override, previous.selection) : Boolean(previous.override)));
    const retainGoalSettings = resume && (!changedPreferences || preferences.mode === "auto" ||
      current.engineId !== (previous.workflowEngineId || previous.selection.engineId));
    const mode = retainGoalSettings ? previous.mode : preferences.mode;
    const state = {
      mode,
      review: false,
      submittedBy: context.vibe64User || null,
      configuration: (retainGoalSettings && previous.configuration) || {
        revision: saved.revision,
        owner: saved.owner,
        nonOwner: saved.nonOwner
      },
      override: retainGoalSettings ? previous.override || (!previous.configuration ? {
        role: mode,
        selection: previous.selection
      } : undefined)
        : preferences.override ? { role: mode, selection: preferences.override } : undefined
    };
    const decision = await decisions.resolve(context, state);
    const selection = decision.effectiveSelection;
    const workflowEngineId = (retainGoalSettings && previous.workflowEngineId) || decision.engineId;
    if (resume && (previous.selection.engineId !== selection.engineId ||
        retainGoalSettings && !sameVibe64AssistantSelection(previous.selection, selection))) {
      throw failure("The goal's pinned AI changed. Select the intended model again before resuming.");
    }
    if (rebind) {
      if (selection.engineId !== current.engineId || input.selection && !sameVibe64AssistantSelection(selection, input.selection)) {
        throw failure("The goal's selected model changed. Choose its model again.");
      }
      return {
        pinned: {
          ...previous,
          objective: input.goal.objective,
          mode,
          workflowEngineId,
          selection,
          configuration: state.configuration,
          override: state.override,
          settingsRevision: state.configuration.revision,
          connectionIdentity: decision.connectionIdentity,
          status: input.goal.status
        }
      };
    }
    await prepareSelection(sessionId, selection, context);
    await context.runtime.store.writeMetadataValue(
      sessionId,
      VIBE64_ASSISTANT_SELECTION_METADATA,
      serializeVibe64AssistantSelection(selection)
    );
    if (selection.engineId !== current.engineId) {
      throw failure("Send a message to catch this AI up before starting or resuming its goal.", "vibe64_changeover_message_required");
    }
    const pinned = {
      mode,
      workflowEngineId,
      selection,
      configuration: state.configuration,
      override: state.override,
      settingsRevision: state.configuration.revision,
      connectionIdentity: decision.connectionIdentity,
      objective: input.action === "set" ? input.objective : previous?.objective || "",
      status: "active"
    };
    let objective = pinned.objective || undefined;
    if (resume) {
      const observed = await agent.readGoal(sessionId, context);
      if (observed?.status === "available" && observed.goal?.objective) objective = observed.goal.objective;
    }
    return {
      pinned,
      context: {
        ...withSelection(context, selection),
        expectedConnectionIdentity: decision.connectionIdentity
      },
      input: {
        ...input,
        ...(["set", "resume"].includes(input.action) && objective ? { objective } : {})
      }
    };
  }

  return Object.freeze({
    applyGoalSelection,
    prepareGoal
  });
}

export {
  createAssistantRoutingGoals
};
