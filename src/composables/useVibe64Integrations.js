import { validatePaymentConfiguration } from "@jskit-ai/payments-core/shared";
import { computed, onScopeDispose, ref, watch } from "vue";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { useRealtimeEvent } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import { validateIntegrationConfiguration } from "@jskit-ai/connectors-core/shared/configuration";
import { connectorDefinitions } from "@jskit-ai/connectors-catalog/shared";
import { googleCalendarDefinition } from "@jskit-ai/connector-google-calendar/shared";
import { vibe64BrowserTabOriginId } from "@/lib/vibe64BrowserTabOrigin.js";
import { vibe64SessionPath, VIBE64_SOURCE_EDITOR_FILE_CHANGED_EVENT } from "@/lib/vibe64SessionRequestConfig.js";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";

// Drafts stay in this tab's memory, never browser storage or source files.
const drafts = new Map();
const verificationDrafts = new Map();

// All integration commands use the same app-owned route and payload boundary.
// Keep separate command instances so their pending state and feedback stay local.
function useIntegrationCommand(method, options) {
  return useCommand({
    access: "never", ownershipFilter: "public", surfaceId: "app", writeMethod: method,
    buildRawPayload: (_model, { context: request }) => request.body,
    buildCommandOptions: (_payload, { context: request }) => ({ method, path: request.path }),
    ...options
  });
}

export function useVibe64Integrations(context, selectedId) {
  const configuration = ref(null);
  const baseline = ref("");
  const baseHash = ref(null);
  const releaseId = ref("");
  const production = computed(() => context.value.integrationEnvironment === "production");
  const fieldErrors = ref({});
  const error = ref("");
  const changedElsewhere = ref(false);
  const sessionId = computed(() => String(context.value.sessionId || ""));
  const active = computed(() => context.value.active !== false && Boolean(production.value ? context.value.productionIntegrationsApiPath : sessionId.value));
  const path = computed(() => production.value ? context.value.productionIntegrationsApiPath : vibe64SessionPath(
    readRefOrGetterValue(context.value.sessionsApiPath), sessionId.value, "/integrations"
  ));
  const dirty = computed(() => Boolean(configuration.value && JSON.stringify(configuration.value) !== baseline.value));
  function rememberDraft(key) {
    if (!key) return;
    if (dirty.value) drafts.set(key, {
      configuration: JSON.parse(JSON.stringify(configuration.value)),
      baseline: baseline.value, baseHash: baseHash.value
    });
    else drafts.delete(key);
  }
  watch(path, (key, previous) => {
    rememberDraft(previous);
    const draft = drafts.get(key);
    configuration.value = draft ? JSON.parse(JSON.stringify(draft.configuration)) : null;
    baseline.value = draft?.baseline || "";
    baseHash.value = draft?.baseHash ?? null;
    releaseId.value = "";
    fieldErrors.value = {};
    error.value = "";
    changedElsewhere.value = false;
  }, { flush: "sync", immediate: true });
  const resource = useEndpointResource({
    path,
    enabled: active,
    queryKey: computed(() => ["vibe64.integrations", path.value]),
    requestRecoveryLabel: "Integrations",
    fallbackLoadError: "Integrations could not load."
  });
  const command = useIntegrationCommand("PUT", {
    apiSuffix: "/vibe64/integrations",
    messages: { success: "Integration configuration saved.", error: "Integration configuration could not be saved." },
    placementSource: "vibe64.integrations.save"
  });
  const discoveryError = ref("");
  const discoveryCommand = useIntegrationCommand("POST", {
    apiSuffix: "/vibe64/integrations/discovery",
    messages: { error: "OAuth settings could not be discovered." },
    placementSource: "vibe64.integrations.discovery"
  });
  watch([path, selectedId], () => { discoveryError.value = ""; });
  async function discoverN8n() {
    const selected = configuration.value?.integrations[selectedId.value];
    if (!active.value || production.value || changedElsewhere.value || context.value.sourceOperationsSuspended ||
      command.isRunning || setupCommand.isRunning || discoveryCommand.isRunning || selected?.provider !== "n8n") return;
    const requestPath = path.value;
    const id = selectedId.value;
    const serverUrl = selected.settings?.serverUrl;
    discoveryError.value = "";
    try {
      const result = await discoveryCommand.run({ path: `${requestPath}/n8n/discovery`, body: { serverUrl } });
      const current = configuration.value?.integrations[id];
      if (disposed || path.value !== requestPath || selectedId.value !== id || current !== selected || current.settings?.serverUrl !== serverUrl) return;
      if (!result?.ok || !result.discovery) throw new Error(result?.error || "OAuth settings could not be discovered.");
      const available = new Set(result.discovery.scopes);
      configuration.value = { ...configuration.value, integrations: { ...configuration.value.integrations,
        [id]: { ...current, scopes: current.scopes.filter((scope) => available.has(scope)),
          settings: { ...current.settings, serverUrl: result.discovery.resource, oauthDiscovery: result.discovery } }
      } };
    } catch (failure) {
      if (!disposed && path.value === requestPath && selectedId.value === id) discoveryError.value = failure.message || "OAuth settings could not be discovered.";
    }
  }
  const registrationError = ref("");
  const registrationNeedsReview = ref(false);
  const registrationCommand = useIntegrationCommand("POST", {
    apiSuffix: "/vibe64/integrations/oauth-client",
    messages: { error: "Client registration did not finish. Check the provider and project Env before trying again." },
    placementSource: "vibe64.integrations.registration"
  });
  watch([path, selectedId], () => { registrationError.value = ""; registrationNeedsReview.value = false; });
  async function registerOAuthClient(callbackUrl) {
    const selected = configuration.value?.integrations[selectedId.value];
    if (!active.value || production.value || changedElsewhere.value || context.value.sourceOperationsSuspended ||
      context.value.owner === false || registrationNeedsReview.value || command.isRunning || setupCommand.isRunning ||
      discoveryCommand.isRunning || registrationCommand.isRunning || !["n8n", "amplitude", "atlassian", "confidence-exp", "confidence-flags", "sanity", "sentry", "granola", "hex", "heygen"].includes(selected?.provider)) return;
    const requestPath = path.value;
    const id = selectedId.value;
    const snapshot = JSON.stringify(configuration.value);
    registrationError.value = "";
    registrationNeedsReview.value = true;
    try {
      const result = await registrationCommand.run({ path: `${requestPath}/${encodeURIComponent(id)}/oauth-client`, body: {
        configuration: JSON.parse(snapshot), baseHash: baseHash.value, callbackUrl, originId: vibe64BrowserTabOriginId()
      } });
      if (disposed || path.value !== requestPath || selectedId.value !== id) return;
      if (!result?.ok || !result.configuration) throw new Error(result?.error || "Registration did not finish. Check the provider and Env before another attempt.");
      if (JSON.stringify(configuration.value) !== snapshot) {
        changedElsewhere.value = true;
        throw new Error("Client registration was saved, but this draft changed. Reload configuration and inspect Env before connecting.");
      }
      apply(result);
      registrationNeedsReview.value = false;
      await runSetup("connect");
    } catch (failure) {
      if (disposed || path.value !== requestPath || selectedId.value !== id) return;
      registrationError.value = failure.message || "Check the provider and Env before another registration attempt.";
      fieldErrors.value = failure.fieldErrors || failure.details?.fieldErrors || {};
    }
  }
  const connection = ref(null);
  const verificationInput = ref({});
  const verificationKey = computed(() => `${path.value}/${selectedId.value || ""}`);
  watch(verificationKey, (key, previous) => {
    if (previous) verificationDrafts.set(previous, { ...verificationInput.value });
    verificationInput.value = { ...verificationDrafts.get(key) };
  }, { immediate: true, flush: "sync" });
  const connectionError = ref("");
  const setupCommand = useIntegrationCommand("POST", {
    apiSuffix: "/vibe64/integrations/setup",
    suppressSuccessMessage: true,
    messages: { error: "The application could not update this connection." },
    placementSource: "vibe64.integrations.setup"
  });
  const setupRequest = computed(() => {
    const request = context.value.integrationSetupRequest;
    if (production.value || !request || request.sessionId !== sessionId.value || request.integrationId !== selectedId.value ||
        typeof request.turnId !== "string" || !/^\d{6,32}$/u.test(request.turnId) ||
        typeof request.requestId !== "string" || !/^[a-f0-9]{64}$/u.test(request.requestId)) return null;
    return { turnId: request.turnId, requestId: request.requestId, configurationHash: baseHash.value };
  });
  const connectionKey = computed(() => `${path.value}/${selectedId.value || ""}/${baseHash.value || ""}/${releaseId.value}/${setupRequest.value?.turnId || ""}/${setupRequest.value?.requestId || ""}`);
  const paymentResult = ref(null);
  const paymentError = ref("");
  const paymentOperation = ref("");
  watch([connectionKey, dirty, active], () => { paymentResult.value = null; paymentError.value = ""; paymentOperation.value = ""; });
  async function runPaymentOperation({ operation, paymentEnvironment, reviewId, providerId, subjectId, collection, after }) {
    if ((production.value && (!releaseId.value || context.value.owner !== true)) || context.value.owner === false || !active.value || dirty.value || changedElsewhere.value ||
        setupCommand.isRunning || command.isRunning || (!production.value && context.value.sourceOperationsSuspended)) return;
    const binding = configuration.value?.extensions?.payments?.environments?.[paymentEnvironment];
    if (!binding || binding.integrationId !== selectedId.value) return;
    if (!["payments-preview", "payments-publish", "payments-readiness", "payments-recover", "payments-history"].includes(operation)) return;
    if (operation === "payments-publish" && (paymentResult.value?.paymentEnvironment !== paymentEnvironment ||
        paymentResult.value?.review?.reviewId !== reviewId || paymentResult.value.review.pending || paymentResult.value.review.drift.length)) return;
    if (operation === "payments-recover" && (paymentResult.value?.paymentEnvironment !== paymentEnvironment ||
        paymentResult.value?.review?.reviewId !== reviewId || !paymentResult.value?.review?.pending ||
        !/^[A-Za-z0-9_-]{1,200}$/.test(providerId || ""))) return;
    const key = connectionKey.value;
    paymentError.value = "";
    paymentOperation.value = operation;
    paymentResult.value = null;
    try {
      const result = await setupCommand.run({ path: `${path.value}/${encodeURIComponent(selectedId.value)}/setup`,
        body: { operation, paymentEnvironment, ...(operation === "payments-history" ? { subjectId, collection, after: after ?? null } : {}), ...(production.value ? { releaseId: releaseId.value } : {}), ...(["payments-publish", "payments-recover"].includes(operation) ? { reviewId } : {}), ...(operation === "payments-recover" ? { providerId } : {}) } });
      if (!disposed && key === connectionKey.value && !dirty.value) paymentResult.value = result;
    } catch {
      if (!disposed && key === connectionKey.value) {
        paymentResult.value = null;
        paymentError.value = ["payments-publish", "payments-recover"].includes(operation)
          ? "Publication did not finish cleanly. Check the application's pending provider operation before publishing again; changes may already exist."
          : "The application could not inspect payments. Check its payment command, configuration and Env, then retry.";
      }
    }
  }
  const adsResult = ref(null);
  const adsError = ref("");
  watch([connectionKey, dirty, active], () => { adsResult.value = null; adsError.value = ""; });
  async function runAdsOperation({ operation, ads = {} }) {
    if (production.value || context.value.owner === false || !active.value || dirty.value || changedElsewhere.value ||
        setupCommand.isRunning || command.isRunning || context.value.sourceOperationsSuspended ||
        configuration.value?.integrations[selectedId.value]?.provider !== "google-ads") return;
    const key = connectionKey.value;
    adsError.value = "";
    adsResult.value = null;
    try {
      const result = await setupCommand.run({ path: `${path.value}/${encodeURIComponent(selectedId.value)}/setup`, body: { operation, ads } });
      if (!disposed && key === connectionKey.value && !dirty.value) adsResult.value = result;
    } catch {
      if (!disposed && key === connectionKey.value) adsError.value = "The advertising operation did not complete. Inspect Google Ads before repeating a write: it may already have succeeded. Check the app command, permissions and Env for details.";
    }
  }
  async function runSetup(operation = "status") {
    const selected = configuration.value?.integrations[selectedId.value];
    if (connectorDefinitions.some((provider) => provider.id === selected?.provider && (provider.configurationOnly || provider.configurationOnlyForSettings?.(selected?.settings || {})))) return;
    if ((production.value && (!releaseId.value || context.value.owner !== true)) || !active.value || !Object.hasOwn(configuration.value?.integrations || {}, selectedId.value) || dirty.value || changedElsewhere.value ||
        setupCommand.isRunning || command.isRunning || (!production.value && context.value.sourceOperationsSuspended)) return;
    const key = connectionKey.value;
    const endpoint = `${path.value}/${encodeURIComponent(selectedId.value)}/setup`;
    const releaseSelection = production.value ? { releaseId: releaseId.value } : {};
    connectionError.value = "";
    try {
      const result = await setupCommand.run({ path: endpoint, body: {
        operation, ...releaseSelection,
        ...(setupRequest.value && ["status", "connect"].includes(operation) &&
          (operation === "status" || !connection.value?.integrationSetup || connection.value.integrationSetup.outcome === "pending")
          ? { setupRequest: setupRequest.value } : {}),
        ...(operation === "cancel" ? { attemptId: connection.value?.attemptId } : {}),
        ...(operation === "connect" && Object.keys(verificationInput.value).length ? { verificationInput: { ...verificationInput.value } } : {})
      } });
      if (disposed || connectionKey.value !== key) return;
      connection.value = result;
      if (setupRequest.value && result.integrationSetup?.outcome === "completed" &&
          result.integrationSetup.continuation?.status !== "accepted") {
        try {
          const resumed = await setupCommand.run({
            path: vibe64SessionPath(readRefOrGetterValue(context.value.sessionsApiPath), sessionId.value,
              "/integration-setup/resume"),
            body: { turnId: setupRequest.value.turnId, requestId: setupRequest.value.requestId }
          });
          if (!disposed && connectionKey.value === key) {
            connection.value = { ...result, integrationSetup: resumed.integrationSetup };
          }
        } finally {
          if (!disposed && connectionKey.value === key && typeof context.value.refreshConversation === "function") {
            await context.value.refreshConversation();
          }
        }
        if (disposed || connectionKey.value !== key) return;
      } else if (result.integrationSetup && typeof context.value.refreshConversation === "function") {
        await context.value.refreshConversation();
        if (disposed || connectionKey.value !== key) return;
      }
      // Cancellation may leave an older working grant in place. Ask the app.
      if (operation === "cancel") {
        const status = await setupCommand.run({ path: endpoint, body: { operation: "status", ...releaseSelection } });
        if (!disposed && connectionKey.value === key) connection.value = status;
      }
    } catch (failure) {
      if (!disposed && connectionKey.value === key) {
        connectionError.value = failure.message || "Connection could not be checked.";
        // A failed check may follow an Env key replacement. The old verification
        // record is not proof that the current credential still works.
        if (operation === "connect" && configuration.value.integrations[selectedId.value].authentication.method !== "oauth2" &&
            ["connected", "reconnect-required"].includes(connection.value?.status)) {
          try {
            const status = await setupCommand.run({ path: endpoint, body: { operation: "status", ...releaseSelection } });
            if (!disposed && connectionKey.value === key) connection.value = status;
          } catch {
            // Keep the original failure visible when status is also unavailable.
          }
        }
      }
    }
  }
  watch([connectionKey, active], () => {
    connection.value = null;
    connectionError.value = "";
    if (active.value && !dirty.value && configuration.value?.integrations[selectedId.value]?.accountMode !== "per-user") void runSetup();
  });
  watch([() => command.isRunning, () => setupCommand.isRunning], () => {
    if (!connection.value && !connectionError.value && !command.isRunning && !setupCommand.isRunning &&
        configuration.value?.integrations[selectedId.value]?.accountMode !== "per-user") void runSetup();
  });
  let disposed = false;
  function refreshPendingConnection() {
    if (disposed || globalThis.document?.visibilityState === "hidden" ||
        connection.value?.status !== "pending" ||
        configuration.value?.integrations[selectedId.value]?.accountMode === "per-user") return;
    void runSetup("status");
  }
  globalThis.window?.addEventListener("focus", refreshPendingConnection);
  globalThis.document?.addEventListener("visibilitychange", refreshPendingConnection);
  onScopeDispose(() => {
    globalThis.window?.removeEventListener("focus", refreshPendingConnection);
    globalThis.document?.removeEventListener("visibilitychange", refreshPendingConnection);
    rememberDraft(path.value);
    verificationDrafts.set(verificationKey.value, { ...verificationInput.value });
    disposed = true;
  });

  function apply(payload) {
    configuration.value = JSON.parse(JSON.stringify(payload.configuration));
    baseline.value = JSON.stringify(payload.configuration);
    baseHash.value = payload.baseHash;
    releaseId.value = production.value ? payload.releaseId || "" : "";
    changedElsewhere.value = false;
    error.value = "";
    fieldErrors.value = {};
  }

  watch(resource.data, (payload) => {
    if (!payload?.configuration || disposed || (payload.environment === "production") !== production.value) return;
    if (dirty.value) {
      changedElsewhere.value = payload.baseHash !== baseHash.value;
    } else apply(payload);
  }, { immediate: true });

  useRealtimeEvent({
    event: VIBE64_SOURCE_EDITOR_FILE_CHANGED_EVENT,
    enabled: active,
    onEvent: ({ payload }) => {
      if (production.value || payload.sessionId !== sessionId.value || payload.path !== "integrations.json" ||
          payload.originId === vibe64BrowserTabOriginId()) return;
      void resource.reload();
    }
  });

  async function save() {
    if (production.value || !dirty.value || changedElsewhere.value || registrationCommand.isRunning || discoveryCommand.isRunning || command.isRunning || context.value.sourceOperationsSuspended) return;
    const requestPath = path.value;
    error.value = "";
    fieldErrors.value = {};
    try {
      const validated = validateIntegrationConfiguration(configuration.value, {
        providers: [googleCalendarDefinition, ...connectorDefinitions], allowUnknownProviders: true
      });
      if (validated.extensions?.payments) validatePaymentConfiguration(validated);
      const payload = await command.run({
        path: path.value,
        body: { configuration: validated, baseHash: baseHash.value, originId: vibe64BrowserTabOriginId() }
      });
      if (payload && !disposed && path.value === requestPath) apply(payload);
    } catch (failure) {
      if (disposed || path.value !== requestPath) return;
      fieldErrors.value = failure.fieldErrors || failure.details?.fieldErrors || {};
      error.value = failure.message || "Configuration could not be saved. Reload to check for other changes.";
      if (failure.status === 409 || failure.statusCode === 409) changedElsewhere.value = true;
    }
  }

  async function discard() {
    if (command.isRunning) return;
    const requestPath = path.value;
    const result = await resource.reload();
    if (result?.data?.configuration && !result.isError && !disposed && path.value === requestPath) apply(result.data);
  }

  return { adsResult, adsError, runAdsOperation, paymentResult, paymentError, paymentOperation, runPaymentOperation, registrationCommand, registrationError, registrationNeedsReview, registerOAuthClient, discoveryCommand, discoveryError, discoverN8n, releaseId, connection, connectionError, verificationInput, setupCommand, runSetup, configuration, dirty, resource, command, fieldErrors, error, changedElsewhere, save, discard };
}
