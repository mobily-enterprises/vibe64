import { AppError } from "@jskit-ai/kernel/server/runtime";
import { vibe64Error } from "@local/vibe64-core/server/core";
import { currentRequestIsPracticeProject } from "@local/vibe64-core/server/projectRequestContext";
import { runVibe64AgentWriteExclusive } from "@local/vibe64-runtime/server/agentWriteLock";
import {
  defineVibe64AssistantSelection,
  serializeVibe64AssistantSelection,
  VIBE64_ASSISTANT_SELECTION_METADATA,
  vibe64AssistantSelectionFromMetadata
} from "@local/vibe64-runtime/shared";
import {
  ASSISTANT_ROUTING_METADATA,
  assistantGoalIsActive,
  assistantRoutingAutomation,
  assistantRoutingFromMetadata,
  assistantRoutingGoalFromMetadata,
  assistantRoutingPreferences,
  assistantRoutingRequestFromMetadata,
  assistantRoutingStatusIsPending,
  isAssistantRoutingOwner
} from "@local/vibe64-runtime/shared/assistantRouting";
import { publicSession, sessionResult } from "./sessionResults.js";
import { trustedAssistantUser } from "./trustedAssistantUser.js";
import { normalizeObject, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@local/vibe64-core/server/types").PublishSessionChanged} PublishSessionChanged */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */
/** @typedef {import("@local/vibe64-accounts/server/types").AccountsService} AccountsService */
/** @typedef {import("./types.js").AccountsInitializeModelRouting} AccountsInitializeModelRouting */

function publicAssistantAccess(access = {}) {
  return {
    accessLabel: normalizeText(access.accessLabel) || "Unavailable",
    available: access.available === true,
    canUse: access.canUse === true,
    nativeCanUse: access.nativeCanUse === true,
    canUseAny: access.canUseAny === true,
    currentMode: normalizeText(access.currentMode),
    steering: access.steering === true,
    // Chat needs each decision and effective selection, not duplicated server
    // dispatch plans. Routing still resolves those afresh when work is sent.
    purposes: JSON.parse(JSON.stringify(access.purposes || {}, (key, value) =>
      ["connectionIdentity", "routerConnectionIdentity", "configuredSelection",
        "seniorJuniorPair", "executionProfileRequest", "router"].includes(key) ? undefined : value)),
    endpointCode: normalizeText(access.endpointCode),
    engineId: normalizeText(access.engineId),
    modelProviderId: normalizeText(access.modelProviderId),
    ok: true,
    ownerOnly: access.ownerOnly === true,
    transportId: normalizeText(access.transportId)
  };
}

/**
 * Which assistant a session runs on: the start a new or renewed session
 * resolves, the catalogue and access people choose from, and a chat's
 * selection or mode changed while it may be working.
 * @param {object} dependencies
 * @param {AccountsInitializeModelRouting} dependencies.initializeModelRouting
 * @param {ProjectService} dependencies.project
 * @param {PublishSessionChanged} dependencies.publishSessionChanged
 * @param {TerminalsService} dependencies.terminals
 */
function createSessionAssistant({
  initializeModelRouting,
  project,
  publishSessionChanged,
  terminals
}) {
  /**
   * @param {object} input
   * @param {object | null} vibe64User
   */
  async function resolveAssistantSelection(input, vibe64User) {
    return defineVibe64AssistantSelection(await terminals.resolveAssistantSelection(normalizeObject(input), { vibe64User }));
  }

  /**
   * Main chat starts on the owner's setup (a team member's lesson: the team
   * setup). A renewal keeps the chat mode; a chosen model that isn't main
   * chat's own makes the chat Custom.
   */
  async function resolveSessionStart(input = {}, options = {}) {
    const { session = null, vibe64User = null, mode = "senior" } = options;
    const direct = isAssistantRoutingOwner(vibe64User) || currentRequestIsPracticeProject();
    if (!direct && Object.keys(input.assistantSelection || {}).length) {
      throw new AppError(403, "Main chat runs on the workspace owner's AI. Team members can't choose its model.", {
        code: "vibe64_main_chat_model_owner_only"
      });
    }
    // A chosen model comes from Custom's live catalogue, so it is checked as
    // Custom checks it in an open chat.
    const explicitSelection = Object.keys(input.assistantSelection || {}).length
      ? await resolveAssistantSelection(input.assistantSelection, vibe64User)
      : null;
    const previous = session ? assistantRoutingFromMetadata(session.metadata) : null;
    const startMode = previous && !["custom", "fix"].includes(previous.mode) ? previous.mode : mode;
    // Deslop and automatic save start on (their shared default); the chat-mode
    // controls can turn them off.
    const preferences = assistantRoutingPreferences(explicitSelection ? { mode: "custom", override: explicitSelection }
      : { mode: startMode });
    const routingSetup = await initializeModelRouting({ vibe64User });
    if (routingSetup?.ok === false) {
      throw vibe64Error(routingSetup.error, routingSetup.code);
    }
    // Outside a lesson, a team member's session records main chat's starting
    // model only; their messages wait for the owner, so nothing runs as them here.
    const purpose = preferences.mode === "auto" ? "senior" : preferences.mode;
    const decision = await terminals.resolveAssistantPurpose(
      {
        purpose,
        ...(explicitSelection ? { override: { role: "custom", selection: explicitSelection } } : {})
      },
      { vibe64User: direct ? vibe64User : { role: "owner" } },
      direct ? undefined : { validateModels: false }
    );
    if (!decision.available) throw new AppError(403, decision.message, { code: decision.reasonCode });
    if (direct) {
      await terminals.requireAssistantSelectionAccess(decision.effectiveSelection, {
        vibe64User,
        expectedConnectionIdentity: decision.connectionIdentity
      });
    }
    return { assistantSelection: decision.effectiveSelection, assistantRouting: preferences };
  }

  async function listAssistantCapabilities(input) {
    return sessionResult(async () => {
      return terminals.listAssistantCapabilities(input, {
        vibe64User: trustedAssistantUser(input)
      });
    }, "Vibe64 could not read the current assistant catalog.");
  }

  async function updateAssistantModelAccess(input) {
    return sessionResult(async () => {
      return terminals.updateAssistantModelAccess({
        engineId: normalizeText(input.engineId),
        modelProviderId: normalizeText(input.modelProviderId),
        unlocked: input.unlocked === true
      }, {
        vibe64User: trustedAssistantUser(input)
      });
    }, "Vibe64 could not change this provider's model access.");
  }

  async function inspectAssistantAccess(sessionId, input) {
    return sessionResult(async () => {
      const vibe64User = trustedAssistantUser(input);
      const runtime = await project.createRuntimeWithoutSource();
      const session = await runtime.getSessionWithoutSource(sessionId);
      const context = { runtime, session, vibe64User };
      return publicAssistantAccess(await terminals.inspectAssistantAccess(sessionId, context));
    }, "Vibe64 could not inspect assistant access.");
  }

  async function updateAssistantSelection(sessionId, input) {
    return sessionResult(async () => {
      const vibe64User = trustedAssistantUser(input);
      // Main chat's mode, review and model are the owner's, with or without a
      // goal, except in a team member's own lesson.
      if (!isAssistantRoutingOwner(vibe64User) && !currentRequestIsPracticeProject()) {
        throw new AppError(403, "Main chat runs on the workspace owner's AI. Only the owner can change its chat mode, review or model.", {
          code: "vibe64_main_chat_settings_owner_only"
        });
      }
      const runtime = await project.createRuntimeWithoutSource();
      const save = async () => {
        const apply = async ({ deferred = false } = {}) => {
          const session = await runtime.getSessionWithoutSource(sessionId);
          const current = vibe64AssistantSelectionFromMetadata(session.metadata);
          let preferences = null;
          let resolved;
          let connectionIdentity;
          // One answer, read once, to "is a turn running or a goal unfinished":
          // the native goal when the tool reports it, else the live session's,
          // else the pin. A model change reads it only after access is checked.
          let nativeState = null;
          const readNativeState = async () => {
            if (nativeState) return nativeState;
            const agentSession = await terminals.agentSessionState(sessionId, { runtime, session });
            const observedGoal = await terminals.readAgentGoal(sessionId, { runtime, session, vibe64User });
            nativeState = {
              turnActive: agentSession?.turn?.active === true,
              goalActive: assistantGoalIsActive(observedGoal?.status === "available" ? observedGoal.goal
                : observedGoal?.goal || agentSession?.goal || assistantRoutingGoalFromMetadata(session.metadata))
            };
            return nativeState;
          };
          if (input.assistantRouting && input.assistantRouting.mode !== "custom") {
            // An omitted Deslop or automatic save choice keeps the chat's own.
            preferences = assistantRoutingPreferences({
              ...assistantRoutingAutomation(assistantRoutingFromMetadata(session.metadata)),
              ...input.assistantRouting
            });
            // Main chat's tool follows the owner's setup; a changed tool
            // catches up on the next message. Only an active goal rebinds now.
            if (!(await readNativeState()).goalActive) {
              await runtime.store.writeMetadataValue(sessionId, ASSISTANT_ROUTING_METADATA, JSON.stringify(preferences));
              return { assistantSelection: current, session: await runtime.getSessionWithoutSource(sessionId) };
            }
            const decision = await terminals.resolveAssistantPurpose({
              purpose: preferences.mode,
              reviewEnabled: preferences.review,
              ...(preferences.override ? { override: { role: preferences.mode, selection: preferences.override } } : {})
            }, { vibe64User });
            if (!decision.available) throw new AppError(403, decision.message, { code: decision.reasonCode });
            const destination = preferences.mode === "auto" ? decision.seniorJuniorPair.senior : decision;
            resolved = destination.effectiveSelection;
            connectionIdentity = destination.connectionIdentity;
          } else {
            const requestedSelection = input.assistantRouting?.mode === "custom"
              ? input.assistantRouting.override : input.assistantSelection;
            if (!requestedSelection) throw new Error("Choose an assistant or a chat mode.");
            resolved = await resolveAssistantSelection({
              ...normalizeObject(requestedSelection),
              engineId: normalizeText(requestedSelection.engineId) || current.engineId
            }, vibe64User);
          }
          await terminals.requireAssistantSelectionAccess(resolved, {
            vibe64User,
            ...(connectionIdentity ? { expectedConnectionIdentity: connectionIdentity } : {})
          });
          const { turnActive, goalActive } = await readNativeState();
          const next = resolved;
          const nextPreferences = preferences || {
            mode: "custom",
            review: false,
            override: next
          };
          if (deferred || turnActive || goalActive) {
            await terminals.applyGoalSelection(sessionId, next, nextPreferences, { runtime, session, vibe64User });
            await runtime.store.writeMetadataValue(sessionId, ASSISTANT_ROUTING_METADATA, JSON.stringify(nextPreferences));
            return { assistantSelection: current, session: await runtime.getSessionWithoutSource(sessionId) };
          }
          const routingRequest = assistantRoutingRequestFromMetadata(session.metadata);
          if (routingRequest?.helper || !routingRequest?.stopped && (assistantRoutingStatusIsPending(routingRequest) ||
              routingRequest?.status === "working" && routingRequest.workflow && routingRequest.delivery === "accepted")) {
            return { cancelRouting: routingRequest.messageId };
          }
          await terminals.prepareRoutingSelection(sessionId, next, { runtime, session, vibe64User });
          await runtime.store.writeMetadataValue(sessionId, ASSISTANT_ROUTING_METADATA, JSON.stringify(nextPreferences));
          await runtime.store.writeMetadataValue(
            sessionId,
            VIBE64_ASSISTANT_SELECTION_METADATA,
            serializeVibe64AssistantSelection(next)
          );
          return {
            assistantSelection: next,
            session: await runtime.getSessionWithoutSource(sessionId)
          };
        };
        const update = async () => {
          const result = await runVibe64AgentWriteExclusive(
            runtime,
            sessionId,
            () => apply(),
            { operation: "update-assistant-selection" }
          );
          // Saving the next selection does not wait for native startup. Only
          // immediate idle changeover requires the admission/cleanup lock.
          return result.acquired ? result : { acquired: true, value: await apply({ deferred: true }) };
        };
        let exclusive = await update();
        if (exclusive.acquired && Object.hasOwn(exclusive.value || {}, "cancelRouting")) {
          // Router cleanup needs this lock for its final callbacks. Release it,
          // cancel through its owner, then revalidate access and native state.
          await terminals.cancelAssistantRoutingForSelection(sessionId, exclusive.value.cancelRouting, { runtime, vibe64User });
          exclusive = await update();
          if (exclusive.acquired && Object.hasOwn(exclusive.value || {}, "cancelRouting")) {
            throw new Error("Another routing request started. Retry the assistant selection.");
          }
        }
        if (!exclusive.acquired) {
          return exclusive.value;
        }
        if (exclusive.value?.ok === false) return exclusive.value;
        await publishSessionChanged(sessionId, {
          operation: "updated",
          originId: normalizeText(input.originId),
          reason: "session-assistant-selection-updated",
          session: exclusive.value.session
        });
        return publicSession(exclusive.value.session, {
          assistantSelection: exclusive.value.assistantSelection
        });
      };
      const saved = await runtime.store.runSessionExclusive(
        sessionId,
        "assistant-settings",
        save,
        { operation: "save-assistant-settings", waitMs: 10_000 }
      );
      if (!saved.acquired) throw new Error("Another settings change is being saved. Try again in a moment.");
      return saved.value;
    }, "Vibe64 could not update this session's assistant selection.");
  }

  return Object.freeze({
    resolveSessionStart,
    listAssistantCapabilities,
    updateAssistantModelAccess,
    inspectAssistantAccess,
    updateAssistantSelection
  });
}

export { createSessionAssistant };
