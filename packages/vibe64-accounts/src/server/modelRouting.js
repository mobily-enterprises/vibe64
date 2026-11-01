import {
  createAssistantRoutingStore,
  validateAssistantRoutingConfiguration
} from "@local/vibe64-core/server/assistantRoutingStore";
import { ASSISTANT_SETUP_ROLES, assistantSetupRoleValue } from "@local/vibe64-runtime/shared/assistantRouting";
import { readWorkspaceTeam } from "@local/vibe64-core/server/workspaceTeam";

import { accountsResult } from "./accountRecords.js";

/** @typedef {import("./service.js").AccountNotifications} AccountNotifications */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */
/** @typedef {import("./types.js").AccountAccess} AccountAccess */
/** @typedef {import("./types.js").TerminalsInspectAssistantRoutingConfiguration} TerminalsInspectAssistantRoutingConfiguration */

/**
 * Model routing: which model each role of each AI setup uses, read, previewed,
 * saved by whoever manages AI, and filled from recommendations.
 * @param {object} dependencies
 * @param {AccountAccess} dependencies.access
 * @param {TerminalsInspectAssistantRoutingConfiguration | null} dependencies.inspectRoutingConfiguration
 * @param {AccountNotifications} dependencies.notifications
 */
function createModelRouting({
  access,
  inspectRoutingConfiguration,
  notifications
}) {
  const routingStore = () => createAssistantRoutingStore({ systemRoot: access.systemRoot });

  async function readModelRouting(input) {
    return accountsResult(async () => {
      if ((input.choiceSearch !== undefined || input.choiceOffset !== undefined || input.choiceRole) &&
          !ASSISTANT_SETUP_ROLES[input.setup]?.includes(input.choiceRole)) {
        return { ok: false, code: "vibe64_routing_choice_scope", error: "Choose the setup and role before searching model choices." };
      }
      const saved = await routingStore().read();
      // Main chat runs on the owner's Senior. A saved choice needs no live
      // catalogue; only an unsaved setup waits for its recommendation. Whoever
      // manages AI may also start one new session on another model.
      if (input.view === "main") {
        const { value } = assistantSetupRoleValue(saved.owner, "senior");
        return {
          ok: true,
          revision: saved.revision,
          canConfigure: !access.aiManagementError(input),
          mainSelection: value?.schema ? value
            : (await routingView(saved, input)).setups.owner.roles.senior.recommendation ?? null
        };
      }
      const view = await routingView(saved, input);
      if (!input.choiceRole) return view;
      const search = String(input.choiceSearch || "").toLowerCase();
      const choices = view.setups[input.setup].roles[input.choiceRole].choices.filter(choice =>
        [choice.engineId, choice.agentId, choice.modelProviderId, choice.modelId, choice.label, choice.providerLabel]
          .some(value => String(value || "").toLowerCase().includes(search)));
      const offset = input.choiceOffset || 0;
      return {
        ok: true,
        revision: saved.revision,
        canConfigure: view.canConfigure,
        setup: input.setup,
        choiceRole: input.choiceRole,
        choiceCount: choices.length,
        choices: choices.slice(offset, offset + 20),
        nextOffset: offset + 20 < choices.length ? offset + 20 : null
      };
    });
  }

  async function routingView(configuration, input) {
    if (!inspectRoutingConfiguration) throw new Error("Model routing is unavailable on this host.");
    const [result, team] = await Promise.all([
      inspectRoutingConfiguration(configuration, {
        vibe64User: input.vibe64User || null,
        ...(input.preferProvider ? { preferProvider: input.preferProvider } : {})
      }), readWorkspaceTeam()]);
    return { ok: true, revision: configuration.revision, canConfigure: !access.aiManagementError(input), team, ...result };
  }

  const sameRoutingSelection = (left, right) => ["engineId", "agentId", "modelProviderId", "modelId", "variantId"]
    .every((key) => left?.[key] === right?.[key]);

  /**
   * Internal setup used after connection setup, explicit session creation and
   * the team card. It accepts no values: it fills only the setup's absent roles
   * from recommendations; user-directed changes stay on owner-only Save. Only
   * the owner's own actions fill a setup; a team member's never writes.
   */
  async function initializeModelRouting(input = {}) {
    return accountsResult(async () => {
      if (access.aiManagementError(input)) return { ok: true, initialized: [] };
      const setup = input.setup || "owner";
      const preferProvider = input.preferProvider || null;
      if (!ASSISTANT_SETUP_ROLES[setup] || preferProvider && (typeof preferProvider.modelProviderId !== "string" ||
          !["codex", "claude", "opencode"].includes(preferProvider.engineId))) {
        throw new Error("Choose a supported AI setup to fill in Models.");
      }
      const saved = await routingStore().read();
      if (ASSISTANT_SETUP_ROLES[setup].every((role) => Object.hasOwn(saved[setup], role))) return { ok: true, initialized: [] };
      const values = (await routingView(saved, { ...input, ...(preferProvider ? { preferProvider: { ...preferProvider, setup } } : {}) }))
        .setups[setup].setupValues;
      const next = { ...saved[setup] };
      const initialized = [];
      for (const role of ASSISTANT_SETUP_ROLES[setup]) {
        if (Object.hasOwn(next, role) || !values[role]) continue;
        next[role] = values[role];
        initialized.push({ setup, role });
      }
      if (initialized.length) {
        await routingStore().write({ ...saved, [setup]: next }, saved.revision);
        await notifications.publishAccountChanged("codex", { reason: "model-routing-initialized" });
      }
      return { ok: true, initialized };
    });
  }

  /**
   * A draft names whole role values per setup; omitted roles keep their saved value.
   */
  async function routingDraft(input) {
    const saved = await routingStore().read();
    if (input.revision !== saved.revision) throw Object.assign(new Error(
      "Models changed in another tab. Reload and review the current choices."
    ),
      {
      code: "vibe64_assistant_routing_stale",
      statusCode: 409
    });
    const configuration = { schemaVersion: 5, revision: saved.revision, owner: { ...saved.owner }, nonOwner: { ...saved.nonOwner } };
    for (const setup of Object.keys(ASSISTANT_SETUP_ROLES)) {
      const changes = input[setup];
      if (changes === undefined) continue;
      if (!changes || typeof changes !== "object" || Array.isArray(changes) ||
          Object.keys(changes).some((role) => !ASSISTANT_SETUP_ROLES[setup].includes(role))) throw new Error("Unknown role in Models.");
      Object.assign(configuration[setup], structuredClone(changes));
    }
    // A Senior/Junior tool mismatch is reported on the Junior field, not as a shape error.
    const { senior, junior } = configuration.owner;
    const pairError = senior?.schema && junior?.schema && senior.engineId !== junior.engineId
      ? "Senior and Junior must run in the same tool."
      : "";
    validateAssistantRoutingConfiguration(pairError ? {
      ...configuration,
      owner: { ...configuration.owner, junior: null }
    } : configuration);
    return { saved, configuration, pairError };
  }

  async function previewModelRouting(input) {
    return accountsResult(async () => {
      const failure = access.aiManagementError(input);
      if (failure) return failure;
      const { configuration } = await routingDraft(input);
      return routingView(configuration, input);
    });
  }

  async function saveModelRouting(input) {
    return accountsResult(async () => {
      const failure = access.aiManagementError(input);
      if (failure) return failure;
      const { configuration, saved, pairError } = await routingDraft(input);
      const view = await routingView(configuration, input);
      const fieldErrors = pairError ? { "owner.junior": pairError } : {};
      for (const setup of Object.keys(ASSISTANT_SETUP_ROLES)) {
        for (const role of ASSISTANT_SETUP_ROLES[setup]) {
          const selection = configuration[setup][role];
          if (!selection?.schema) continue;
          const previous = saved[setup][role];
          const unchanged = sameRoutingSelection(previous, selection);
          const state = view.setups[setup].roles[role];
          if (state.error && !unchanged) fieldErrors[`${setup}.${role}`] = state.error;
          selection.selectionSource = unchanged && previous?.schema ? previous.selectionSource
            : selection.selectionSource === "recommended" && sameRoutingSelection(selection, state.recommendation)
              ? "recommended" : "explicit";
        }
      }
      if (Object.keys(fieldErrors).length) return { ok: false, error: "Review the highlighted routing choices.", fieldErrors };
      await routingStore().write(configuration, input.revision);
      await notifications.publishAccountChanged("codex", { reason: "model-routing-updated" });
      return readModelRouting(input);
    });
  }

  return Object.freeze({
    initializeModelRouting,
    readModelRouting,
    previewModelRouting,
    saveModelRouting
  });
}

export {
  createModelRouting
};
