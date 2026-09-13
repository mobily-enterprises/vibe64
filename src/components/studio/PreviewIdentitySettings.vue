<template>
  <section class="preview-identity-settings">
    <header class="preview-identity-settings__header">
      <div>
        <h1 class="text-headline-small font-weight-bold ma-0">Managed app access</h1>
        <p>
          Named existing application accounts for authenticated Preview and Playwright.
          The first identity is the default.
        </p>
      </div>
      <div class="preview-identity-settings__header-actions">
        <v-btn
          :disabled="loading || saving"
          size="small"
          type="button"
          variant="tonal"
          @click="refresh"
        >
          {{ loading ? "Refreshing…" : "Refresh" }}
        </v-btn>
        <v-btn
          color="primary"
          :disabled="!changed || loading || saving"
          size="small"
          type="button"
          variant="flat"
          @click="save"
        >
          {{ saving ? "Saving…" : "Save" }}
        </v-btn>
      </div>
    </header>

    <Vibe64AsyncModuleState
      v-if="loading || loadError"
      label="Managed app access"
      :loading="loading"
      :message="loadError || 'Loading managed app identities.'"
      min-height="12rem"
      @reload="reloadPage"
      @retry="refresh"
    />

    <template v-else>
      <section class="preview-identity-settings__section">
        <div class="preview-identity-settings__section-copy">
          <h2>Managed app identities</h2>
          <p>
            Saved in <code>.vibe64/preview-identities.json</code> in the active project
            source, so they follow the repository. These are application identifiers,
            not passwords or authentication secrets.
          </p>
        </div>

        <div class="preview-identity-settings__list">
          <div
            v-for="(identity, index) in identities"
            :key="index"
            class="preview-identity-settings__identity"
          >
            <div class="preview-identity-settings__fields">
              <v-text-field
                v-model="identity.name"
                autocomplete="off"
                density="compact"
                label="Name"
                placeholder="admin"
                variant="outlined"
              />
              <v-select
                v-model="identity.type"
                density="compact"
                item-title="label"
                item-value="value"
                :items="identityTypes"
                label="App identifier"
                variant="outlined"
              />
              <v-text-field
                v-model="identity.value"
                autocomplete="off"
                density="compact"
                label="Application value"
                :placeholder="identityPlaceholder(identity.type)"
                :type="identity.type === 'email' ? 'email' : 'text'"
                variant="outlined"
              />
            </div>
            <div class="preview-identity-settings__identity-actions">
              <v-chip
                v-if="index === 0"
                color="primary"
                size="small"
                variant="tonal"
              >
                Default
              </v-chip>
              <v-btn
                v-else
                size="small"
                type="button"
                variant="text"
                @click="makeDefault(index)"
              >
                Make default
              </v-btn>
              <v-btn
                color="error"
                size="small"
                type="button"
                variant="text"
                @click="removeIdentity(index)"
              >
                Remove
              </v-btn>
            </div>
          </div>

          <p v-if="identities.length === 0" class="preview-identity-settings__empty">
            No managed app identities are configured. Preview remains available as a guest
            when the application supports it.
          </p>

          <v-btn
            class="preview-identity-settings__add"
            size="small"
            type="button"
            variant="outlined"
            @click="addIdentity"
          >
            Add identity
          </v-btn>
        </div>
      </section>
    </template>
  </section>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import Vibe64AsyncModuleState from "@/components/common/Vibe64AsyncModuleState.vue";
import {
  useVibe64ProjectSlug
} from "@/composables/useVibe64ProjectScope.js";
import {
  useVibe64SessionSelection
} from "@/composables/useVibe64SessionSelection.js";
import {
  PREVIEW_IDENTITIES_ENDPOINT,
  VIBE64_PREVIEW_IDENTITIES_API_SUFFIX,
  VIBE64_PROJECT_CHANGED_EVENT,
  previewIdentitiesQueryKey
} from "@/lib/studioGateApi.js";
import {
  VIBE64_SURFACE_ID
} from "@/lib/vibe64RequestConfig.js";

const identityTypes = Object.freeze([
  {
    label: "Email",
    value: "email"
  },
  {
    label: "Login name",
    value: "login"
  },
  {
    label: "User ID",
    value: "user-id"
  }
]);

const projectSlug = useVibe64ProjectSlug();
const sessionSelection = useVibe64SessionSelection({
  projectSlug
});
const selectedSessionId = sessionSelection.selectedId;
const identities = ref([]);
const savedIdentities = ref([]);

const resource = useEndpointResource({
  fallbackLoadError: "Managed app identities could not load.",
  path: PREVIEW_IDENTITIES_ENDPOINT,
  queryKey: computed(() => [
    ...previewIdentitiesQueryKey(
      VIBE64_SURFACE_ID,
      ROUTE_VISIBILITY_PUBLIC,
      projectSlug.value
    ),
    selectedSessionId.value || "baseline"
  ]),
  readQuery: computed(() => (
    selectedSessionId.value ? { sessionId: selectedSessionId.value } : {}
  )),
  realtime: {
    event: VIBE64_PROJECT_CHANGED_EVENT
  },
  refreshOnPull: true,
  requestRecoveryLabel: "Managed app access"
});

const saveCommand = useCommand({
  access: "never",
  apiSuffix: VIBE64_PREVIEW_IDENTITIES_API_SUFFIX,
  buildCommandOptions: () => ({
    method: "PUT",
    path: PREVIEW_IDENTITIES_ENDPOINT
  }),
  buildRawPayload: (_model, { context }) => ({
    identities: context.identities,
    ...(selectedSessionId.value ? { sessionId: selectedSessionId.value } : {})
  }),
  fallbackRunError: "Managed app identities could not be saved.",
  messages: {
    error: "Managed app identities could not be saved.",
    success: "Managed app identities saved."
  },
  ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
  placementSource: "vibe64.preview-identities.save",
  surfaceId: VIBE64_SURFACE_ID,
  writeMethod: "PUT"
});

const loading = computed(() => resource.isLoading.value === true);
const loadError = computed(() => String(resource.loadError.value || ""));
const saving = computed(() => saveCommand.isRunning === true);
const changed = computed(() => (
  JSON.stringify(identities.value) !== JSON.stringify(savedIdentities.value)
));

watch(() => resource.data.value?.identities, (value) => {
  const next = cloneIdentities(value);
  identities.value = next;
  savedIdentities.value = cloneIdentities(next);
}, {
  immediate: true
});

function cloneIdentities(value = []) {
  return (Array.isArray(value) ? value : []).map((identity) => ({
    name: String(identity?.name || ""),
    type: String(identity?.type || ""),
    value: String(identity?.value || "")
  }));
}

function identityPlaceholder(type = "") {
  return {
    email: "admin@example.com",
    login: "admin",
    "user-id": "42"
  }[String(type || "")] || "Application identifier";
}

function addIdentity() {
  identities.value.push({
    name: "",
    type: "email",
    value: ""
  });
}

function removeIdentity(index = -1) {
  identities.value.splice(index, 1);
}

function makeDefault(index = -1) {
  if (index <= 0 || index >= identities.value.length) {
    return;
  }
  identities.value.unshift(identities.value.splice(index, 1)[0]);
}

async function refresh() {
  await resource.reload();
}

async function save() {
  await saveCommand.run({
    identities: cloneIdentities(identities.value)
  });
  await resource.reload();
}

function reloadPage() {
  if (typeof window !== "undefined") {
    window.location.reload();
  }
}
</script>

<style scoped>
.preview-identity-settings {
  display: grid;
  gap: 1rem;
  min-width: 0;
}

.preview-identity-settings__header,
.preview-identity-settings__identity-actions {
  align-items: center;
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
}

.preview-identity-settings__header h1,
.preview-identity-settings__header p,
.preview-identity-settings__section-copy h2,
.preview-identity-settings__section-copy p,
.preview-identity-settings__empty {
  margin: 0;
}

.preview-identity-settings__header p,
.preview-identity-settings__section-copy p,
.preview-identity-settings__empty {
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.86rem;
  line-height: 1.4;
}

.preview-identity-settings__header-actions {
  display: flex;
  gap: 0.5rem;
}

.preview-identity-settings__section {
  border-top: 1px solid rgba(var(--v-theme-outline), 0.18);
  display: grid;
  gap: 1rem;
  grid-template-columns: minmax(14rem, 0.7fr) minmax(0, 1.3fr);
  padding-top: 1rem;
}

.preview-identity-settings__section-copy,
.preview-identity-settings__list,
.preview-identity-settings__identity {
  display: grid;
  gap: 0.6rem;
  min-width: 0;
}

.preview-identity-settings__section-copy h2 {
  font-size: 1rem;
  font-weight: 700;
}

.preview-identity-settings__identity {
  border-bottom: 1px solid rgba(var(--v-theme-outline), 0.16);
  padding-bottom: 0.65rem;
}

.preview-identity-settings__fields {
  display: grid;
  gap: 0.5rem;
  grid-template-columns: minmax(0, 0.65fr) minmax(0, 0.8fr) minmax(0, 1.25fr);
}

.preview-identity-settings__identity-actions {
  justify-content: flex-end;
}

.preview-identity-settings__add {
  justify-self: start;
}

@media (max-width: 820px) {
  .preview-identity-settings__header,
  .preview-identity-settings__section {
    align-items: stretch;
    grid-template-columns: 1fr;
  }

  .preview-identity-settings__header {
    display: grid;
  }

  .preview-identity-settings__fields {
    grid-template-columns: 1fr;
  }
}
</style>
