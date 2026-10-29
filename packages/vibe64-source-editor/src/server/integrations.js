import { validatePaymentConfiguration } from "@jskit-ai/payments-core/shared";
import { parseIntegrationConfiguration, validateIntegrationConfiguration } from "@jskit-ai/connectors-core/shared/configuration";
import { connectorDefinitions } from "@jskit-ai/connectors-catalog/shared";
import { discoverN8nOAuth, registerN8nClient } from "@jskit-ai/connectors-catalog/server/n8n";
import { registerHeyGenClient } from "@jskit-ai/connectors-catalog/server/heygen";
import { registerHexClient } from "@jskit-ai/connectors-catalog/server/hex";
import { registerGranolaClient } from "@jskit-ai/connectors-catalog/server/granola";
import { registerAtlassianClient } from "@jskit-ai/connectors-catalog/server/atlassian";
import { registerConfidenceClient } from "@jskit-ai/connectors-catalog/server/confidence-exp";
import { registerSanityClient } from "@jskit-ai/connectors-catalog/server/sanity";
import { registerSentryClient } from "@jskit-ai/connectors-catalog/server/sentry";
import { registerAmplitudeClient } from "@jskit-ai/connectors-catalog/server/amplitude";
import { runtimeConfigKeyIsVibe64Reserved } from "@local/vibe64-core/server/runtimeConfig";
import { googleCalendarDefinition } from "@jskit-ai/connector-google-calendar/shared";
import { inspectVibe64IntegrationSetup } from "@local/vibe64-genesis/server";
import { vibe64RuntimePacks } from "@local/vibe64-terminals/server/vibe64OutputTargets";
import { createIntegrationSetupRequest, runIntegrationSetupCommand } from "./integrationSetupCommand.js";
import { isMissingPathError } from "@local/vibe64-core/server/core";
import { runVibe64Command } from "@local/vibe64-execution/server";
import { sourceEditorFilePolicy } from "./filePolicy.js";
import {
  SOURCE_EDITOR_CONFLICT_CODE,
  createSourceEditorFile,
  isPlainObject,
  readSourceEditorFile,
  runSourceEditorOperation,
  saveSourceEditorFile,
  sourceEditorError,
  sourceEditorFileChange
} from "./sourceFiles.js";

// Project integrations: configuration save and merge-patch, OAuth client
// registration, and the development setup command with its request ledger.
const INTEGRATION_PROVIDERS = Object.freeze([googleCalendarDefinition, ...connectorDefinitions]);

// Providers whose own OAuth client Vibe64 can register, keyed by provider id.
const OAUTH_CLIENT_REGISTRARS = Object.freeze({
  amplitude: (integration, { callbackUrl, fetchImpl }) => registerAmplitudeClient({ region: integration.settings?.region, clientName: integration.displayName || "Amplitude",
    callbackUrl, scopes: integration.scopes }, { fetchImpl }),
  heygen: (integration, { callbackUrl, fetchImpl }) => registerHeyGenClient({ clientName: integration.displayName || "HeyGen", callbackUrl }, { fetchImpl }),
  hex: (integration, { callbackUrl, fetchImpl }) => registerHexClient({ endpoint: integration.settings?.endpoint, clientName: integration.displayName || "Hex", callbackUrl, scopes: integration.scopes }, { fetchImpl }),
  granola: (integration, { callbackUrl, fetchImpl }) => registerGranolaClient({ clientName: integration.displayName || "Granola", callbackUrl }, { fetchImpl }),
  atlassian: (integration, { callbackUrl, fetchImpl }) => registerAtlassianClient({ clientName: integration.displayName || "Atlassian", callbackUrl, scopes: integration.scopes }, { fetchImpl }),
  "confidence-exp": registerConfidenceOAuthClient,
  "confidence-flags": registerConfidenceOAuthClient,
  sanity: (integration, { callbackUrl, fetchImpl }) => registerSanityClient({ clientName: integration.displayName || "Sanity", callbackUrl, scopes: integration.scopes }, { fetchImpl }),
  sentry: (integration, { callbackUrl, fetchImpl }) => registerSentryClient({ clientName: integration.displayName || "Sentry", callbackUrl, scopes: integration.scopes }, { fetchImpl }),
  n8n: (integration, { callbackUrl, fetchImpl, expectedEndpoint }) => registerN8nClient({ serverUrl: integration.settings?.serverUrl,
    clientName: integration.displayName || "n8n", callbackUrl, scopes: integration.scopes
  }, { fetchImpl: (address, options) => {
    if (options.method === "POST" && String(address) !== expectedEndpoint) throw new Error("OAuth authority changed. Discover settings again.");
    return fetchImpl(address, options);
  } })
});

function registerConfidenceOAuthClient(integration, { callbackUrl, fetchImpl }) {
  return registerConfidenceClient({ clientName: integration.displayName || "Confidence", callbackUrl, scopes: integration.scopes }, { fetchImpl });
}

async function readApplicationIntegrations({ sourceRoot }) {
  try {
    const file = await readSourceEditorFile({ sourceRoot, policy: sourceEditorFilePolicy() }, "integrations.json");
    return { ok: true, baseHash: file.hash, configuration: parseIntegrationConfiguration(file.text) };
  } catch (error) {
    if (!isMissingPathError(error)) throw error;
    return { ok: true, baseHash: null, configuration: { schemaVersion: 1, integrations: {}, registrations: {} } };
  }
}

async function inspectApplicationIntegrationSetup(context, input) {
  const { configuration: config, baseHash } = await readApplicationIntegrations(context);
  const integration = config.integrations[input.integrationId];
  if (!integration) throw sourceEditorError("Choose an integration saved in this project.", "vibe64_integration_missing", {}, 404);
  if (INTEGRATION_PROVIDERS.some((provider) => provider.id === integration.provider && (provider.configurationOnly || provider.configurationOnlyForSettings?.(integration?.settings || {})))) {
    throw sourceEditorError("This integration uses public configuration, not an account connection. Save its settings and wire them into the application.", "vibe64_integration_configuration_only", {}, 422);
  }
  if (integration.accountMode === "per-user" && input.operation !== "status") {
    throw sourceEditorError("Each application user connects through the application's own account screen.", "vibe64_integration_app_user_required", {}, 422);
  }
  if (input.operation.startsWith("ads-") && (integration.provider !== "google-ads" || integration.accountMode !== "shared")) {
    throw sourceEditorError("Select a shared Google Ads project connection.", "vibe64_ads_binding_invalid", {}, 422);
  }
  let paymentAccountId;
  if (input.operation.startsWith("payments-")) {
    const payment = validatePaymentConfiguration(config).environments[input.paymentEnvironment];
    if (!payment || payment.integrationId !== input.integrationId) {
      throw sourceEditorError("Select the payment connection configured for this environment.", "vibe64_payment_binding_invalid", {}, 422);
    }
    paymentAccountId = payment.providerAccountId;
  }
  const setup = await inspectVibe64IntegrationSetup({ projectRoot: context.sourceRoot,
    rootMode: context.releaseEnvironmentFile ? "directory" : "repository" });
  if (setup.status !== "ready") {
    return { ok: true, status: "unconfigured", setupStatus: setup.status };
  }
  const runtime = vibe64RuntimePacks(setup.command.runtimeRequirements);
  if (!runtime.available) throw sourceEditorError(runtime.disabledReason, "vibe64_integration_runtime_unavailable", {}, 422);
  return { setup, runtime, baseHash, paymentAccountId };
}

// Called only with a source root and execution context selected by the host.
// A host that runs the application under its own account reads the committed
// configuration from sourceRoot and runs the command as applicationAccount in
// the application's executionRoot.
async function runApplicationIntegrationSetup({
  sourceRoot, executionRoot = sourceRoot, applicationAccount, env, releaseEnvironmentFile, project, session, selection,
  runCommand = runVibe64Command
}) {
  createIntegrationSetupRequest(selection);
  const checked = await inspectApplicationIntegrationSetup({ sourceRoot, releaseEnvironmentFile, policy: sourceEditorFilePolicy() }, selection);
  if (!checked.setup) return checked;
  const result = await runIntegrationSetupCommand({
    runCommand, command: checked.setup.command, sourceRoot: executionRoot, applicationAccount,
    runtimes: checked.runtime.runtimes, env, releaseEnvironmentFile,
    project, session, selection
  });
  if (checked.paymentAccountId && result.providerAccountId !== checked.paymentAccountId) {
    throw sourceEditorError("The application returned a different payment account. Check its configuration before continuing.", "vibe64_payment_account_mismatch", {}, 409);
  }
  // A CLI or the application command can edit source outside the editor lock.
  // Do not attribute the result to configuration that changed while it ran.
  const current = await readApplicationIntegrations({ sourceRoot });
  if (current.baseHash !== checked.baseHash) {
    throw sourceEditorError(
      "Integration configuration changed during setup. Reload it and check the application's connection before retrying.",
      "vibe64_integration_configuration_changed", {}, 409
    );
  }
  return { ok: true, ...result };
}

function createIntegrationOperations({
  fileIndex,
  integrationCommandRunner,
  integrationDiscoveryFetch,
  projectService,
  publishSessionChanged,
  runSourceEditorWriteExclusive,
  searchIndex,
  sourceEditorContext
}) {
  async function inspectIntegrationSetupRequest(context, input) {
    const request = input.setupRequest;
    if (request === undefined) return;
    if (!isPlainObject(request) || Object.keys(request).length !== 3 ||
        !["connect", "status"].includes(input.operation) ||
        typeof request.turnId !== "string" || request.turnId.length > 32 || !/^\d{6,}$/u.test(request.turnId) ||
        typeof request.requestId !== "string" || !/^[a-f0-9]{64}$/u.test(request.requestId) ||
        typeof request.configurationHash !== "string" || !/^[a-f0-9]{64}$/u.test(request.configurationHash)) {
      throw sourceEditorError("Invalid integration setup request.", "vibe64_invalid_integration_setup_request", {}, 422);
    }
    const saved = await context.runtime.store.readIntegrationSetupRequest(context.sessionId, request.turnId);
    if (!saved || saved.requestId !== request.requestId || saved.integrationId !== input.integrationId) {
      throw sourceEditorError("This integration setup request has changed or no longer exists.",
        "vibe64_integration_setup_request_changed", {}, 409);
    }
    const current = await readApplicationIntegrations(context);
    if (current.baseHash !== request.configurationHash) {
      throw sourceEditorError("Integration configuration changed. Reload it before continuing.",
        "vibe64_integration_configuration_changed", {}, 409);
    }
    if (saved.outcome !== "pending" && input.operation !== "status") {
      throw sourceEditorError("This integration setup request has already been decided. Reload the conversation.",
        "vibe64_integration_setup_request_decided", {}, 409);
    }
    return saved;
  }

  return {
    async runIntegrationSetup(input = {}) {
      return runSourceEditorOperation(async () => {
        if (input.environment !== "development") {
          throw sourceEditorError("Session integration setup requires the development environment.", "vibe64_integration_environment_invalid", {}, 422);
        }
        createIntegrationSetupRequest(input);
        if ((input.operation.startsWith("payments-") || input.operation.startsWith("ads-")) && input.vibe64User && input.vibe64User.role !== "owner") {
          throw sourceEditorError("Only the workspace owner can manage project payments or advertising.", "vibe64_owner_required", {}, 403);
        }
        const preflight = await runSourceEditorWriteExclusive(input, async (context) => {
          await inspectIntegrationSetupRequest(context, input);
          return inspectApplicationIntegrationSetup(context, input);
        });
        if (!preflight.setup) return preflight;
        // Env preparation owns its own lock. Reinspect after it releases the
        // lock so a changed configuration or declaration cannot run unchecked.
        const env = await projectService.projectExecutionEnvironment({ sessionId: input.sessionId, reusePrepared: true });
        return runSourceEditorWriteExclusive(input, async (context) => {
          const savedRequest = await inspectIntegrationSetupRequest(context, input);
          const setupOptions = {
            sourceRoot: context.sourceRoot, env,
            project: await projectService.readCurrentProject(), session: context.session,
            selection: input, runCommand: integrationCommandRunner
          };
          // A repeated chat Connect must recover an existing attempt rather
          // than replace it. Keep status and creation inside the same write lock.
          let result;
          if (savedRequest?.outcome === "pending" && input.operation === "connect") {
            result = await runApplicationIntegrationSetup({ ...setupOptions,
              selection: { ...input, operation: "status", verificationInput: undefined }
            });
          }
          if (!result || ["disconnected", "reconnect-required", "cancelled"].includes(result.status)) {
            result = await runApplicationIntegrationSetup(setupOptions);
          }
          if (savedRequest && savedRequest.outcome !== "pending") return { ...result, integrationSetup: savedRequest };
          if (input.setupRequest && result.status === "connected") {
            if (typeof result.verifiedAt !== "string" || !Number.isFinite(Date.parse(result.verifiedAt))) {
              throw sourceEditorError("The application did not report a verified connection. Check the connection again.",
                "vibe64_integration_setup_unverified", {}, 409);
            }
            const integrationSetup = await context.runtime.store.completeIntegrationSetupRequest(context.sessionId, {
              ...input.setupRequest, verifiedAt: result.verifiedAt
            });
            if (integrationSetup.outcome === "completed") {
              await publishSessionChanged(context.sessionId, { reason: "integration-setup-completed", session: null });
            }
            return { ...result, integrationSetup };
          }
          return result;
        });
      });
    },

    async registerOAuthIntegration(input = {}) {
      return runSourceEditorOperation(async () => {
        if (input.vibe64User && input.vibe64User.role !== "owner") {
          throw sourceEditorError("Only the workspace owner can register a project OAuth client.", "vibe64_owner_required", {}, 403);
        }
        const draft = structuredClone(input.configuration);
        const candidate = draft?.integrations?.[input.integrationId];
        const candidateRegistration = draft?.registrations?.[candidate?.authentication?.registrationRef];
        if (candidateRegistration?.clientId === "") candidateRegistration.clientId = "MISSING";
        const configuration = validateIntegrationConfiguration(draft, {
          providers: INTEGRATION_PROVIDERS, allowUnknownProviders: true
        });
        const integration = configuration.integrations[input.integrationId];
        const registration = configuration.registrations[integration?.authentication.registrationRef];
        if (!Object.hasOwn(OAUTH_CLIENT_REGISTRARS, integration?.provider) || integration.authentication.method !== "oauth2" || registration?.source !== "own" ||
          registration.clientId !== "MISSING" || Object.values(configuration.integrations).filter((item) =>
            item.authentication.registrationRef === integration.authentication.registrationRef).length !== 1) {
          throw sourceEditorError("Choose a new, unshared supported OAuth registration before registering.", "vibe64_integration_registration_invalid", {}, 422);
        }
        const secretKey = /^env:([A-Z_][A-Z0-9_]*)$/u.exec(registration.clientSecretRef || "")?.[1];
        const callbackKey = /^env:([A-Z_][A-Z0-9_]*)$/u.exec(registration.callbackUrlRef || "")?.[1];
        const clientIdKey = `${input.integrationId.toUpperCase().replaceAll("-", "_")}_CLIENT_ID`;
        const keys = [secretKey, callbackKey, clientIdKey];
        if (!secretKey || !callbackKey || new Set(keys).size !== 3 || keys.some(runtimeConfigKeyIsVibe64Reserved) || !/^[A-Z_][A-Z0-9_]*$/u.test(clientIdKey)) {
          throw sourceEditorError("Use distinct Env references for this client's secret, callback and recovery client ID.", "vibe64_integration_registration_invalid", {}, 422);
        }
        if (integration.provider === "n8n" && integration.settings?.oauthDiscovery?.resource !== new URL(integration.settings.serverUrl).href) {
          throw sourceEditorError("Discover settings for the current n8n Server URL first.", "connector_discovery_required", {}, 422);
        }
        if (typeof projectService.readEnv !== "function" || typeof projectService.saveEnvUserValues !== "function") {
          throw sourceEditorError("Project Env storage is unavailable.", "vibe64_integration_registration_unavailable", {}, 503);
        }
        return runSourceEditorWriteExclusive(input, async (context) => {
          const current = await readApplicationIntegrations(context);
          if (current.baseHash !== input.baseHash) {
            throw sourceEditorError("Configuration changed. Reload before registering a client.", SOURCE_EDITOR_CONFLICT_CODE, {}, 409);
          }
          const envInput = { sessionId: input.sessionId, environment: "dev" };
          const environment = await projectService.readEnv(envInput);
          if (!environment?.ok || !Array.isArray(environment.env?.records)) {
            throw sourceEditorError("Read project Env before registering a client.", "vibe64_integration_registration_unavailable", {}, 503);
          }
          if (environment.env.records.some((record) => keys.includes(record.key) && record.valuePresent)) {
            throw sourceEditorError("Registration Env keys already contain values. Recover the existing client or choose unused keys before registering another.", "vibe64_integration_registration_exists", {}, 409);
          }
          const expectedEndpoint = integration.settings?.oauthDiscovery?.oauth.registration_endpoint;
          const client = await OAUTH_CLIENT_REGISTRARS[integration.provider](integration, {
            callbackUrl: input.callbackUrl, fetchImpl: integrationDiscoveryFetch, expectedEndpoint
          });
          try {
            const savedEnv = await projectService.saveEnvUserValues({ ...envInput, values: {
              [secretKey]: { value: client.clientSecret, secret: true },
              [callbackKey]: { value: input.callbackUrl, secret: false },
              [clientIdKey]: { value: client.clientId, secret: false }
            } });
            if (!savedEnv?.ok) throw new Error("Env save failed.");
            registration.clientId = client.clientId;
            if (integration.provider === "n8n") integration.settings = { ...integration.settings, serverUrl: client.resource,
              oauthDiscovery: { resource: client.resource, oauth: client.oauth, scopes: client.scopes } };
            const change = { ...input, path: "integrations.json", text: `${JSON.stringify(configuration, null, 2)}\n` };
            const file = input.baseHash === null ? await createSourceEditorFile(context, change) : await saveSourceEditorFile(context, change);
            return { ok: true, configuration, baseHash: file.hash, fileChange: sourceEditorFileChange(context, change, file),
              ...(client.clientSecretExpiresAt === undefined ? {} : { clientSecretExpiresAt: client.clientSecretExpiresAt }) };
          } catch {
            throw sourceEditorError(`The provider created a client, but local setup did not finish. Inspect Env for ${clientIdKey}, ${secretKey} and ${callbackKey}; values may already be saved. Recover that client before registering again.`,
              "vibe64_integration_registration_incomplete", {}, 409);
          }
        });
      });
    },

    async discoverN8nIntegration(input = {}) {
      return runSourceEditorOperation(async () => {
        await sourceEditorContext(input.sessionId);
        const discovery = await discoverN8nOAuth({ serverUrl: input.serverUrl }, { fetchImpl: integrationDiscoveryFetch });
        return { ok: true, discovery };
      });
    },

    async readIntegrations(input = {}) {
      return runSourceEditorOperation(async () => {
        const context = await sourceEditorContext(input.sessionId);
        return readApplicationIntegrations(context);
      });
    },

    async readIntegrationProviders(input = {}) {
      return runSourceEditorOperation(async () => {
        await sourceEditorContext(input.sessionId);
        const search = String(input.search || "").trim().toLowerCase();
        const matches = INTEGRATION_PROVIDERS.filter((provider) =>
          `${provider.id} ${provider.name} ${provider.description || ""}`.toLowerCase().includes(search));
        const offset = input.offset || 0;
        return {
          ok: true, total: matches.length, nextOffset: offset + 20 < matches.length ? offset + 20 : null,
          providers: matches.slice(offset, offset + 20).map((provider) => ({
            id: provider.id, name: provider.name, description: String(provider.description || "").slice(0, 512),
            descriptionTruncated: String(provider.description || "").length > 512
          }))
        };
      });
    },

    async saveIntegrations(input = {}) {
      return runSourceEditorOperation(async () => {
        if (Object.hasOwn(input, "configuration") === Object.hasOwn(input, "changes")) {
          throw sourceEditorError("Supply configuration or requested changes, not both.", "vibe64_integration_changes_invalid", {}, 422);
        }
        if (input.baseHash !== null && !/^[a-f0-9]{64}$/u.test(String(input.baseHash || ""))) {
          throw sourceEditorError("Reload the integration configuration before saving.", SOURCE_EDITOR_CONFLICT_CODE, {}, 409);
        }
        return runSourceEditorWriteExclusive(input, async (context) => {
          const providers = INTEGRATION_PROVIDERS;
          let candidate = input.configuration;
          if (input.changes) {
            const current = await readApplicationIntegrations(context);
            if (current.baseHash !== input.baseHash) {
              throw sourceEditorError("Integration configuration changed. Reload it before saving.", SOURCE_EDITOR_CONFLICT_CODE, {}, 409);
            }
            candidate = applyIntegrationConfigurationChanges(current.configuration, input.changes);
            for (const [id, change] of Object.entries(input.changes.integrations || {})) {
              if (change !== null && !providers.some((provider) => provider.id === candidate.integrations[id]?.provider)) {
                throw sourceEditorError("Choose a provider available in Integrations.", "vibe64_integration_provider_unavailable", {}, 422);
              }
            }
          }
          const configuration = validateIntegrationConfiguration(candidate, { providers, allowUnknownProviders: true });
          if (configuration.extensions?.payments) validatePaymentConfiguration(configuration);
          const change = { ...input, path: "integrations.json", text: `${JSON.stringify(configuration, null, 2)}\n` };
          const file = input.baseHash === null
            ? await createSourceEditorFile(context, change)
            : await saveSourceEditorFile(context, change);
          if (input.baseHash === null) fileIndex.invalidate(context.sourceRoot);
          searchIndex.invalidate(context.sourceRoot);
          return { ok: true, configuration, baseHash: file.hash, fileChange: sourceEditorFileChange(context, change, file) };
        });
      });
    }
  };
}

function applyIntegrationConfigurationChanges(configuration, changes) {
  const records = ["integrations", "registrations"].flatMap((key) => Object.keys(changes[key] || {}));
  if (!records.length || records.length > 50 || records.some((id) => !/^[a-z][a-z0-9-]*$/u.test(id) || ["constructor", "prototype"].includes(id))) {
    throw sourceEditorError("Supply between 1 and 50 named integration or registration changes.", "vibe64_integration_changes_invalid", {}, 422);
  }
  // JSON merge-patch semantics: omissions preserve values, null removes, arrays
  // replace. Work on a detached copy; final provider validation precedes writing.
  const merge = (target, patch) => {
    let result = target && typeof target === "object" && !Array.isArray(target) ? { ...target } : {};
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) delete result[key];
      else result = { ...result, [key]: typeof value === "object" && !Array.isArray(value) ? merge(result[key], value) : value };
    }
    return result;
  };
  return merge(configuration, changes);
}

export {
  createIntegrationOperations,
  readApplicationIntegrations,
  runApplicationIntegrationSetup
};
