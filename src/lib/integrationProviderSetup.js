// What a connector definition (the connector catalog's) asks of one saved integration's setup: its steps, its guide,
// whether it is configuration-only, the Env values holding its credentials, and its OAuth client registration. A
// definition states the first three once, per sign-in method, or as a function of the integration's settings.

// readable-check: allow optional-call - input validation: a provider's setup steps come from setup.stepsForSettings(), setup.stepsByAuthentication or setup.steps
function integrationSetupSteps(provider, integration) {
  return provider.setup.stepsForSettings?.(integration?.settings || {}, integration?.authentication.method) ||
    provider.setup.stepsByAuthentication?.[integration?.authentication.method] || provider.setup.steps;
}

// readable-check: allow optional-call - input validation: a provider's setup guide comes from setup.urlForSettings(), setup.urlByAuthentication or setup.url
function integrationSetupUrl(provider, integration) {
  return provider.setup.urlForSettings?.(integration?.settings || {}, integration?.authentication.method) ||
    provider.setup.urlByAuthentication?.[integration?.authentication.method] || provider.setup.url;
}

// readable-check: allow optional-call - input validation: a provider is configuration-only always (configurationOnly) or by its settings (configurationOnlyForSettings())
function integrationConfigurationOnly(provider, settings) {
  return provider.configurationOnly || provider.configurationOnlyForSettings?.(settings);
}

/**
 * The Env key an "env:NAME" configuration reference names.
 * @param {string | undefined} reference
 */
function envReferenceKey(reference) {
  return /^env:([A-Z_][A-Z0-9_]*)$/u.exec(reference || "")?.[1];
}

/**
 * The Env values an integration's credentials live in: its application credential, a connected account's refresh token
 * and each credential its provider's settings name.
 */
function integrationCredentials({ integration, provider, registration }) {
  const reference = integration?.authentication.method === "oauth2"
    ? registration?.clientSecretRef : integration?.authentication.secretRef;
  const primaryKey = envReferenceKey(reference);
  const entries = primaryKey ? [{ key: primaryKey, label: "Application credential", public: false }] : [];
  // A shared account connected outside the app arrives as a refresh token in Env.
  const refreshTokenKey = envReferenceKey(integration?.authentication.refreshTokenRef);
  if (refreshTokenKey) entries.push({ key: refreshTokenKey, label: "Connected account", public: false });
  for (const field of provider?.settingsFields || []) {
    if (!field.environmentCredential) continue;
    const key = envReferenceKey(integration?.settings?.[field.name]);
    if (key) entries.push({ key, ...field.environmentCredential });
  }
  return entries;
}

/**
 * Where an OAuth integration registers its client, when its provider takes registrations: one address, or one per
 * settings (such as a region).
 */
function integrationRegistrationEndpoint(provider, integration) {
  if (integration?.authentication.method !== "oauth2") return undefined;
  const endpoint = provider?.setup?.clientRegistrationEndpoint;
  return typeof endpoint === "function" ? endpoint(integration?.settings || {}) : endpoint;
}

/** The client registration request body for an integration, empty until it has an endpoint and a callback. */
function integrationRegistrationRequest({ endpoint, callbackUrl, projectSlug, integration, provider }) {
  return !endpoint || !callbackUrl ? "" : JSON.stringify({
    client_name: `${projectSlug} — ${integration?.displayName || provider.name}`,
    redirect_uris: [callbackUrl],
    token_endpoint_auth_method: "client_secret_post",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: (integration?.scopes || []).join(" ")
  }, null, 2);
}

/** The client metadata document an application serves for a provider that reads one, or null for other providers. */
function integrationClientMetadata({ callbackUrl, integration, provider, registration }) {
  const build = provider?.setup?.createClientMetadata;
  if (!build) return null;
  try {
    return { json: JSON.stringify(build({
      clientId: registration?.clientId,
      clientName: integration?.displayName || provider.name,
      callbackUrl
    }), null, 2) };
  } catch {
    return { json: "", error: "Enter a valid Client metadata URL, display name and suggested callback to prepare the document." };
  }
}

export {
  envReferenceKey,
  integrationClientMetadata,
  integrationConfigurationOnly,
  integrationCredentials,
  integrationRegistrationEndpoint,
  integrationRegistrationRequest,
  integrationSetupSteps,
  integrationSetupUrl
};
