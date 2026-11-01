import { createCodexProviderConnectionStore } from "@local/vibe64-core/server/codexProviderConnections";

import { accountsResult } from "./accountRecords.js";

/** @typedef {import("./service.js").AccountNotifications} AccountNotifications */
/** @typedef {import("./types.js").ModelRouting} ModelRouting */
/** @typedef {import("./types.js").AccountAccess} AccountAccess */

/**
 * Codex model provider keys whoever manages AI saves or removes; a saved key
 * fills the setup's absent model roles.
 * @param {object} dependencies
 * @param {AccountAccess} dependencies.access
 * @param {ModelRouting} dependencies.modelRouting
 * @param {AccountNotifications} dependencies.notifications
 */
function createCodexProviderKeys({ access, modelRouting, notifications }) {
  const codexProviders = createCodexProviderConnectionStore({
    systemRoot: access.systemRoot, invalidateRuntimes: notifications.invalidateAgentRuntimes
  });

  function readCodexProviders(input) {
    return accountsResult(async () => {
      const failure = access.aiManagementError(input);
      if (failure) return failure;
      return { ok: true, providers: await codexProviders.list() };
    });
  }

  function saveCodexProvider(input) {
    return access.accountChange("save-provider-key", input, { engineId: input.engineId, modelProviderId: input.modelProviderId }, async () => {
      const failure = access.aiManagementError(input);
      if (failure) return failure;
      const providers = await codexProviders.change(input.modelProviderId, input);
      const routing = await modelRouting.initializeModelRouting({ vibe64User: input.vibe64User });
      await notifications.publishAccountChanged(input.engineId, { reason: "provider-key-saved" });
      return { ok: true, providers, routing };
    });
  }

  function removeCodexProvider(input) {
    return access.accountChange("remove-provider-key", input, { engineId: input.engineId, modelProviderId: input.modelProviderId }, async () => {
      const failure = access.aiManagementError(input);
      if (failure) return failure;
      const providers = await codexProviders.change(input.modelProviderId, { remove: true, engineId: input.engineId });
      await notifications.publishAccountChanged(input.engineId, { reason: "provider-key-removed" });
      return { ok: true, providers };
    });
  }

  return Object.freeze({
    readCodexProviders,
    saveCodexProvider,
    removeCodexProvider
  });
}

export {
  createCodexProviderKeys
};
