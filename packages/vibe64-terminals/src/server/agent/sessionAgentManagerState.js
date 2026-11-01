/**
 * The state the manager's concerns share: its providers by product id, the
 * default provider, each binding's identity token, the connection each
 * native terminal opened with, the native terminals being started and the
 * engines whose connection is changing.
 * @param {object} settings
 * @param {string} settings.defaultProviderId
 * @param {Map<string, object>} settings.providerById the admitted session agent providers by product id
 */
function createSessionAgentManagerState({ defaultProviderId, providerById }) {
  const bindingTokens = new Map();
  const terminalBindings = new Map();
  const terminalStarts = new Set();
  const connectionChanges = new Set();

  return Object.freeze({
    bindingTokens,
    connectionChanges,
    defaultProviderId,
    providerById,
    terminalBindings,
    terminalStarts
  });
}

export {
  createSessionAgentManagerState
};
