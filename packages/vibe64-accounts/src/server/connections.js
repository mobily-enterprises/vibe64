import { createCodexProviderConnectionStore } from "@local/vibe64-core/server/codexProviderConnections";
import { projectRequiresGithubConnection } from "@local/vibe64-core/server/projectRepository";
import { blockedReason, hasAccountSelection } from "./accountRecords.js";

/** @typedef {import("./types.js").AccountsService} AccountsService */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */

/**
 * The accounts a readiness read asks for: the request's own selection, or Codex plus GitHub when the current project
 * lives on GitHub.
 * @param {object} input
 * @param {ProjectService} project
 */
async function connectionAccountStatusInput(input, project) {
  if (hasAccountSelection(input)) {
    return input;
  }
  const currentProject = await project.readCurrentProject();
  return {
    ...input,
    providerIds: projectRequiresGithubConnection(currentProject || {})
      ? ["codex", "github"]
      : ["codex"]
  };
}

/**
 * The `vibe64.connections` capability: whether this person's accounts and AI connection let a project start,
 * and whether a saved custom model endpoint answers.
 * @param {object} dependencies
 * @param {AccountsService} dependencies.accounts
 * @param {ProjectService} dependencies.project
 * @param {TerminalsService} dependencies.terminals
 * @param {string} [dependencies.systemRoot] where saved provider connections live
 */
function createConnections({
  accounts,
  project,
  terminals,
  systemRoot = ""
}) {
  /**
   * @param {object} input
   */
  async function getStatus(input) {
    const accountInput = await connectionAccountStatusInput(input, project);
    // Readiness needs only whether GitHub is connected, not the Git name
    // the Account card reads for the person.
    const status = await accounts.getStatus({ ...accountInput, readGitIdentity: false });
    if (status?.ok === false) {
      return status;
    }
    const connections = Array.isArray(status?.accounts) ? [...status.accounts] : [];
    if (!hasAccountSelection(input)) {
      // The reader's user is the authority option, not catalogue input: a page
      // outside a project (Studio Health) has no project user to fall back on.
      const catalog = await terminals.listAssistantCapabilities({
        configuredOnly: "true",
        vibe64User: input.vibe64User
      }, { vibe64User: input.vibe64User });
      if (catalog?.ok === false) return catalog;
      const connected = (catalog.engines || []).some((engine) =>
        (engine.modelProviders || []).some((provider) => provider.connected === true));
      const codexIndex = connections.findIndex((account) => account.id === "codex");
      if (codexIndex >= 0) connections.splice(codexIndex, 1);
      connections.unshift({
        id: "ai",
        label: "AI connection",
        connected,
        required: true,
        message: connected ? "An AI provider is connected." : "Connect an AI provider in AI Accounts."
      });
    }
    const ready = connections.every((connection) => connection.required !== true || connection.connected === true);
    return {
      ...status,
      blockedReason: ready ? "" : blockedReason(connections),
      connections,
      ready
    };
  }

  /**
   * Whether each saved custom model endpoint answers; it never decides
   * readiness, and only Health asks.
   */
  async function checkCustomEndpoints() {
    return systemRoot ? createCodexProviderConnectionStore({ systemRoot }).customEndpointReachability() : [];
  }

  return Object.freeze({
    checkCustomEndpoints,
    getStatus
  });
}

export { createConnections };
