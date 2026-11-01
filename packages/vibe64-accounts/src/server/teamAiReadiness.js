import { ASSISTANT_SETUP_ROLES, assistantSetupRoleValue } from "@local/vibe64-runtime/shared/assistantRouting";

/** @typedef {ReturnType<typeof import("@local/vibe64-core/server/assistantRoutingStore").createAssistantRoutingStore>} AssistantRoutingStore */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */

/**
 * Whether the team setup has a model team members can use: some team role
 * (after "Same as") is a selection whose live access is Workspace use and
 * available. The answer is kept for the routing revision until the next
 * accounts or connections change, so project admission reads access rarely.
 * @param {object} dependencies
 * @param {AssistantRoutingStore} dependencies.routingStore
 * @param {TerminalsService} dependencies.terminals
 */
function createTeamAiReadiness({ routingStore, terminals }) {
  let memo = null;

  async function compute(nonOwner, actor) {
    const selections = new Map(ASSISTANT_SETUP_ROLES.nonOwner
      .map((role) => assistantSetupRoleValue(nonOwner, role).value).filter((value) => value?.schema)
      .map((selection) => [JSON.stringify([selection.engineId, selection.modelProviderId, selection.modelId]), selection]));
    for (const selection of selections.values()) {
      try {
        const access = await terminals.requireAssistantSelectionAccess(selection, { vibe64User: actor });
        if (access?.available === true && access.ownerOnly === false) return true;
      } catch {
        // A personal or unavailable selection is not one team members can use.
      }
    }
    return false;
  }

  async function ready({ actor = null } = {}) {
    const { revision, nonOwner } = await routingStore.read();
    if (memo?.revision !== revision) memo = { revision, ready: compute(nonOwner, actor) };
    return memo.ready;
  }

  function invalidate() {
    memo = null;
  }

  return Object.freeze({
    ready,
    invalidate
  });
}

export { createTeamAiReadiness };
