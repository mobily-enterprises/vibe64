<script setup>
import { computed, ref, toRef } from "vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate } from "vue-router";
import { IntegrationConfigurationFields } from "@jskit-ai/connectors-web/client";
import { connectorDefinitions } from "@jskit-ai/connectors-catalog/shared";
import { googleCalendarDefinition } from "@jskit-ai/connector-google-calendar/shared";
import { useVibe64Integrations } from "@/composables/useVibe64Integrations.js";
import { useVibe64ProjectSlug } from "@/composables/useVibe64ProjectScope.js";
import { projectAppPath } from "@/lib/vibe64ProjectScope.js";
import Vibe64AsyncModuleState from "@/components/common/Vibe64AsyncModuleState.vue";

const props = defineProps({ dashboardContext: { type: Object, required: true } });
const { configuration, dirty, resource, command, fieldErrors, error, changedElsewhere, save, discard } =
  useVibe64Integrations(toRef(props, "dashboardContext"));
const projectSlug = useVibe64ProjectSlug();
const selectedId = ref("");
const search = ref("");
const discardOpen = ref(false);
const removeOpen = ref(false);
const providers = [googleCalendarDefinition, ...connectorDefinitions];
const filteredProviders = computed(() => providers.filter((provider) =>
  `${provider.name} ${provider.description}`.toLowerCase().includes(String(search.value || "").toLowerCase())
));
const entries = computed(() => Object.entries(configuration.value?.integrations || {}));
const selected = computed(() => configuration.value?.integrations[selectedId.value]);
const provider = computed(() => providers.find((entry) => entry.id === selected.value?.provider));
const disabled = computed(() => command.isRunning || props.dashboardContext.sourceOperationsSuspended === true || changedElsewhere.value);
const loadError = computed(() => resource.loadError.value || (resource.data.value?.ok === false ? resource.data.value.error : ""));

function add(provider) {
  const current = configuration.value;
  let id = provider.id;
  let suffix = 2;
  while (current.integrations[id] || current.registrations[id]) id = `${provider.id}-${suffix++}`;
  const prefix = id.toUpperCase().replaceAll("-", "_");
  const usesApiKey = provider.authenticationMethods[0] === "api-key";
  const clientAuthentication = provider.oauthClientAuthenticationMethods?.[0] || "client_secret_post";
  configuration.value = {
    ...current,
    integrations: { ...current.integrations, [id]: {
      provider: provider.id, displayName: provider.name, accountMode: provider.accountModes[0],
      scopes: provider.scopes.filter((scope) => scope.recommended).map((scope) => scope.value),
      authentication: usesApiKey
        ? { method: "api-key", ...(provider.apiKeySecretOptional ? {} : { secretRef: `env:${prefix}_API_KEY` }) }
        : { method: "oauth2", registrationRef: id }
    } },
    registrations: usesApiKey ? current.registrations : { ...current.registrations, [id]: {
      source: "own", clientId: "", callbackUrlRef: `env:${prefix}_CALLBACK_URL`,
      ...(clientAuthentication !== "client_secret_post" ? { tokenEndpointAuthMethod: clientAuthentication } : {}),
      ...(clientAuthentication !== "none" ? { clientSecretRef: `env:${prefix}_CLIENT_SECRET` } : {})
    } }
  };
  selectedId.value = id;
}

function remove() {
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

onBeforeRouteLeave(() => !dirty.value || window.confirm("Leave Integrations and discard unsaved configuration changes?"));
onBeforeRouteUpdate(() => !dirty.value || window.confirm("Switch session and discard unsaved configuration changes?"));
</script>

<template>
  <section class="integrations-panel">
    <header class="integrations-panel__header">
      <div><h1>Integrations</h1><p>Connect services to your application.</p></div>
      <v-btn height="48" variant="text" :disabled="command.isRunning" @click="dirty ? discardOpen = true : resource.reload()">Refresh</v-btn>
    </header>
    <p v-if="!dashboardContext.sessionId">Open a session to configure its integrations.</p>
    <Vibe64AsyncModuleState
      v-else-if="resource.isInitialLoading.value || loadError"
      label="Integrations" :loading="resource.isInitialLoading.value" :message="loadError || 'Loading integrations.'"
      @retry="resource.reload()" @reload="resource.reload()"
    />
    <template v-else-if="configuration">
      <v-alert v-if="changedElsewhere" type="warning" variant="tonal">This configuration changed outside this form. Your draft is preserved. Reload before saving.</v-alert>
      <v-alert v-if="error" role="alert" type="error" variant="tonal">{{ error }}</v-alert>
      <div class="integrations-panel__layout">
        <aside aria-label="Integrations catalogue">
          <v-text-field v-model="search" label="Search integrations" hide-details clearable @click:clear="search = ''" />
          <h2 class="text-title-medium mt-6 mb-2">Configured in this session</h2>
          <v-list v-if="entries.length" aria-label="Configured integrations" bg-color="transparent">
            <v-list-item
              v-for="[id, entry] in entries" :key="id" :active="selectedId === id" min-height="48"
              :title="entry.displayName || entry.provider" :subtitle="id" @click="selectedId = id"
            />
          </v-list>
          <p v-else class="text-body-medium">No integrations configured yet.</p>
          <h2 class="text-title-medium mt-6 mb-2">Available services</h2>
          <v-list bg-color="transparent">
            <v-list-item v-for="entry in filteredProviders" :key="entry.id" :title="entry.name" :subtitle="entry.description">
              <template #append><v-btn :aria-label="`Add ${entry.name}`" height="48" variant="text" :disabled="disabled" @click="add(entry)">Add</v-btn></template>
            </v-list-item>
          </v-list>
        </aside>
        <main class="integrations-panel__detail">
          <template v-if="selected">
            <header class="integrations-panel__header mb-4">
              <div><h2>{{ selected.displayName || selected.provider }}</h2><p>Application configuration</p></div>
              <v-btn height="48" variant="text" color="error" :disabled="disabled" @click="removeOpen = true">Remove</v-btn>
            </header>
            <IntegrationConfigurationFields
              v-if="provider" v-model="configuration" :integration-id="selectedId"
              :provider="provider" :field-errors="fieldErrors" :disabled="disabled"
            />
            <p v-else>This provider's configuration is preserved. Edit its configuration in Files.</p>
            <v-expansion-panels v-if="provider?.setup" class="mt-4">
              <v-expansion-panel :title="`Set up ${provider.name}`">
                <v-expansion-panel-text>
                  <ol class="integrations-panel__instructions">
                    <li v-for="step in provider.setup.steps" :key="step">{{ step }}</li>
                  </ol>
                  <v-btn class="mt-3" height="48" :to="projectAppPath(projectSlug, '/dashboard/env')" variant="text">Open Env</v-btn>
                  <v-btn height="48" :href="provider.setup.url" target="_blank" rel="noopener" variant="text">Provider setup guide</v-btn>
                </v-expansion-panel-text>
              </v-expansion-panel>
            </v-expansion-panels>
          </template>
          <template v-else><h2>Add a service</h2><p>Choose a service or an existing configuration to get started.</p></template>
        </main>
      </div>
      <footer class="integrations-panel__footer">
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
    <v-dialog v-model="removeOpen" max-width="440">
      <v-card title="Remove this integration?">
        <v-card-text>This changes the application's configuration when you save. Existing account grants and shared app registrations remain available.</v-card-text>
        <v-card-actions><v-btn height="48" @click="removeOpen = false">Cancel</v-btn><v-btn height="48" color="error" @click="remove">Remove integration</v-btn></v-card-actions>
      </v-card>
    </v-dialog>
  </section>
</template>

<style scoped>
.integrations-panel { display: grid; gap: 20px; min-width: 0; padding: 16px; }
.integrations-panel__header, .integrations-panel__footer, .integrations-panel__actions { display: flex; gap: 12px; align-items: center; justify-content: space-between; }
.integrations-panel__layout { display: grid; grid-template-columns: minmax(220px, 1fr) minmax(0, 2fr); gap: 24px; }
.integrations-panel__detail { min-width: 0; }
.integrations-panel__footer { border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); padding-top: 16px; flex-wrap: wrap; }
.integrations-panel__footer p { flex: 1 1 280px; }
.integrations-panel__instructions { padding-inline-start: 20px; display: grid; gap: 12px; }
@media (max-width: 900px) { .integrations-panel__layout { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 480px) { .integrations-panel { padding: 8px; } .integrations-panel__actions { width: 100%; flex-wrap: wrap; } }
</style>
