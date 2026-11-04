import { getProviderClientAuthenticationMethods, getProviderScopes } from "@jskit-ai/connectors-core/shared/configuration";

// Edits to a project's integrations configuration (integrations.json): each returns the next configuration and
// leaves the one it was given unchanged.

/**
 * Adds an integration of a provider under a fresh id, with the provider's first sign-in method, its required and
 * recommended permissions, Env references for its credentials and, for OAuth, its own client registration.
 * @param {{ integrations: Record<string, object>, registrations: Record<string, object> }} current
 * @param {object} provider A connector definition.
 */
function withIntegrationAdded(current, provider) {
  let id = provider.id;
  let suffix = 2;
  while (current.integrations[id] || current.registrations[id]) id = `${provider.id}-${suffix++}`;
  const prefix = id.toUpperCase().replaceAll("-", "_");
  const method = provider.authenticationMethods[0];
  const authentication = { method };
  if (method === "api-key" && !provider.apiKeySecretOptional) authentication.secretRef = `env:${prefix}_API_KEY`;
  else if (method === "service-account") authentication.secretRef = `env:${prefix}_SERVICE_ACCOUNT`;
  else if (method === "oauth2") authentication.registrationRef = id;
  const grantType = provider.oauthGrantTypes?.[0] || "authorization_code";
  const clientAuthentication = getProviderClientAuthenticationMethods(provider, grantType)[0];
  const configuration = {
    ...current,
    integrations: { ...current.integrations, [id]: {
      provider: provider.id, displayName: provider.name, accountMode: provider.accountModes[0],
      scopes: getProviderScopes(provider, {}, grantType, method).filter((scope) => scope.required || scope.recommended).map((scope) => scope.value),
      authentication
    } },
    registrations: method !== "oauth2" ? current.registrations : { ...current.registrations, [id]: {
      source: "own", clientId: "",
      ...(grantType === "authorization_code" ? { callbackUrlRef: `env:${prefix}_CALLBACK_URL` } : { grantType }),
      ...(clientAuthentication !== "client_secret_post" ? { tokenEndpointAuthMethod: clientAuthentication } : {}),
      ...(clientAuthentication !== "none" ? { clientSecretRef: `env:${prefix}_CLIENT_SECRET` } : {})
    } }
  };
  return { configuration, id };
}

/**
 * Removes an integration, and its own client registration when nothing else uses it and it holds no client yet.
 * @param {{ integrations: Record<string, object>, registrations: Record<string, object> }} configuration
 * @param {string} id
 */
function withIntegrationRemoved(configuration, id) {
  const next = { ...configuration.integrations };
  const registrations = { ...configuration.registrations };
  const registrationId = configuration.integrations[id].authentication.registrationRef;
  delete next[id];
  if (!registrations[registrationId]?.clientId && registrations[registrationId]?.source === "own" &&
      !Object.values(next).some((entry) => entry.authentication.registrationRef === registrationId)) {
    delete registrations[registrationId];
  }
  return { ...configuration, integrations: next, registrations };
}

export {
  withIntegrationAdded,
  withIntegrationRemoved
};
