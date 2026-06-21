<template>
  <section class="managed-app-auth-setup">
    <header class="managed-app-auth-setup__header">
      <div>
        <p class="managed-app-auth-setup__kicker">Managed Supabase login</p>
        <h2>{{ title }}</h2>
        <p class="managed-app-auth-setup__lede">{{ lede }}</p>
      </div>
      <div class="managed-app-auth-setup__header-actions">
        <v-chip
          :color="statusColor"
          variant="tonal"
        >
          {{ statusLabel }}
        </v-chip>
        <v-btn
          :disabled="!actionsEnabled || appAuth.isLoading"
          :loading="appAuth.isLoading"
          :prepend-icon="mdiRefresh"
          type="button"
          variant="outlined"
          @click="refreshStatus"
        >
          Refresh
        </v-btn>
      </div>
    </header>

    <v-progress-linear
      v-if="busy"
      color="primary"
      height="6"
      indeterminate
      rounded
    />

    <v-alert
      v-if="actionsDisabledMessage && !actionsEnabled"
      border="start"
      density="comfortable"
      type="info"
      variant="tonal"
    >
      {{ actionsDisabledMessage }}
    </v-alert>
    <v-alert
      v-if="appAuth.loadError"
      border="start"
      density="comfortable"
      type="error"
      variant="tonal"
    >
      {{ appAuth.loadError }}
    </v-alert>
    <v-alert
      v-if="globalMessage"
      border="start"
      density="comfortable"
      :type="globalMessageType"
      variant="tonal"
    >
      {{ globalMessage }}
    </v-alert>

    <section
      v-if="readyOverviewVisible"
      class="managed-app-auth-ready"
      aria-label="Managed app login ready"
    >
      <div class="managed-app-auth-ready__hero">
        <v-icon
          color="success"
          :icon="mdiShieldCheckOutline"
          size="34"
        />
        <div>
          <h3>Managed app login is ready</h3>
          <p>Generated JSKIT apps can use the shared development and production Supabase Auth projects.</p>
        </div>
      </div>

      <div class="managed-app-auth-ready__projects">
        <article
          v-for="project in projectRows"
          :key="project.environment"
          class="managed-app-auth-ready__project"
        >
          <div>
            <p class="managed-app-auth-setup__project-env">{{ project.environmentLabel }}</p>
            <h4>{{ project.name }}</h4>
            <p>{{ project.url || "Project URL not available" }}</p>
          </div>
          <v-chip
            :color="project.publishableKeyPresent ? 'success' : 'warning'"
            size="small"
            variant="tonal"
          >
            {{ project.publishableKeyPresent ? "Key ready" : "Key missing" }}
          </v-chip>
        </article>
      </div>

      <div class="managed-app-auth-ready__meta">
        <span>Organization</span>
        <strong>{{ organizationLabel || "Selected" }}</strong>
      </div>

      <div class="managed-app-auth-ready__actions">
        <v-btn
          :disabled="!actionsEnabled || syncBusy"
          :loading="syncBusy"
          :prepend-icon="mdiSync"
          type="button"
          variant="outlined"
          @click="syncManagedAuth"
        >
          Sync Supabase settings
        </v-btn>
        <v-menu v-if="actionsEnabled">
          <template #activator="{ props: menuProps }">
            <v-btn
              v-bind="menuProps"
              :append-icon="mdiChevronDown"
              type="button"
              variant="tonal"
            >
              Manage
            </v-btn>
          </template>
          <v-list density="compact">
            <v-list-item @click="detailsVisible = !detailsVisible">
              <v-list-item-title>{{ detailsVisible ? "Hide details" : "Show details" }}</v-list-item-title>
            </v-list-item>
            <v-list-item @click="openWizard('projects')">
              <v-list-item-title>Repair projects</v-list-item-title>
            </v-list-item>
            <v-list-item @click="replaceToken">
              <v-list-item-title>Replace token</v-list-item-title>
            </v-list-item>
            <v-list-item @click="disconnectManagedAuth">
              <v-list-item-title>Remove token</v-list-item-title>
            </v-list-item>
          </v-list>
        </v-menu>
      </div>
      <p class="managed-app-auth-ready__sync">{{ syncStatusText }}</p>
    </section>

    <section
      v-else
      class="managed-app-auth-wizard"
      aria-label="Managed Supabase setup wizard"
    >
      <nav class="managed-app-auth-wizard__nav" aria-label="Setup steps">
        <button
          v-for="step in stepItems"
          :key="step.id"
          :class="[
            'managed-app-auth-wizard__nav-item',
            activeStep === step.id ? 'managed-app-auth-wizard__nav-item--active' : '',
            `managed-app-auth-wizard__nav-item--${step.state}`
          ]"
          :disabled="step.state === 'pending'"
          type="button"
          @click="activeStep = step.id"
        >
          <span>{{ step.index }}</span>
          <strong>{{ step.label }}</strong>
          <em>{{ step.status }}</em>
        </button>
      </nav>

      <article class="managed-app-auth-wizard__panel">
        <template v-if="activeStep === 'token'">
          <h3>{{ tokenReady ? "Token connected" : "Connect Supabase token" }}</h3>
          <template v-if="tokenReady">
            <p>The Supabase token is stored locally. Replace it only if it was revoked or belongs to the wrong account.</p>
            <div class="managed-app-auth-wizard__actions">
              <v-btn
                :disabled="!actionsEnabled"
                type="button"
                variant="tonal"
                @click="replaceToken"
              >
                Replace token
              </v-btn>
              <v-btn
                color="warning"
                :disabled="!actionsEnabled || disconnectBusy"
                :loading="disconnectBusy"
                type="button"
                variant="tonal"
                @click="disconnectManagedAuth"
              >
                Remove token
              </v-btn>
            </div>
          </template>
          <template v-else>
            <p>Paste a Supabase Personal Access Token. Vibe64 validates it and loads the organizations it can manage.</p>
            <div class="managed-app-auth-wizard__field-row">
              <v-text-field
                v-model="form.accessToken"
                autocomplete="off"
                :disabled="!actionsEnabled || connectBusy"
                :error-messages="tokenErrorMessages"
                hide-details="auto"
                label="Supabase Personal Access Token"
                type="password"
                variant="outlined"
              />
              <v-btn
                :append-icon="mdiOpenInNew"
                :disabled="!actionsEnabled"
                :href="SUPABASE_PAT_URL"
                rel="noreferrer"
                target="_blank"
                type="button"
                variant="tonal"
              >
                Create token
              </v-btn>
            </div>
            <v-alert
              border="start"
              density="compact"
              type="info"
              variant="tonal"
            >
              The token must allow organization listing, project creation, API key reads, and Auth redirect updates. It is stored locally as a provider credential, not in the app repo.
            </v-alert>
            <div class="managed-app-auth-wizard__actions">
              <v-btn
                color="primary"
                :disabled="!canConnectToken"
                :loading="connectBusy"
                :prepend-icon="mdiKeyOutline"
                type="button"
                variant="flat"
                @click="connectToken"
              >
                Connect token
              </v-btn>
            </div>
          </template>
        </template>

        <template v-else-if="activeStep === 'organization'">
          <h3>{{ organizationReady ? "Organization selected" : "Choose organization" }}</h3>
          <p v-if="!tokenReady">Connect the token first. Then Vibe64 can show the organizations available to that token.</p>
          <template v-else-if="organizationItems.length > 1">
            <p>Select the Supabase organization that should own the managed development and production Auth projects.</p>
            <v-select
              v-model="form.organizationSlug"
              :disabled="!actionsEnabled"
              :error-messages="organizationErrorMessages"
              item-title="label"
              item-value="value"
              :items="organizationItems"
              label="Supabase organization"
              variant="outlined"
            />
          </template>
          <template v-else-if="organizationReady">
            <p class="managed-app-auth-wizard__selected-value">{{ organizationLabel }}</p>
            <p>Vibe64 will create or repair managed Auth projects in this organization.</p>
          </template>
          <template v-else>
            <p>Vibe64 could not find an organization for this token. Enter the Supabase organization slug only if you already know it.</p>
            <v-text-field
              v-model="form.organizationSlug"
              :disabled="!actionsEnabled"
              label="Organization slug"
              variant="outlined"
            />
          </template>
        </template>

        <template v-else-if="activeStep === 'projects'">
          <h3>{{ projectsReady ? "Projects are ready" : "Create managed projects" }}</h3>
          <p>{{ projectStepMessage }}</p>
          <v-select
            v-if="!projectsReady"
            v-model="form.regionGroup"
            :disabled="!actionsEnabled || setupBusy"
            hide-details="auto"
            item-title="label"
            item-value="value"
            :items="regionGroupItems"
            label="Region group for new projects"
            variant="outlined"
          />
          <div class="managed-app-auth-wizard__actions">
            <v-btn
              color="primary"
              :disabled="!canProvisionProjects"
              :loading="setupBusy"
              :prepend-icon="mdiCloudOutline"
              type="button"
              :variant="projectsReady ? 'tonal' : 'flat'"
              @click="provisionProjects"
            >
              {{ projectActionLabel }}
            </v-btn>
            <v-btn
              v-if="projectsReady"
              :disabled="setupBusy"
              type="button"
              variant="tonal"
              @click="finishWizard"
            >
              Done
            </v-btn>
          </div>
        </template>

        <template v-else>
          <h3>Sync Supabase settings</h3>
          <p>{{ syncStatusText }}</p>
          <div class="managed-app-auth-wizard__actions">
            <v-btn
              color="primary"
              :disabled="!actionsEnabled || syncBusy || !projectsReady"
              :loading="syncBusy"
              :prepend-icon="mdiSync"
              type="button"
              variant="flat"
              @click="syncManagedAuth"
            >
              Sync now
            </v-btn>
            <v-btn
              :disabled="syncBusy"
              type="button"
              variant="tonal"
              @click="finishWizard"
            >
              Done
            </v-btn>
          </div>
        </template>
      </article>
    </section>

    <section
      v-if="detailsVisible"
      class="managed-app-auth-setup__details"
      aria-label="Managed app login project details"
    >
      <header>
        <h3>Project details</h3>
        <p>These values are diagnostic. Generated apps receive only the login project they are configured to use.</p>
      </header>
      <div class="managed-app-auth-setup__project-list">
        <article
          v-for="project in projectRows"
          :key="project.environment"
          class="managed-app-auth-setup__project"
        >
          <div class="managed-app-auth-setup__project-heading">
            <div>
              <p class="managed-app-auth-setup__project-env">{{ project.environmentLabel }}</p>
              <h4>{{ project.name }}</h4>
            </div>
            <v-chip
              :color="project.publishableKeyPresent && tokenReady ? 'success' : 'warning'"
              size="small"
              variant="tonal"
            >
              {{ projectKeyLabel(project) }}
            </v-chip>
          </div>
          <dl class="managed-app-auth-setup__project-facts">
            <div>
              <dt>Ref</dt>
              <dd>{{ project.ref || "Not created" }}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{{ project.status || "Unknown" }}</dd>
            </div>
            <div>
              <dt>URL</dt>
              <dd>
                <a
                  v-if="project.url"
                  :href="project.url"
                  rel="noreferrer"
                  target="_blank"
                >
                  {{ project.url }}
                </a>
                <span v-else>Not available yet</span>
              </dd>
            </div>
          </dl>
        </article>
      </div>
    </section>
  </section>
</template>

<script setup>
import { computed, reactive, ref, watch } from "vue";
import {
  mdiChevronDown,
  mdiCloudOutline,
  mdiKeyOutline,
  mdiOpenInNew,
  mdiRefresh,
  mdiShieldCheckOutline,
  mdiSync
} from "@mdi/js";

const props = defineProps({
  actionsDisabledMessage: {
    type: String,
    default: ""
  },
  actionsEnabled: {
    type: Boolean,
    default: true
  },
  appAuth: {
    type: Object,
    required: true
  },
  lede: {
    type: String,
    default: "Create and maintain the shared dev/prod Supabase Auth projects that JSKIT apps can use for login."
  },
  title: {
    type: String,
    default: "Managed App Login"
  }
});

const appAuth = props.appAuth;
const SUPABASE_PAT_URL = "https://supabase.com/dashboard/account/tokens";
const FIELD_ERROR_CODES = new Set([
  "vibe64_supabase_organization_required",
  "vibe64_supabase_pat_invalid",
  "vibe64_supabase_pat_required"
]);
const form = reactive({
  accessToken: "",
  organizationSlug: "",
  regionGroup: "americas"
});
const activeStep = ref("token");
const detailsVisible = ref(false);
const lastOrganizations = ref([]);
const lastSync = ref(null);
const operationCode = ref("");
const operationMessage = ref("");
const replacingToken = ref(false);
const wizardForcedOpen = ref(false);

const regionGroupItems = Object.freeze([
  {
    label: "Americas",
    value: "americas"
  },
  {
    label: "Europe / Middle East / Africa",
    value: "emea"
  },
  {
    label: "Asia Pacific",
    value: "apac"
  }
]);

const status = computed(() => appAuth.status || null);
const connectBusy = computed(() => appAuth.connectCommand?.isRunning === true);
const setupBusy = computed(() => appAuth.setupCommand?.isRunning === true);
const syncBusy = computed(() => appAuth.syncCommand?.isRunning === true);
const disconnectBusy = computed(() => appAuth.disconnectCommand?.isRunning === true);
const busy = computed(() => connectBusy.value || setupBusy.value || syncBusy.value || disconnectBusy.value || (appAuth.isLoading && !status.value));
const tokenReady = computed(() => status.value?.tokenPresent === true && !replacingToken.value);
const projectsReady = computed(() => status.value?.ready === true && tokenReady.value);
const readyOverviewVisible = computed(() => projectsReady.value && !wizardForcedOpen.value && !replacingToken.value);
const organizationItems = computed(() => {
  return (lastOrganizations.value.length ? lastOrganizations.value : status.value?.organizations || [])
    .map((organization) => ({
      label: organization.name ? `${organization.name} (${organization.slug})` : organization.slug,
      value: organization.slug
    }));
});
const organizationReady = computed(() => tokenReady.value && Boolean(form.organizationSlug || status.value?.organizationSlug));
const organizationLabel = computed(() => {
  const slug = form.organizationSlug || status.value?.organizationSlug || "";
  return organizationItems.value.find((item) => item.value === slug)?.label || slug;
});
const canConnectToken = computed(() => {
  return props.actionsEnabled &&
    !connectBusy.value &&
    form.accessToken.trim().length > 0;
});
const canProvisionProjects = computed(() => {
  return props.actionsEnabled &&
    !setupBusy.value &&
    tokenReady.value &&
    organizationReady.value;
});
const projectRows = computed(() => {
  const projects = status.value?.projects || {};
  return ["dev", "prod"].map((environment) => {
    const project = projects[environment] || {};
    return {
      environment,
      environmentLabel: environment === "prod" ? "Production" : "Development",
      keyType: project.keyType || "",
      name: project.name || `Vibe64 Auth ${environment === "prod" ? "Prod" : "Dev"}`,
      publishableKeyPresent: project.publishableKeyPresent === true,
      ref: project.ref || "",
      status: project.status || "",
      url: project.url || ""
    };
  });
});
const statusLabel = computed(() => {
  if (busy.value && !status.value) {
    return "Checking";
  }
  if (projectsReady.value) {
    return "Ready";
  }
  if (tokenReady.value) {
    return "Setup needed";
  }
  return "Not connected";
});
const statusColor = computed(() => {
  if (busy.value && !status.value) {
    return "primary";
  }
  if (projectsReady.value) {
    return "success";
  }
  return tokenReady.value ? "warning" : "error";
});
const projectStepState = computed(() => {
  if (projectsReady.value) {
    return "ready";
  }
  return tokenReady.value && organizationReady.value ? "active" : "pending";
});
const projectStepMessage = computed(() => {
  if (!tokenReady.value) {
    return "Connect the Supabase token first.";
  }
  if (!organizationReady.value) {
    return "Choose the Supabase organization first.";
  }
  if (projectsReady.value) {
    return "The managed projects have publishable keys. Run repair only if Supabase changed or a key went missing.";
  }
  return "Create or repair the Vibe64 Auth Dev and Vibe64 Auth Prod projects.";
});
const projectActionLabel = computed(() => projectsReady.value ? "Repair managed projects" : "Create dev and prod projects");
const syncStatusText = computed(() => {
  if (!projectsReady.value) {
    return "Available after the managed projects are ready.";
  }
  if (lastSync.value?.syncError?.message) {
    return `Last sync failed: ${lastSync.value.syncError.message}`;
  }
  if (lastSync.value?.sync?.syncedAt) {
    const count = Array.isArray(lastSync.value.sync.redirectUrls) ? lastSync.value.sync.redirectUrls.length : 0;
    const smtpSynced = lastSync.value.sync.smtpConfigured === true;
    if (count > 0 && smtpSynced) {
      return `Last sync updated ${count} redirect URL${count === 1 ? "" : "s"} and SMTP settings.`;
    }
    if (smtpSynced) {
      return "Last sync updated SMTP settings.";
    }
    return count > 0
      ? `Last sync updated ${count} redirect URL${count === 1 ? "" : "s"}.`
      : "Last sync found no Supabase settings to update.";
  }
  return "Sync redirect URLs and the saved SMTP login into Supabase Auth.";
});
const stepItems = computed(() => [
  {
    id: "token",
    index: "1",
    label: "Connect token",
    state: tokenReady.value ? "ready" : "active",
    status: tokenReady.value ? "Done" : "Needed"
  },
  {
    id: "organization",
    index: "2",
    label: "Choose organization",
    state: !tokenReady.value ? "pending" : organizationReady.value ? "ready" : "active",
    status: !tokenReady.value ? "Waiting" : organizationReady.value ? "Done" : "Needed"
  },
  {
    id: "projects",
    index: "3",
    label: "Create projects",
    state: projectStepState.value,
    status: projectsReady.value ? "Done" : projectStepState.value === "active" ? "Ready" : "Blocked"
  },
  {
    id: "sync",
    index: "4",
    label: "Sync settings",
    state: projectsReady.value ? "available" : "pending",
    status: projectsReady.value ? "Optional" : "Waiting"
  }
]);
const globalMessage = computed(() => FIELD_ERROR_CODES.has(operationCode.value) ? "" : operationMessage.value);
const globalMessageType = computed(() => operationCode.value ? "error" : "info");
const tokenErrorMessages = computed(() => [
  "vibe64_supabase_pat_required",
  "vibe64_supabase_pat_invalid"
].includes(operationCode.value) ? operationMessage.value : "");
const organizationErrorMessages = computed(() => {
  return operationCode.value === "vibe64_supabase_organization_required"
    ? operationMessage.value
    : "";
});

watch(
  () => status.value,
  (nextStatus) => {
    if (!nextStatus) {
      return;
    }
    form.regionGroup = nextStatus.regionGroup || form.regionGroup || "americas";
    if (!form.organizationSlug && nextStatus.organizationSlug) {
      form.organizationSlug = nextStatus.organizationSlug;
    }
    if (Array.isArray(nextStatus.organizations) && nextStatus.organizations.length) {
      lastOrganizations.value = nextStatus.organizations;
    }
  },
  {
    immediate: true
  }
);

watch(
  organizationItems,
  (items) => {
    if (!form.organizationSlug && items.length === 1) {
      form.organizationSlug = items[0].value;
    }
  },
  {
    immediate: true
  }
);

watch(
  [tokenReady, organizationReady, projectsReady],
  () => {
    if (!tokenReady.value) {
      activeStep.value = "token";
      return;
    }
    if (!organizationReady.value) {
      activeStep.value = "organization";
      return;
    }
    if (!projectsReady.value) {
      activeStep.value = "projects";
    }
  },
  {
    immediate: true
  }
);

function clearOperationMessage() {
  operationCode.value = "";
  operationMessage.value = "";
}

function resultError(result = {}) {
  return Array.isArray(result.errors) ? result.errors[0] : null;
}

function resultMessage(result = {}, fallback = "Managed app login request failed.") {
  const error = resultError(result);
  if (error?.code === "vibe64_supabase_organization_required") {
    return "Choose the Supabase organization that should own the Vibe64 Auth Dev and Prod projects.";
  }
  return error?.message || result.error || fallback;
}

function rememberOrganizations(result = {}) {
  if (Array.isArray(result.organizations)) {
    lastOrganizations.value = result.organizations;
  }
  if (!form.organizationSlug && result.organizationSlug) {
    form.organizationSlug = result.organizationSlug;
  }
}

function setOperationError(result = {}, fallback = "Managed app login request failed.") {
  const error = resultError(result);
  operationCode.value = error?.code || result.code || "";
  operationMessage.value = resultMessage(result, fallback);
}

function openWizard(step = "token") {
  if (!props.actionsEnabled) {
    return;
  }
  wizardForcedOpen.value = true;
  detailsVisible.value = false;
  activeStep.value = step;
}

function replaceToken() {
  if (!props.actionsEnabled) {
    return;
  }
  wizardForcedOpen.value = true;
  replacingToken.value = true;
  activeStep.value = "token";
  form.accessToken = "";
  clearOperationMessage();
}

async function connectToken() {
  if (!canConnectToken.value) {
    return;
  }
  clearOperationMessage();
  const result = await appAuth.connect({
    accessToken: form.accessToken,
    organizationSlug: form.organizationSlug,
    regionGroup: form.regionGroup
  });
  rememberOrganizations(result);
  if (result?.ok === false) {
    setOperationError(result, "Managed app login token could not be connected.");
    return;
  }
  form.accessToken = "";
  replacingToken.value = false;
  activeStep.value = organizationReady.value ? "projects" : "organization";
}

async function provisionProjects() {
  if (!canProvisionProjects.value) {
    return;
  }
  clearOperationMessage();
  const result = await appAuth.setup({
    organizationSlug: form.organizationSlug || status.value?.organizationSlug || "",
    regionGroup: form.regionGroup
  });
  rememberOrganizations(result);
  if (result?.ok === false) {
    setOperationError(result, "Managed app login projects could not be created.");
    return;
  }
  if (result?.sync || result?.syncError) {
    lastSync.value = result;
  }
  activeStep.value = result?.ready ? "sync" : "projects";
  if (result?.ready) {
    wizardForcedOpen.value = false;
  }
}

async function refreshStatus() {
  if (!props.actionsEnabled) {
    return;
  }
  clearOperationMessage();
  await appAuth.refresh();
}

async function syncManagedAuth() {
  if (!props.actionsEnabled || syncBusy.value || !projectsReady.value) {
    return;
  }
  clearOperationMessage();
  const result = await appAuth.sync({});
  lastSync.value = result || null;
  if (result?.ok === false) {
    setOperationError(result, "Managed app login settings could not be synced.");
    return;
  }
  if (projectsReady.value) {
    finishWizard();
  }
}

async function disconnectManagedAuth() {
  if (!props.actionsEnabled || disconnectBusy.value) {
    return;
  }
  clearOperationMessage();
  const result = await appAuth.disconnect();
  if (result?.ok === false) {
    setOperationError(result, "Managed app login token could not be removed.");
    return;
  }
  form.accessToken = "";
  form.organizationSlug = "";
  lastOrganizations.value = [];
  replacingToken.value = false;
  wizardForcedOpen.value = true;
  activeStep.value = "token";
}

function projectKeyLabel(project = {}) {
  if (!tokenReady.value && project.publishableKeyPresent) {
    return "Stored key";
  }
  return project.publishableKeyPresent ? "Key ready" : "Key missing";
}

function finishWizard() {
  wizardForcedOpen.value = false;
  replacingToken.value = false;
  detailsVisible.value = false;
  activeStep.value = "sync";
}
</script>

<style scoped>
.managed-app-auth-setup {
  display: grid;
  gap: 1rem;
  padding: 0.25rem 0 0;
}

.managed-app-auth-setup__header {
  align-items: start;
  display: flex;
  gap: 1rem;
  justify-content: space-between;
}

.managed-app-auth-setup__header-actions {
  align-items: center;
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  gap: 0.6rem;
  justify-content: flex-end;
}

.managed-app-auth-setup__kicker,
.managed-app-auth-setup__project-env {
  color: rgba(var(--v-theme-on-surface), 0.58);
  font-size: 0.75rem;
  font-weight: 760;
  letter-spacing: 0;
  line-height: 1.1;
  margin: 0 0 0.25rem;
  text-transform: uppercase;
}

.managed-app-auth-setup h2,
.managed-app-auth-setup h3,
.managed-app-auth-setup h4 {
  letter-spacing: 0;
  margin: 0;
}

.managed-app-auth-setup h2 {
  font-size: 1.24rem;
  font-weight: 760;
  line-height: 1.2;
}

.managed-app-auth-setup h3 {
  font-size: 1rem;
  font-weight: 740;
  line-height: 1.25;
}

.managed-app-auth-setup h4 {
  font-size: 0.95rem;
  font-weight: 720;
  line-height: 1.25;
}

.managed-app-auth-setup p {
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.88rem;
  line-height: 1.42;
  margin: 0;
}

.managed-app-auth-ready {
  display: grid;
  gap: 1rem;
}

.managed-app-auth-ready__hero {
  align-items: start;
  background: rgba(var(--v-theme-success), 0.055);
  border: 1px solid rgba(var(--v-theme-success), 0.18);
  border-radius: 8px;
  display: flex;
  gap: 0.8rem;
  padding: 0.9rem 1rem;
}

.managed-app-auth-ready__projects {
  display: grid;
  gap: 0.75rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.managed-app-auth-ready__project {
  border: 1px solid rgba(var(--v-theme-outline), 0.14);
  border-radius: 8px;
  display: flex;
  gap: 0.8rem;
  justify-content: space-between;
  min-width: 0;
  padding: 0.8rem;
}

.managed-app-auth-ready__project p:last-child {
  overflow-wrap: anywhere;
}

.managed-app-auth-ready__meta {
  border: 1px solid rgba(var(--v-theme-outline), 0.12);
  border-radius: 8px;
  display: flex;
  gap: 0.6rem;
  justify-content: space-between;
  padding: 0.7rem 0.8rem;
}

.managed-app-auth-ready__meta span,
.managed-app-auth-ready__sync {
  color: rgba(var(--v-theme-on-surface), 0.58);
}

.managed-app-auth-ready__actions,
.managed-app-auth-wizard__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
}

.managed-app-auth-wizard {
  display: grid;
  gap: 1rem;
}

.managed-app-auth-wizard__nav {
  display: grid;
  gap: 0.45rem;
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.managed-app-auth-wizard__nav-item {
  align-items: center;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-outline), 0.14);
  border-radius: 8px;
  color: rgb(var(--v-theme-on-surface));
  cursor: pointer;
  display: grid;
  gap: 0.08rem 0.55rem;
  grid-template-columns: auto minmax(0, 1fr);
  min-height: 3.25rem;
  padding: 0.48rem 0.6rem;
  text-align: left;
}

.managed-app-auth-wizard__nav-item:disabled {
  cursor: default;
  opacity: 0.58;
}

.managed-app-auth-wizard__nav-item span {
  align-items: center;
  background: rgba(var(--v-theme-surface-variant), 0.72);
  border-radius: 999px;
  color: rgba(var(--v-theme-on-surface), 0.62);
  display: inline-flex;
  font-size: 0.72rem;
  grid-row: 1 / span 2;
  height: 1.45rem;
  justify-content: center;
  width: 1.45rem;
}

.managed-app-auth-wizard__nav-item strong {
  font-size: 0.84rem;
  line-height: 1.12;
  min-width: 0;
}

.managed-app-auth-wizard__nav-item em {
  color: rgba(var(--v-theme-on-surface), 0.58);
  font-size: 0.72rem;
  font-style: normal;
  line-height: 1.1;
}

.managed-app-auth-wizard__nav-item--active {
  background: rgba(var(--v-theme-primary), 0.04);
  border-color: rgba(var(--v-theme-primary), 0.48);
}

.managed-app-auth-wizard__nav-item--active span {
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
}

.managed-app-auth-wizard__nav-item--ready span {
  background: rgba(var(--v-theme-success), 0.14);
}

.managed-app-auth-wizard__nav-item--ready span,
.managed-app-auth-wizard__nav-item--ready em {
  color: rgb(var(--v-theme-success));
}

.managed-app-auth-wizard__panel {
  border: 1px solid rgba(var(--v-theme-outline), 0.14);
  border-radius: 8px;
  display: grid;
  gap: 0.85rem;
  min-height: 10.5rem;
  padding: 1rem 1.1rem;
}

.managed-app-auth-wizard__field-row {
  align-items: start;
  display: grid;
  gap: 0.7rem;
  grid-template-columns: minmax(0, 1fr) auto;
}

.managed-app-auth-wizard__selected-value {
  color: rgb(var(--v-theme-on-surface)) !important;
  font-weight: 740;
  overflow-wrap: anywhere;
}

.managed-app-auth-setup__details {
  border: 1px solid rgba(var(--v-theme-outline), 0.14);
  border-radius: 8px;
  display: grid;
  gap: 0.8rem;
  padding: 0.9rem;
}

.managed-app-auth-setup__project-list {
  display: grid;
  gap: 0.75rem;
}

.managed-app-auth-setup__project {
  border: 1px solid rgba(var(--v-theme-outline), 0.14);
  border-radius: 8px;
  display: grid;
  gap: 0.72rem;
  padding: 0.8rem;
}

.managed-app-auth-setup__project-heading {
  align-items: start;
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
}

.managed-app-auth-setup__project-facts {
  display: grid;
  gap: 0.45rem;
  margin: 0;
}

.managed-app-auth-setup__project-facts div {
  display: grid;
  gap: 0.55rem;
  grid-template-columns: 4rem minmax(0, 1fr);
}

.managed-app-auth-setup__project-facts dt {
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-size: 0.78rem;
}

.managed-app-auth-setup__project-facts dd {
  font-size: 0.84rem;
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
}

.managed-app-auth-setup__project-facts a {
  color: rgb(var(--v-theme-primary));
  text-decoration: none;
}

.managed-app-auth-setup__project-facts a:hover {
  text-decoration: underline;
}

@media (max-width: 860px) {
  .managed-app-auth-setup__header,
  .managed-app-auth-wizard__field-row,
  .managed-app-auth-ready__projects,
  .managed-app-auth-wizard__nav {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 560px) {
  .managed-app-auth-ready__project,
  .managed-app-auth-setup__project-heading {
    display: grid;
  }

  .managed-app-auth-setup__project-facts div {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
