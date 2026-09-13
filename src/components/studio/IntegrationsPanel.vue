<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { IntegrationConfigurationFields } from "@jskit-ai/connectors-web/client";
import { getProviderClientAuthenticationMethods, getProviderScopes } from "@jskit-ai/connectors-core/shared/configuration";
import { connectorDefinitions } from "@jskit-ai/connectors-catalog/shared";
import { googleCalendarDefinition } from "@jskit-ai/connector-google-calendar/shared";
import { useVibe64Integrations } from "@/composables/useVibe64Integrations.js";
import { useVibe64ProjectSlug } from "@/composables/useVibe64ProjectScope.js";
import { integrationCallbackUrl } from "@/lib/integrationCallbackUrl.js";
import { readLocalStorageJson, writeLocalStorageJson } from "@/lib/browserLocalStorage.js";
import { projectAppPath } from "@/lib/vibe64ProjectScope.js";
import GoogleAdsSearchPanel from "@/components/studio/GoogleAdsSearchPanel.vue";
import googleAdsSearchGuide from "@local/vibe64-source-editor/docs/application-google-ads.md?raw";
import PaymentConfigurationPanel from "@/components/studio/PaymentConfigurationPanel.vue";
import integrationSetupGuide from "@local/vibe64-source-editor/docs/application-integration-setup.md?raw";
import laravelPaymentsGuide from "@local/vibe64-source-editor/docs/application-payments-laravel.md?raw";
import paymentSchema from "@jskit-ai/payments-core/configuration.schema.json";
import paymentConformance from "@jskit-ai/payments-core/conformance.json";
import paymentContract from "@jskit-ai/payments-core/docs/contract.md?raw";
import paymentConformanceGuide from "@jskit-ai/payments-core/docs/conformance.md?raw";
import IntegrationServiceLogo from "./IntegrationServiceLogo.vue";
import { groupIntegrationProviders } from "@/lib/integrationCatalogue.js";
import Vibe64AsyncModuleState from "@/components/common/Vibe64AsyncModuleState.vue";

const props = defineProps({ dashboardContext: { type: Object, required: true } });
const route = useRoute();
const router = useRouter();
const selectedId = ref("");
const environment = ref("development");
const production = computed(() => environment.value === "production");
const integrationContext = computed(() => ({
  ...props.dashboardContext, integrationEnvironment: environment.value,
  integrationSetupRequest: {
    sessionId: route.query.integrationSession, integrationId: route.query.integration,
    turnId: route.query.integrationTurn, requestId: route.query.integrationRequest
  }
}));
const { adsResult, adsError, runAdsOperation, paymentResult, paymentError, paymentOperation, runPaymentOperation, registrationCommand, registrationError, registrationNeedsReview, registerOAuthClient, discoveryCommand, discoveryError, discoverN8n, releaseId, connection, connectionError, verificationInput, setupCommand, runSetup, configuration, dirty, resource, command, fieldErrors, error, changedElsewhere, save, discard } =
  useVibe64Integrations(integrationContext, selectedId);
const projectSlug = useVibe64ProjectSlug();
function openPaymentEnv({ key, value, secret }) {
  return router.push({ path: projectAppPath(projectSlug.value, production.value ? "/dashboard/deploy" : "/dashboard/env"),
    query: { prefillKey: key, ...(secret ? { prefillSecret: "true" } : {}), ...(value === undefined ? {} : { prefillValue: value }) } });
}
watch([projectSlug, () => props.dashboardContext.productionIntegrationsApiPath], ([slug, apiPath]) => {
  environment.value = apiPath && readLocalStorageJson(`vibe64:integrations:environment:${slug}`, "development") === "production"
    ? "production" : "development";
}, { immediate: true, flush: "sync" });
watch(environment, (value) => {
  writeLocalStorageJson(`vibe64:integrations:environment:${projectSlug.value}`, value);
});
const search = ref("");
const navigationKey = computed(() => `vibe64:integrations:${encodeURIComponent(projectSlug.value)}:${production.value ? 'published' : encodeURIComponent(props.dashboardContext.sessionId || "")}:${environment.value}`);
watch(navigationKey, (key) => {
  const saved = readLocalStorageJson(key, {});
  selectedId.value = typeof saved?.selectedId === "string" ? saved.selectedId : "";
  search.value = typeof saved?.search === "string" ? saved.search : "";
}, { immediate: true, flush: "sync" });
watch([selectedId, search], () => {
  if (production.value || props.dashboardContext.sessionId) writeLocalStorageJson(navigationKey.value, {
    selectedId: selectedId.value, search: search.value
  });
});
const requestedIntegration = computed(() => route.query.integrationSession === props.dashboardContext.sessionId &&
  typeof route.query.integration === "string" && route.query.integration.length <= 200 ? route.query.integration : "");
watch(requestedIntegration, (id) => {
  if (!id) return;
  environment.value = "development";
  selectedId.value = id;
  search.value = "";
}, { immediate: true, flush: "sync" });

const discardOpen = ref(false);
const removeOpen = ref(false);
const disconnectOpen = ref(false);
const providers = [googleCalendarDefinition, ...connectorDefinitions];
const providerGroups = computed(() => groupIntegrationProviders(providers, search.value));
const expandedCategories = ref([]);
const visibleCategories = computed({
  get: () => String(search.value || "").trim() ? providerGroups.value.map((group) => group.id) : expandedCategories.value,
  set: (value) => { if (!String(search.value || "").trim()) expandedCategories.value = value; }
});
const entries = computed(() => Object.entries(configuration.value?.integrations || {}));
const filteredEntries = computed(() => entries.value.filter(([id, entry]) =>
  `${id} ${entry.displayName || ""} ${entry.provider}`.toLowerCase().includes(String(search.value || "").toLowerCase())
));
const selected = computed(() => Object.hasOwn(configuration.value?.integrations || {}, selectedId.value)
  ? configuration.value.integrations[selectedId.value] : undefined);
const provider = computed(() => providers.find((entry) => entry.id === selected.value?.provider));
const configurationOnly = computed(() => provider.value?.configurationOnly || provider.value?.configurationOnlyForSettings?.(selected.value?.settings || {}));
const verificationIncomplete = computed(() => provider.value?.verificationFields?.some((field) =>
  field.required && !String(verificationInput.value[field.name] || "").trim()) === true);
const setupPrompt = computed(() => [
  `Implement the saved integration ${JSON.stringify(selectedId.value)} (${JSON.stringify(selected.value?.provider)}) from integrations.json.`,
  "Use this project's selected framework and existing backend composition. Keep credentials, connections, callbacks and refresh owned by this application so it runs independently of Vibe64.",
  ...(provider.value?.setup ? [
    `Selected provider setup instructions:\n\n${(provider.value.setup.stepsForSettings?.(selected.value?.settings || {}, selected.value?.authentication.method) || provider.value.setup.stepsByAuthentication?.[selected.value?.authentication.method] || provider.value.setup.steps || []).join("\n\n")}`,
    `Provider setup guide: ${provider.value.setup.urlForSettings?.(selected.value?.settings || {}, selected.value?.authentication.method) || provider.value.setup.urlByAuthentication?.[selected.value?.authentication.method] || provider.value.setup.url}`
  ] : []),
  configurationOnly.value
    ? "Use the saved public settings to implement this integration through the selected framework. Do not create a connection command, OAuth flow or provider verification request. For Analytics, preserve existing tag-manager and consent behavior, avoid duplicate tags, and do not send test tracking events."
    : selected.value?.accountMode === "per-user"
    ? "Implement connection settings inside this application's authenticated user account screen: status, connect, reconnect, cancel and disconnect. Derive each connection owner from the authenticated app user, isolate their grants, and bind OAuth callbacks to the initiating user. This configures individual accounts, not a shared administrator connection or a new application login method."
    : "Implement the Integration setup command using the documented application-owned contract, with safe status, connect, cancel and disconnect results.",
  ...(['stripe', 'paddle'].includes(selected.value?.provider) && configuration.value?.extensions?.payments ? [
    `Selected provider payment setup:\n\n${provider.value.paymentSetup.steps.join("\n\n")}\n\n${provider.value.paymentSetup.url}`,
    "Implement the saved extensions.payments contract as well as credential verification. Use the selected framework's existing billing owner; do not add a parallel billing system. Plans and Env references stay in integrations.json; customers, subscriptions, credits and catalogue mappings stay in this application's database.",
    "Implement authenticated billing-account reads, checkout and customer portal routes, raw-byte signed provider webhooks, current-state subscription reconciliation, feature enforcement and transactional renewal credits. Derive the billable subject from authenticated app membership. A checkout redirect is not payment proof. Keep sandbox/live accounts, mappings and credentials isolated.",
    "Extend the existing Integration setup command with payments-preview, payments-publish, payments-readiness, payments-recover and payments-history using the documented vibe64.integration-setup.command.v1 payment contract. Preserve other operations. Read the public application-integration-setup.md contract: paymentEnvironment and reviewed reviewId inputs; bounded payments results with providerAccountId, changes, drift, removed and pending. Preview must be read-only; publish must revalidate the review and retain partial-write recovery and historical price mappings.",
    "For JSKIT, compose payments-core and the optional payments-web component using normal app routes, storage and HTTP hooks. For Laravel, follow application-payments-laravel.md and the same portable configuration/operation semantics using native framework libraries. Do not add PHP to JSKIT or require Node payment execution from Laravel. Neither implementation may call Vibe64 to authorize customer billing.",
    selected.value?.provider === 'paddle'
      ? "Paddle needs a separate public client-side token and an app-owned Paddle.js checkout page; keep the private API key and signing secret server-side. Domain and merchant approval remain explicit provider steps."
      : "Stripe needs the environment's own webhook destination/signing secret and configured customer portal. Handle invoice payment failures and subscription lifecycle updates without granting unpaid renewal credits.",
    "Expose the app billing screen with plans, credits, subscription status, customer-scoped subscription/invoice/transaction history and management actions. Authorize history separately, resolve the customer from this app's subject binding and preserve provider status; invoice/transaction totals are not proof of payment. Use controlled fixtures for authorization, webhook signatures, retries, plan/credit behavior and management output; report unimplemented capabilities honestly. Do not publish catalogue changes or perform charges during implementation.",
    `Portable payment semantics (applies to every framework):\n\n${paymentContract}`,
    `Payment configuration JSON Schema (validate extensions.payments; no JSKIT runtime required):\n\n${JSON.stringify(paymentSchema, null, 2)}`,
    `Portable conformance instructions:\n\n${paymentConformanceGuide}`,
    `Portable conformance JSON (translate these fixtures into this framework's native tests; do not install a Node sidecar for another framework):\n\n${JSON.stringify(paymentConformance, null, 2)}`,
    `Public app-operation contract (apply its payment section as well as the command envelope):\n\n${integrationSetupGuide}`,
    `Native Laravel guidance (only when this project selects Laravel; other frameworks implement the same contract with their own libraries):\n\n${laravelPaymentsGuide}`
  ] : []),
  ...(selected.value?.provider === "google-ads" ? [googleAdsSearchGuide] : []),
  "Use the saved Env references without putting secret values in source or chat.",
  "Preserve the existing configuration and implement controlled tests. Do not register provider accounts, perform live consent, send real messages or deploy."
].join("\n\n"));
const callbackOverride = ref(null);
const setupCopyMessage = ref("");
const registration = computed(() => configuration.value?.registrations[selected.value?.authentication.registrationRef]);
const permissionLabels = computed(() => Object.fromEntries(
  provider.value ? getProviderScopes(provider.value, selected.value?.settings || {},
    registration.value?.grantType || "authorization_code").map((scope) => [scope.value, scope.label]) : []
));
const credentials = computed(() => {
  const reference = selected.value?.authentication.method === "oauth2"
    ? registration.value?.clientSecretRef : selected.value?.authentication.secretRef;
  const primaryKey = /^env:([A-Z_][A-Z0-9_]*)$/u.exec(reference || "")?.[1];
  const entries = primaryKey ? [{ key: primaryKey, label: "Application credential", public: false }] : [];
  for (const field of provider.value?.settingsFields || []) {
    if (!field.environmentCredential) continue;
    const key = /^env:([A-Z_][A-Z0-9_]*)$/u.exec(selected.value?.settings?.[field.name] || "")?.[1];
    if (key) entries.push({ key, ...field.environmentCredential });
  }
  return entries;
});
const callbackKey = computed(() => /^env:([A-Z_][A-Z0-9_]*)$/u.exec(registration.value?.callbackUrlRef || "")?.[1] || "");
const callbackUrl = computed({
  get: () => callbackOverride.value ?? integrationCallbackUrl(props.dashboardContext.applicationPublicUrl,
    provider.value?.setup?.callbackPath || `/integrations/${selected.value?.authentication.registrationRef}/callback`),
  set: (value) => { callbackOverride.value = value; }
});
const clientRegistrationEndpoint = computed(() => {
  if (selected.value?.authentication.method !== "oauth2") return undefined;
  const endpoint = provider.value?.setup?.clientRegistrationEndpoint;
  return typeof endpoint === "function" ? endpoint(selected.value?.settings || {}) : endpoint;
});
const clientRegistrationBody = computed(() => !clientRegistrationEndpoint.value || !callbackUrl.value ? "" : JSON.stringify({
  client_name: `${projectSlug.value} — ${selected.value?.displayName || provider.value.name}`,
  redirect_uris: [callbackUrl.value],
  token_endpoint_auth_method: "client_secret_post",
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  scope: (selected.value?.scopes || []).join(" ")
}, null, 2));
const clientMetadata = computed(() => {
  const build = provider.value?.setup?.createClientMetadata;
  if (!build) return null;
  try {
    return { json: JSON.stringify(build({
      clientId: registration.value?.clientId,
      clientName: selected.value?.displayName || provider.value.name,
      callbackUrl: callbackUrl.value
    }), null, 2) };
  } catch {
    return { json: "", error: "Enter a valid Client metadata URL, display name and suggested callback to prepare the document." };
  }
});
watch([selectedId, navigationKey, releaseId], () => {
  callbackOverride.value = null;
  setupCopyMessage.value = "";
  discardOpen.value = false;
  removeOpen.value = false;
  disconnectOpen.value = false;
}, { flush: "sync" });
async function copySetupValue(value, label = "Callback URL") {
  setupCopyMessage.value = "";
  try {
    await navigator.clipboard.writeText(value);
    setupCopyMessage.value = `${label} copied.`;
  } catch {
    setupCopyMessage.value = "Could not copy. Select the value in its field and copy it manually.";
  }
}
const disabled = computed(() => registrationCommand.isRunning || discoveryCommand.isRunning || command.isRunning || setupCommand.isRunning || (!production.value && props.dashboardContext.sourceOperationsSuspended === true) || (production.value && props.dashboardContext.owner !== true) || changedElsewhere.value);
const loadError = computed(() => resource.loadError.value || (resource.data.value?.ok === false ? resource.data.value.error : ""));

function add(provider) {
  if (production.value) return;
  const current = configuration.value;
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
  configuration.value = {
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
  selectedId.value = id;
}

function remove() {
  if (production.value) return;
  const next = { ...configuration.value.integrations };
  const registrations = { ...configuration.value.registrations };
  const registrationId = selected.value.authentication.registrationRef;
  delete next[selectedId.value];
  if (!registrations[registrationId]?.clientId && registrations[registrationId]?.source === "own" &&
      !Object.values(next).some((entry) => entry.authentication.registrationRef === registrationId)) {
    delete registrations[registrationId];
  }
  configuration.value = { ...configuration.value, integrations: next, registrations };
  selectedId.value = "";
  removeOpen.value = false;
}

function warnBeforeUnload(event) {
  if (!dirty.value) return;
  event.preventDefault();
  event.returnValue = "";
}
onMounted(() => window.addEventListener("beforeunload", warnBeforeUnload));
onUnmounted(() => window.removeEventListener("beforeunload", warnBeforeUnload));
</script>

<template>
  <section class="integrations-panel">
    <header class="integrations-panel__header">
      <div><h1 class="text-headline-small font-weight-bold ma-0">Integrations</h1></div>
      <v-btn height="48" variant="text" :disabled="command.isRunning" @click="dirty ? discardOpen = true : resource.reload()">Refresh</v-btn>
    </header>
    <v-btn-toggle v-if="dashboardContext.productionIntegrationsApiPath" v-model="environment" mandatory aria-label="Integration environment">
      <v-btn value="development">Development</v-btn><v-btn value="production">Production</v-btn>
    </v-btn-toggle>
    <v-alert v-if="production" type="info" variant="tonal">
      Published configuration{{ releaseId ? ` (${releaseId})` : '' }}. Make configuration changes in Development, then publish them.
      <p v-if="!dashboardContext.owner">Only the workspace owner can manage production connections.</p>
    </v-alert>
    <p v-if="!production && !dashboardContext.sessionId">Open a session to configure its integrations.</p>
    <Vibe64AsyncModuleState
      v-else-if="resource.isInitialLoading.value || loadError"
      label="Integrations" :loading="resource.isInitialLoading.value" :message="loadError || 'Loading integrations.'"
      @retry="resource.reload()" @reload="resource.reload()"
    />
    <template v-else-if="configuration">
      <v-alert v-if="changedElsewhere" type="warning" variant="tonal">This configuration changed outside this form. Your draft is preserved. Reload before saving.</v-alert>
      <v-alert v-if="error" role="alert" type="error" variant="tonal">{{ error }}</v-alert>
      <v-alert v-if="!production && requestedIntegration && configuration && !Object.hasOwn(configuration.integrations, requestedIntegration)" type="warning" variant="tonal">
        The requested integration {{ requestedIntegration }} is not configured in this session. Return to the conversation to finish its setup.
      </v-alert>
      <div class="integrations-panel__layout">
        <aside class="integrations-panel__catalogue" aria-label="Integrations catalogue">
          <v-text-field v-model="search" label="Search integrations" hide-details clearable @click:clear="search = ''" />
          <h2 class="text-title-medium mt-6 mb-2">{{ production ? 'Configured in the published release' : 'Configured in this session' }}</h2>
          <v-list v-if="filteredEntries.length" aria-label="Configured integrations" bg-color="transparent">
            <v-list-item
              v-for="[id, entry] in filteredEntries" :key="id" :active="selectedId === id" min-height="48"
              :title="entry.displayName || entry.provider" :subtitle="id" @click="selectedId = id"
            >
              <template #prepend><IntegrationServiceLogo :provider="entry.provider" /></template>
            </v-list-item>
          </v-list>
          <p v-else role="status" class="text-body-medium">{{ entries.length ? 'No configured integrations match your search.' : 'No integrations configured yet.' }}</p>
          <h2 v-if="!production" class="text-title-medium mt-6 mb-2">Available services</h2>
          <v-expansion-panels v-if="!production && providerGroups.length" v-model="visibleCategories" multiple variant="accordion" aria-label="Available services">
            <v-expansion-panel v-for="group in providerGroups" :key="group.id" :value="group.id">
              <v-expansion-panel-title min-height="56">
                <span class="text-title-small">{{ group.title }}</span>
                <v-chip class="ml-3" size="small" variant="tonal">{{ group.providers.length }}</v-chip>
              </v-expansion-panel-title>
              <v-expansion-panel-text>
                <v-list :aria-label="group.title" bg-color="transparent">
                  <v-list-item v-for="entry in group.providers" :key="entry.id" :title="entry.name" :subtitle="entry.description">
                    <template #prepend><IntegrationServiceLogo :provider="entry.id" /></template>
                    <template #append><v-btn :aria-label="`Add ${entry.name}`" height="48" variant="text" :disabled="disabled" @click="add(entry)">Add</v-btn></template>
                  </v-list-item>
                </v-list>
              </v-expansion-panel-text>
            </v-expansion-panel>
          </v-expansion-panels>
          <p v-else-if="!production" role="status" class="text-body-medium">No services match your search.</p>
        </aside>
        <main class="integrations-panel__detail">
          <template v-if="selected">
            <header class="integrations-panel__header mb-4">
              <div class="d-flex align-center"><IntegrationServiceLogo :provider="selected.provider" /><div><h2>{{ selected.displayName || selected.provider }}</h2><p>Application configuration</p></div></div>
              <v-btn v-if="!production" height="48" variant="text" color="error" :disabled="disabled" @click="removeOpen = true">Remove</v-btn>
            </header>
            <section aria-label="Application connection" class="mb-6">
              <h3 class="text-title-medium">{{ production ? 'Production connection' : 'Development connection' }}</h3>
              <template v-if="configurationOnly">
                <p role="status">{{ dirty ? 'Unsaved configuration' : 'Configured' }}</p>
                <p>Your application uses these public settings. Saving does not install the integration or verify that your application can use it.</p>
              </template>
              <p v-else-if="selected.accountMode === 'per-user'">Each user connects in your application's own account screen.</p>
              <template v-else>
                <p>This account is used by {{ projectSlug }} in {{ environment }}. Your application owns its access.</p>
                <p v-if="dirty">Save configuration before checking or connecting this account.</p>
                <v-skeleton-loader v-else-if="setupCommand.isRunning && !connection" type="list-item-two-line" aria-label="Checking connection" />
                <template v-else-if="connection">
                  <p role="status">{{ {
                    unconfigured: connection.setupIssue ? 'Application setup needs attention.' : 'Application connection setup is not implemented yet.',
                    disconnected: 'Not connected', connected: 'Connected', pending: 'Waiting for provider approval',
                    'reconnect-required': 'Reconnect required', cancelled: 'Connection cancelled'
                  }[connection.status] }}</p>
                  <p v-if="connection.status === 'disconnected'">No account is connected here. Provider permissions and credentials in Env are managed separately; disconnecting here does not revoke them.</p>
                  <p v-if="connection.setupIssue === 'credentials-missing'">Complete the required provider settings and credentials. Blank values and MISSING placeholders cannot connect. Use the credential and Env controls below, then check again.</p>
                  <p v-else-if="connection.setupIssue === 'callback-invalid'">Set a valid application callback URL in Env and register that exact URL with the provider. Your application must serve the callback route.</p>
                  <template v-else-if="connection.status === 'unconfigured'">
                    <p>Ask the project assistant to implement this integration. Saving credentials alone does not connect it.</p>
                  </template>
                  <div v-if="connection.grantedScopes?.length">
                    <p>Granted permissions</p>
                    <ul>
                      <li v-for="scope in connection.grantedScopes" :key="scope">{{ permissionLabels[scope] || scope }}</li>
                    </ul>
                  </div>
                  <p v-if="connection.verifiedAt">Last verified: <time :datetime="connection.verifiedAt">{{ new Date(connection.verifiedAt).toLocaleString() }}</time></p>
                  <p v-if="connection.accountLabel">Connected account: {{ connection.accountLabel }}</p>
                  <div class="integrations-panel__actions">
                    <template v-if="connection.status === 'pending'">
                      <v-btn height="48" :href="connection.authorizationUrl" target="_blank" rel="noopener noreferrer" :disabled="disabled">Continue with provider</v-btn>
                      <v-btn height="48" variant="text" :disabled="disabled" @click="runSetup('cancel')">Cancel connection</v-btn>
                    </template>
                    <template v-else-if="['disconnected', 'connected', 'reconnect-required'].includes(connection.status)">
                      <div v-if="provider?.verificationFields?.length" class="w-100">
                        <h4>Verify access</h4>
                        <p>These values are used for this connection check and are not saved in source.</p>
                        <v-text-field v-for="field in provider.verificationFields" :key="field.name"
                          v-model="verificationInput[field.name]" :label="field.label" :hint="field.hint"
                          persistent-hint :required="field.required" :disabled="dirty || disabled" />
                        <p v-if="verificationIncomplete">Enter the required verification inputs before connecting.</p>
                      </div>
                      <v-btn height="48" color="primary" :disabled="dirty || disabled || verificationIncomplete" @click="runSetup('connect')">{{
                        connection.status === 'disconnected' ? 'Connect account'
                          : connection.status === 'connected' && selected.authentication.method !== 'oauth2' ? 'Verify again' : 'Reconnect'
                      }}</v-btn>
                    </template>
                    <v-btn v-if="['connected', 'reconnect-required'].includes(connection.status)" height="48" variant="text" :disabled="dirty || disabled" @click="disconnectOpen = true">Disconnect</v-btn>
                  </div>
                </template>
                <v-alert v-if="connectionError" type="error" variant="tonal" role="alert">{{ connectionError }}</v-alert>
                <v-btn height="48" variant="text" :disabled="dirty || disabled" @click="runSetup('status')">{{ setupCommand.isRunning ? 'Checking…' : 'Check connection' }}</v-btn>
              </template>
              <template v-if="!production && dashboardContext.requestAssistantDraft && dashboardContext.assistantDirectAllowed &&
                (configurationOnly || selected.accountMode === 'per-user' || (connection?.status === 'unconfigured' && !connection.setupIssue))">
                <v-btn height="48" variant="tonal" :disabled="dirty || disabled"
                  @click="dashboardContext.requestAssistantDraft(setupPrompt)">{{ selected.accountMode === 'per-user' ? 'Prepare app user connection request' : 'Prepare setup request' }}</v-btn>
                <p>Adds a request to your chat draft for review before sending.</p>
              </template>
            </section>
            <IntegrationConfigurationFields
              v-if="provider" v-model="configuration" :integration-id="selectedId"
              :provider="provider" :field-errors="fieldErrors" :disabled="production || disabled"
            />
            <p v-else>This provider's configuration is preserved. Edit its configuration in Files.</p>
            <GoogleAdsSearchPanel v-if="provider?.id === 'google-ads' && selected.accountMode === 'shared'" :key="navigationKey + selectedId" v-model="configuration"
              :integration-id="selectedId" :disabled="production || disabled" :application-public-url="dashboardContext.applicationPublicUrl"
              :result="adsResult" :error="adsError" :loading="setupCommand.isRunning"
              :management-disabled="production || dirty || disabled || dashboardContext.owner === false"
              :can-prepare="!production && Boolean(dashboardContext.requestAssistantDraft) && dashboardContext.assistantDirectAllowed && dashboardContext.owner !== false"
              @manage="runAdsOperation" @prepare="dashboardContext.requestAssistantDraft(setupPrompt)" />
            <PaymentConfigurationPanel v-if="['stripe', 'paddle'].includes(provider?.id)" v-model="configuration"
              :integration-id="selectedId" :disabled="production || disabled" :application-public-url="dashboardContext.applicationPublicUrl"
              @set-env="openPaymentEnv" :management="paymentResult" :management-error="paymentError" :management-loading="setupCommand.isRunning" :management-operation="paymentOperation"
              :management-disabled="dirty || disabled || dashboardContext.owner === false || (production && !releaseId)"
              :can-prepare="!production && Boolean(dashboardContext.requestAssistantDraft) && dashboardContext.assistantDirectAllowed && dashboardContext.owner !== false"
              @prepare="dashboardContext.requestAssistantDraft(setupPrompt)"
              @manage="runPaymentOperation" />
            <section v-if="provider?.id === 'n8n' && !production" aria-label="n8n OAuth discovery" class="mt-4">
              <h3 class="text-title-medium">Connect with n8n OAuth</h3>
              <p>In n8n, open Settings → Instance-level MCP and enable access. Copy its full Server URL into the field above, then discover OAuth settings. This reads public metadata; it does not register a client or connect an account.</p>
              <v-btn height="48" variant="outlined" :disabled="disabled || !selected.settings?.serverUrl" :loading="discoveryCommand.isRunning" @click="discoverN8n">Discover OAuth settings</v-btn>
              <p v-if="discoveryError" role="alert">{{ discoveryError }}</p>
              <template v-if="selected.settings?.oauthDiscovery">
                <p>Discovered authority: {{ selected.settings.oauthDiscovery.oauth.issuer }}</p>
                <p v-if="selected.settings.oauthDiscovery.resource !== selected.settings.serverUrl" role="alert">The Server URL has changed. Discover its settings again before using OAuth.</p>
                <p>Choose OAuth in Authentication above, then select the permissions this application needs. Follow the OAuth setup instructions to register your client. You can also keep the API key method.</p>
                <template v-if="selected.authentication.method === 'oauth2' && (!registration?.clientId || registration.clientId === 'MISSING')">
                  <p>Set the Suggested callback URL below and choose permissions above. Registering creates one client at the displayed n8n authority, saves this configuration and stores its secret, callback and recovery client ID in development Env. Existing Env values will not be replaced. Your application must already serve the callback and connection setup command to continue into consent.</p>
                  <v-btn height="48" color="primary" :disabled="disabled || dashboardContext.owner === false || registrationNeedsReview || !callbackUrl || !selected.scopes.length || selected.settings.oauthDiscovery.resource !== selected.settings.serverUrl"
                    :loading="registrationCommand.isRunning" @click="registerOAuthClient(callbackUrl)">Register client and connect</v-btn>
                </template>
                <p v-if="registrationError" role="alert">{{ registrationError }}</p>
                <template v-if="registrationNeedsReview && !registrationCommand.isRunning">
                  <p>A failed request may still have created a client. Inspect n8n and project Env before another attempt; recover saved credentials when present.</p>
                  <v-btn height="48" variant="text" :disabled="disabled" @click="registrationNeedsReview = false">I checked n8n and Env — allow another attempt</v-btn>
                </template>
              </template>
            </section>
            <section v-if="['amplitude', 'atlassian', 'confidence-exp', 'confidence-flags', 'sanity', 'sentry', 'granola', 'hex', 'heygen'].includes(provider?.id) && selected?.authentication.method === 'oauth2' && !production && (!registration?.clientId || registration.clientId === 'MISSING')"
              :aria-label="`${provider.name} client registration`" class="mt-4">
              <p>Choose permissions above (and Region for Amplitude or workspace endpoint for Hex), then set the Suggested callback URL below. Registering creates a {{ provider.name }} OAuth client and saves its ID in configuration and its secret, callback and recovery ID in development Env. Existing Env values will not be replaced. Your application must implement the callback and setup command to complete consent.</p>
              <v-btn height="48" color="primary"
                :disabled="disabled || dashboardContext.owner === false || registrationNeedsReview || registrationCommand.isRunning || !callbackUrl || !selected.scopes.length || (provider.id === 'amplitude' && !selected.scopes.includes('mcp:read'))"
                @click="registerOAuthClient(callbackUrl)">{{ registrationCommand.isRunning ? 'Registering client…' : 'Register client and connect' }}</v-btn>
              <p v-if="registrationError" role="alert">{{ registrationError }}</p>
              <template v-if="registrationNeedsReview && !registrationCommand.isRunning">
                <p>An unsuccessful request may still have created a client. Inspect {{ provider.name }} and project Env before another attempt; recover saved credentials when present.</p>
                <v-btn height="48" variant="text" :disabled="disabled" @click="registrationNeedsReview = false">I checked {{ provider.name }} and Env — allow another attempt</v-btn>
              </template>
            </section>
            <p v-if="production">Production Env is managed on Deploy. Publish changes to apply them to the running release.</p>
            <section v-for="credential in credentials" :key="credential.label" :aria-label="credential.label" class="mt-4">
              <h3 class="text-title-medium">{{ credential.label }}</h3>
              <p>Save the credential as {{ credential.key }} in {{ environment }} Env. Your application receives it through Env.</p>
              <p v-if="credential.public">Your application may publish this key in its frontend. Use a key restricted to data those users may read.</p>
              <p v-if="dirty">Save configuration first, then enter the credential.</p>
              <v-btn height="48" variant="text" :disabled="dirty || disabled" :to="{
                path: projectAppPath(projectSlug, production ? '/dashboard/deploy' : '/dashboard/env'),
                query: { prefillKey: credential.key, prefillSecret: 'true' }
              }">{{ production ? 'Open production Env' : 'Set credential in Env' }}</v-btn>
            </section>
            <section v-if="callbackKey" aria-label="Callback setup" class="mt-4">
              <h3 class="text-title-medium">Application callback</h3>
              <template v-if="connection?.callbackUrl">
                <v-text-field :model-value="connection.callbackUrl" label="Configured callback URL" readonly persistent-hint
                  hint="Reported by your application's setup command from its current configuration." />
                <v-btn height="48" variant="text" @click="copySetupValue(connection.callbackUrl)">Copy configured callback URL</v-btn>
                <p v-if="callbackUrl && callbackUrl !== connection.callbackUrl">The proposed URL differs from the application's configured callback. To change it, update Env and the provider's allowed redirect URLs. You may need to reconnect the account after changing the callback. Existing Env values are preserved until you save a replacement.</p>
              </template>
              <v-text-field v-model="callbackUrl" label="Suggested callback URL" persistent-hint
                hint="Your application must serve this route. Register the same URL with the provider and save it in Env." />
              <p v-if="!callbackUrl">An application address is not available for this suggestion. Enter the full callback URL your application serves; do not use the editor dashboard address.</p>
              <p>This suggestion does not replace an existing Env value.</p>
              <v-btn height="48" variant="text" :disabled="!callbackUrl" @click="copySetupValue(callbackUrl)">Copy callback URL</v-btn>
              <p v-if="setupCopyMessage" role="status">{{ setupCopyMessage }}</p>
              <v-btn height="48" variant="text" :disabled="!callbackUrl" :to="{
                path: projectAppPath(projectSlug, production ? '/dashboard/deploy' : '/dashboard/env'),
                query: { prefillKey: callbackKey, prefillValue: callbackUrl }
              }">{{ production ? 'Open production Env' : 'Set callback in Env' }}</v-btn>
            </section>
            <v-expansion-panels v-if="provider?.setup" class="mt-4">
              <v-expansion-panel :title="`Set up ${provider.name}`">
                <v-expansion-panel-text>
                  <p v-if="production">For the credential and callback Env steps below, use Open production Env. Save values in the published application's environment.</p>
                  <ol class="integrations-panel__instructions">
                    <li v-for="step in (provider.setup.stepsForSettings?.(selected?.settings || {}, selected?.authentication.method) || provider.setup.stepsByAuthentication?.[selected?.authentication.method] || provider.setup.steps)" :key="step">{{ step }}</li>
                  </ol>
                  <section v-if="clientMetadata" aria-label="Client metadata document" class="mt-4">
                    <h3 class="text-title-medium">Client metadata document</h3>
                    <p>Serve this public JSON at the Client metadata URL entered above, with Content-Type application/json and no login requirement. Your application owns that endpoint.</p>
                    <v-textarea :model-value="clientMetadata.json" label="Client metadata JSON" readonly rows="10" />
                    <p v-if="clientMetadata.error" role="status">{{ clientMetadata.error }}</p>
                    <v-btn height="48" variant="text" :disabled="!clientMetadata.json" @click="copySetupValue(clientMetadata.json, 'Client metadata')">Copy client metadata</v-btn>
                    <p v-if="setupCopyMessage" role="status">{{ setupCopyMessage }}</p>
                    <p>This document uses the current name, metadata URL and suggested callback. Update the hosted document when these change, and obtain any required callback approval. Copying does not publish it or grant provider access.</p>
                  </section>
                  <section v-if="clientRegistrationEndpoint" aria-label="OAuth client registration" class="mt-4">
                    <h3 class="text-title-medium">OAuth client registration</h3>
                    <p>Before entering a Client ID, register a client for this application. In your HTTP client, create a POST request to the address below, set Content-Type to application/json, and paste the request body as raw JSON.</p>
                    <v-text-field :model-value="clientRegistrationEndpoint" label="Registration endpoint" readonly />
                    <v-btn height="48" variant="text" @click="copySetupValue(clientRegistrationEndpoint, 'Registration endpoint')">Copy registration endpoint</v-btn>
                    <p>The request uses the suggested callback above and the permissions currently selected in this form. Confirm the callback is the route your application will serve. Changing the form does not update a client already registered with the provider.</p>
                    <v-textarea :model-value="clientRegistrationBody" label="Registration request body" readonly rows="10" />
                    <p v-if="!clientRegistrationBody">Enter your application's suggested callback URL above to prepare the request.</p>
                    <v-btn height="48" variant="text" :disabled="!clientRegistrationBody" @click="copySetupValue(clientRegistrationBody, 'Registration request')">Copy registration request</v-btn>
                    <p v-if="setupCopyMessage" role="status">{{ setupCopyMessage }}</p>
                    <p>Send the request once. Copy client_id from a successful response into Client ID, then save configuration. Store client_secret in the project's Env using {{ registration.clientSecretRef }}. Store the exact registered callback using {{ registration.callbackUrlRef }}. The fields here contain Env references, not the secret itself.</p>
                    <p>Keep the response private. Missing credentials, an error response or a different returned redirect URI is not a completed registration. A timeout may leave a client created: investigate before retrying. Copying this request does not send it or connect an account; user consent happens later.</p>
                  </section>
                  <v-btn class="mt-3" height="48" :to="projectAppPath(projectSlug, production ? '/dashboard/deploy' : '/dashboard/env')" variant="text">Open Env</v-btn>
                  <v-btn height="48" :href="provider.setup.urlForSettings?.(selected?.settings || {}, selected?.authentication.method) || provider.setup.urlByAuthentication?.[selected?.authentication.method] || provider.setup.url" target="_blank" rel="noopener" variant="text">Provider setup guide</v-btn>
                </v-expansion-panel-text>
              </v-expansion-panel>
            </v-expansion-panels>
          </template>
          <template v-else><h2>{{ production ? 'Select a published integration' : 'Add a service' }}</h2><p>Choose a service or an existing configuration to get started.</p></template>
        </main>
      </div>
      <footer v-if="!production" class="integrations-panel__footer">
        <p>{{ dirty ? 'Unsaved configuration changes.' : 'Configuration matches integrations.json.' }} Account access is verified by your application when a user connects.</p>
        <div class="integrations-panel__actions">
          <v-btn height="48" variant="text" :disabled="!dirty || command.isRunning" @click="discardOpen = true">Discard</v-btn>
          <v-btn height="48" color="primary" :disabled="!dirty || disabled" @click="save">{{ command.isRunning ? 'Saving…' : 'Save configuration' }}</v-btn>
        </div>
      </footer>
    </template>
    <v-dialog v-model="discardOpen" max-width="440">
      <v-card title="Discard configuration changes?">
        <v-card-text>Your unsaved form changes will be replaced by integrations.json.</v-card-text>
        <v-card-actions><v-btn height="48" @click="discardOpen = false">Keep editing</v-btn><v-btn height="48" @click="discardOpen = false; discard()">Discard and reload</v-btn></v-card-actions>
      </v-card>
    </v-dialog>
    <v-dialog v-model="disconnectOpen" max-width="440">
      <v-card title="Disconnect this application account?">
        <v-card-text>
          <p>This removes {{ projectSlug }}'s saved {{ environment }} connection and pending consent attempts. Features using this connection will need it connected again.</p>
          <p class="mt-3">Provider permissions are not revoked. To revoke consent or an API key, use the provider's account settings; that may affect other apps using the same registration or key. Saved configuration and credentials in Env stay available.</p>
        </v-card-text>
        <v-card-actions><v-btn height="48" @click="disconnectOpen = false">Keep connection</v-btn><v-btn height="48" color="error" @click="disconnectOpen = false; runSetup('disconnect')">Disconnect account</v-btn></v-card-actions>
      </v-card>
    </v-dialog>
    <v-dialog v-model="removeOpen" max-width="440">
      <v-card title="Remove this integration?">
        <v-card-text v-if="configurationOnly">This removes the public settings when you save. Your application applies the change through its normal configuration or deployment lifecycle. It does not delete provider data or undo events already sent.</v-card-text>
        <v-card-text v-else>This changes the application's configuration when you save. Existing account grants and shared app registrations remain available.</v-card-text>
        <v-card-actions><v-btn height="48" @click="removeOpen = false">Cancel</v-btn><v-btn height="48" color="error" @click="remove">Remove integration</v-btn></v-card-actions>
      </v-card>
    </v-dialog>
  </section>
</template>

<style scoped>
.integrations-panel { display: grid; gap: 20px; min-width: 0; padding: 16px; }
.integrations-panel__header, .integrations-panel__footer, .integrations-panel__actions { display: flex; gap: 12px; align-items: center; justify-content: space-between; }
.integrations-panel__layout { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 360px), 1fr)); gap: 24px; }
.integrations-panel__detail { min-width: 0; }
.integrations-panel__catalogue { min-width: 0; }
.integrations-panel__catalogue :deep(.v-list-item) { padding-block: 12px; }
.integrations-panel__catalogue :deep(.v-list-item-title),
.integrations-panel__catalogue :deep(.v-list-item-subtitle) {
  white-space: normal;
  overflow: visible;
  overflow-wrap: anywhere;
  text-overflow: clip;
  -webkit-line-clamp: unset;
}
.integrations-panel__catalogue :deep(.v-list-item-title) { font-weight: 500; }
.integrations-panel__catalogue :deep(.v-list-item-subtitle) { margin-top: 4px; }
.integrations-panel__catalogue :deep(.v-list-item__append) { align-self: start; }
.integrations-panel__footer { border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); padding-top: 16px; flex-wrap: wrap; }
.integrations-panel__footer p { flex: 1 1 280px; }
.integrations-panel__instructions { padding-inline-start: 20px; display: grid; gap: 12px; overflow-wrap: anywhere; }
@media (max-width: 480px) { .integrations-panel { padding: 8px; } .integrations-panel__actions { width: 100%; flex-wrap: wrap; } }
</style>
