// Whether an AI sign-in or provider is offered as a new connection.

/** A native sign-in that is connected, was linked before or is reconnecting: it is managed, not offered again. */
function nativeAccountConfigured(account) {
  return account?.connected === true || account?.previouslyLinked === true ||
    ["reconnect_required", "reconnecting"].includes(account?.status);
}

/** Why an OpenCode catalogue provider cannot be connected with a key, or "" when it can. */
function providerUnavailableReason(provider = {}) {
  if (provider.apiKeyCompatible === false) {
    return "Requires provider-specific account details";
  }
  if (!String(provider.defaultModelId || "").trim()) {
    return "No usable default model is currently available";
  }
  return "";
}

export { nativeAccountConfigured, providerUnavailableReason };
