<template>
  <section class="project-settings">
    <header class="project-settings__header">
      <div>
        <h1 class="text-headline-small font-weight-bold ma-0">Project settings</h1>
        <p class="text-body-medium">Choose how you and your AI work on this project.</p>
      </div>
      <v-btn
        class="project-settings__refresh"
        :disabled="loading"
        height="48"
        type="button"
        variant="text"
        @click="refresh"
      >
        {{ loading ? "Refreshing…" : "Refresh" }}
      </v-btn>
    </header>

    <Vibe64AsyncModuleState
      v-if="initialLoading || loadError"
      label="Project settings"
      :loading="loading"
      :message="loadError || 'Loading project settings.'"
      min-height="12rem"
      @reload="reloadPage"
      @retry="refresh"
    />

    <template v-else>
      <ConnectedProjectsSettings :project-slug="projectSlug" :state="resource.data.value?.connectedProjects" @saved="resource.reload()" />
      <section class="project-settings__section" aria-labelledby="engineering-approach-title">
        <div class="project-settings__section-copy text-body-medium">
          <p v-if="engineeringAvailable" class="project-settings__scope text-label-medium">
            {{ engineeringSourceLabel }}
          </p>
          <h2 id="engineering-approach-title" class="text-title-medium font-weight-bold">Engineering approach</h2>
          <p>
            Choose how cautiously the AI changes your software. Every profile keeps changes
            simple and asks before adding necessary complexity.
          </p>
        </div>

        <div v-if="engineeringAvailable" class="project-settings__content text-body-medium">
          <div class="project-settings__engineering-field">
            <v-select
              v-model="engineeringProfileDraft"
              :disabled="engineeringSaving"
              density="comfortable"
              hide-details="auto"
              :hint="selectedEngineeringDescription"
              item-title="name"
              item-value="id"
              :items="engineeringProfiles"
              label="Engineering profile"
              persistent-hint
              variant="outlined"
            />
          </div>

          <div class="project-settings__action text-body-small">
            <p>{{ engineeringStatusText }}</p>
            <v-btn
              :disabled="!engineeringChanged || engineeringSaving"
              :color="engineeringChanged ? 'primary' : undefined"
              height="48"
              type="button"
              variant="flat"
              @click="saveEngineeringProfile"
            >
              {{ engineeringSaving ? "Saving…" : "Save engineering approach" }}
            </v-btn>
          </div>
        </div>

        <div v-else class="project-settings__action text-body-small">
          <p>{{ engineeringUnavailableReason }}</p>
        </div>
      </section>

      <section class="project-settings__section" aria-labelledby="development-database-title">
        <div class="project-settings__section-copy text-body-medium">
          <h2 id="development-database-title" class="text-title-medium font-weight-bold">Development database</h2>
          <p v-if="managed">
            Share development data across sessions or keep a separate database for each.
          </p>
          <p v-else>
            This Vibe64 installation does not manage development databases. The application
            receives its database connection through the project Env configuration.
          </p>
        </div>

        <div v-if="managed" class="project-settings__content text-body-medium">
          <v-radio-group
            v-model="scopeDraft"
            aria-labelledby="development-database-title"
            class="project-settings__options"
            :disabled="databaseSaving"
            hide-details
          >
            <div class="project-settings__option">
              <v-radio
                class="py-1"
                :aria-describedby="sessionScopeReason ? 'development-database-session-reason' : undefined"
                :disabled="!sessionScopeAvailable"
                label="A separate database for each session"
                value="session"
              />
              <p
                v-if="sessionScopeReason"
                id="development-database-session-reason"
                class="project-settings__option-support text-body-small"
              >
                {{ sessionScopeReason }}
              </p>
            </div>
            <div class="project-settings__option">
              <v-radio
                class="py-1"
                :aria-describedby="projectScopeReason ? 'development-database-project-reason' : undefined"
                :disabled="!projectScopeAvailable"
                label="One database shared by this project"
                value="project"
              />
              <p
                v-if="projectScopeReason"
                id="development-database-project-reason"
                class="project-settings__option-support text-body-small"
              >
                {{ projectScopeReason }}
              </p>
            </div>
          </v-radio-group>

          <div v-if="scopeDraft === 'project'" class="project-settings__action text-body-small">
            <v-checkbox
              v-model="sharedSessionsDraft"
              label="Allow multiple sessions with this shared database"
              :disabled="databaseSaving"
              hide-details
            />
            <p>All sessions will share the same database.</p>
          </div>

          <div class="project-settings__action text-body-small">
            <p v-if="disabledReason">{{ disabledReason }}</p>
            <p v-else-if="scopeDraft === 'project'">
              Data and schema changes will be visible to every project session and remain
              after a session is archived.
            </p>
            <v-btn
              :disabled="!databaseChanged || !databaseSaveAllowed || databaseSaving"
              :color="databaseChanged ? 'primary' : undefined"
              height="48"
              type="button"
              variant="flat"
              @click="saveDatabase"
            >
              {{ databaseSaving ? "Saving…" : "Save database choice" }}
            </v-btn>
          </div>
        </div>
      </section>

      <section class="project-settings__section" aria-labelledby="ai-behaviour-title">
        <div class="project-settings__section-copy text-body-medium">
          <p class="project-settings__scope text-label-medium">{{ collaborationSourceLabel }}</p>
          <h2 id="ai-behaviour-title" class="text-title-medium font-weight-bold">AI behaviour</h2>
          <p>
            Set the tone, level of detail and project requirements for your conversations.
            These choices follow your project source.
          </p>
          <v-btn
            class="project-settings__account-link"
            height="48"
            type="button"
            variant="text"
            @click="openPersonalSettings"
          >
            Set your Vibe64 name
          </v-btn>
        </div>

        <div class="project-settings__content text-body-medium">
          <div class="project-settings__ai-fields">
            <v-select
              v-model="collaborationDraft.tone"
              :disabled="!collaborationAvailable || !collaborationCanEdit || collaborationSaving"
              density="comfortable"
              hide-details
              item-title="label"
              item-value="value"
              :items="toneOptions"
              label="Tone"
              variant="outlined"
            />
            <v-select
              v-model="collaborationDraft.responseLength"
              :disabled="!collaborationAvailable || !collaborationCanEdit || collaborationSaving"
              density="comfortable"
              hide-details
              item-title="label"
              item-value="value"
              :items="responseLengthOptions"
              label="Response length"
              variant="outlined"
            />
            <v-select
              v-model="collaborationDraft.experience"
              :disabled="!collaborationAvailable || !collaborationCanEdit || collaborationSaving"
              density="comfortable"
              hide-details
              item-title="label"
              item-value="value"
              :items="experienceOptions"
              label="Experience level"
              variant="outlined"
            />
            <v-select
              v-model="collaborationDraft.explanationStyle"
              :disabled="!collaborationAvailable || !collaborationCanEdit || collaborationSaving"
              density="comfortable"
              hide-details
              item-title="label"
              item-value="value"
              :items="explanationStyleOptions"
              label="Explanation style"
              variant="outlined"
            />
            <v-textarea
              v-model="collaborationDraft.requirements"
              class="project-settings__ai-note"
              :disabled="!collaborationAvailable || !collaborationCanEdit || collaborationSaving"
              auto-grow
              density="comfortable"
              hide-details
              label="Project requirements (optional)"
              placeholder="For example: use Australian English."
              rows="6"
              max-rows="18"
              variant="outlined"
            />
          </div>

          <div class="project-settings__action text-body-small">
            <p v-if="!collaborationAvailable">{{ collaborationUnavailableReason }}</p>
            <p v-else-if="!collaborationCanEdit">
              Only the project owner can change these controls in Settings. Anyone who can
              edit this source can change genesis/collaboration.md directly.
            </p>
            <p v-else>
              Applies when a conversation next starts or refreshes its context. Existing history
              and instructions in an active Codex conversation stay as they are.
            </p>
            <v-btn
              :disabled="!collaborationChanged || !collaborationAvailable || !collaborationCanEdit || collaborationSaving"
              :color="collaborationChanged ? 'primary' : undefined"
              height="48"
              type="button"
              variant="flat"
              @click="saveCollaboration"
            >
              {{ collaborationSaving ? "Saving…" : "Save collaboration" }}
            </v-btn>
          </div>
        </div>
      </section>

      <section class="project-settings__section" aria-labelledby="prompt-suggestions-title">
        <div class="project-settings__section-copy text-body-medium">
          <h2 id="prompt-suggestions-title" class="text-title-medium font-weight-bold">Prompt suggestions</h2>
          <p>Get ideas for what to ask next. This Vibe64 setting does not change your AI's instructions.</p>
        </div>
        <div class="project-settings__content text-body-medium">
          <v-switch
            v-model="promptHintsDraft"
            class="project-settings__ai-hints"
            color="primary"
            :disabled="!promptHintsCanEdit || promptHintsSaving"
            hide-details
            label="Suggest useful next prompts"
          />
          <div class="project-settings__action text-body-small">
            <v-btn
              :disabled="!promptHintsChanged || !promptHintsCanEdit || promptHintsSaving"
              :color="promptHintsChanged ? 'primary' : undefined"
              height="48"
              type="button"
              variant="flat"
              @click="savePromptHints"
            >
              {{ promptHintsSaving ? "Saving…" : "Save prompt suggestions" }}
            </v-btn>
          </div>
        </div>
      </section>
      <section v-if="repositoryWorkflow.available" class="project-settings__section" aria-labelledby="repository-workflow-title">
        <div class="project-settings__section-copy text-body-medium">
          <h2 id="repository-workflow-title" class="text-title-medium font-weight-bold">Git workflow</h2>
          <p>Choose how Vibe64 saves changes to this repository.</p>
        </div>
        <div class="project-settings__content text-body-medium">
          <v-radio-group
            v-model="requirePullRequest"
            label="GitHub save workflow"
            color="primary"
            hide-details
            :disabled="!repositoryWorkflow.canEdit || repositoryWorkflowCommand.isRunning"
          >
            <v-radio label="Allow direct commits and pushes" :value="false" class="py-1" />
            <v-radio label="Require pull requests" :value="true" class="py-1" />
          </v-radio-group>
          <p>GitHub branch rules still apply. Requiring pull requests makes Create draft PR the main Save action until a session is attached to a PR.</p>
          <p>This setting controls Vibe64's Save actions. GitHub rules control pushes from terminals and other tools.</p>
          <div class="project-settings__action text-body-small">
            <v-btn
              :color="requirePullRequest !== repositoryWorkflow.requirePullRequest ? 'primary' : undefined"
              height="48"
              variant="flat"
              :disabled="!repositoryWorkflow.canEdit || repositoryWorkflowCommand.isRunning || requirePullRequest === repositoryWorkflow.requirePullRequest"
              @click="saveRepositoryWorkflow"
            >
              {{ repositoryWorkflowCommand.isRunning ? 'Saving…' : 'Save repository workflow' }}
            </v-btn>
          </div>
        </div>
      </section>
    </template>
  </section>
</template>

<script setup>
// Project settings: connected projects, the engineering approach, the development database, AI behaviour,
// prompt suggestions and the Git workflow, each saved on its own.
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { useRealtimeEvent } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import { scopedDevelopmentApiUrl } from "@/lib/studioUrls.js";
import Vibe64AsyncModuleState from "@/components/common/Vibe64AsyncModuleState.vue";
import ConnectedProjectsSettings from "./ConnectedProjectsSettings.vue";
import {
  useVibe64ProjectSlug
} from "@/composables/useVibe64ProjectScope.js";
import {
  sessionListRealtimeShouldRefresh
} from "@/composables/useVibe64SessionData.js";
import { useVibe64CollaborationSettings } from "@/composables/useVibe64CollaborationSettings.js";
import { useVibe64DevelopmentDatabaseSettings } from "@/composables/useVibe64DevelopmentDatabaseSettings.js";
import { useVibe64EngineeringSettings } from "@/composables/useVibe64EngineeringSettings.js";
import {
  requestVibe64AccountConnectionsDialog
} from "@/lib/vibe64AccountConnectionsDialog.js";
import {
  PROMPT_HINTS_SETTINGS_ENDPOINT,
  PROJECT_SETTINGS_ENDPOINT,
  VIBE64_PROMPT_HINTS_SETTINGS_API_SUFFIX,
  projectSettingsQueryKey
} from "@/lib/studioGateApi.js";
import {
  VIBE64_SURFACE_ID
} from "@/lib/vibe64RequestConfig.js";
import {
  VIBE64_SESSION_SUMMARY_CHANGED_EVENT
} from "@/lib/vibe64SessionRequestConfig.js";
import { reloadPage } from "@/lib/browser.js";

const projectSlug = useVibe64ProjectSlug();
const route = useRoute();
const router = useRouter();
const promptHintsDraft = ref(true);
const savedPromptHints = ref(true);
const requirePullRequest = ref(false);
const routeSessionId = computed(() => String(route.query.sessionId || "").trim());

const resource = useEndpointResource({
  fallbackLoadError: "Project settings could not load.",
  path: computed(() => scopedDevelopmentApiUrl(PROJECT_SETTINGS_ENDPOINT, projectSlug.value)),
  queryKey: computed(() => projectSettingsQueryKey(
    VIBE64_SURFACE_ID,
    ROUTE_VISIBILITY_PUBLIC,
    projectSlug.value,
    routeSessionId.value
  )),
  readQuery: computed(() => (
    routeSessionId.value ? { sessionId: routeSessionId.value } : {}
  )),
  refreshOnPull: true,
  requestRecoveryLabel: "Project settings"
});

const {
  databaseChanged,
  databaseSaveAllowed,
  databaseSaving,
  disabledReason,
  managed,
  projectScopeAvailable,
  projectScopeReason,
  saveDatabase,
  scopeDraft,
  sessionScopeAvailable,
  sessionScopeReason,
  sharedSessionsDraft
} = useVibe64DevelopmentDatabaseSettings({ resource });

const {
  collaborationAvailable,
  collaborationCanEdit,
  collaborationChanged,
  collaborationDraft,
  collaborationSaving,
  collaborationSourceLabel,
  collaborationUnavailableReason,
  experienceOptions,
  explanationStyleOptions,
  responseLengthOptions,
  saveCollaboration,
  toneOptions
} = useVibe64CollaborationSettings({ projectSlug, resource, routeSessionId });

const promptHintsSaveCommand = useCommand({
  access: "never",
  apiSuffix: VIBE64_PROMPT_HINTS_SETTINGS_API_SUFFIX,
  buildCommandOptions: () => ({
    method: "PUT",
    path: PROMPT_HINTS_SETTINGS_ENDPOINT
  }),
  buildRawPayload: (_model, { context }) => ({
    promptHints: context.promptHints
  }),
  fallbackRunError: "Prompt suggestions could not be saved.",
  messages: {
    error: "Prompt suggestions could not be saved.",
    success: "Prompt suggestions saved."
  },
  ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
  placementSource: "vibe64.prompt-hints.save",
  surfaceId: VIBE64_SURFACE_ID,
  writeMethod: "PUT"
});
const repositoryWorkflowCommand = useCommand({
  access: "never",
  apiSuffix: "/vibe64/repository/workflow",
  buildCommandOptions: () => ({
    method: "PUT",
    path: scopedDevelopmentApiUrl("/api/vibe64/repository/workflow", projectSlug.value)
  }),
  buildRawPayload: (_model, { context }) => ({
    requirePullRequest: context.requirePullRequest
  }),
  fallbackRunError: "Repository workflow could not be saved.",
  messages: {
    error: "Repository workflow could not be saved.",
    success: "Repository workflow saved."
  },
  ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
  placementSource: "vibe64.repository.workflow",
  surfaceId: VIBE64_SURFACE_ID,
  writeMethod: "PUT"
});
const repositoryWorkflow = computed(() => resource.data.value?.repositoryWorkflow || {});
watch(() => repositoryWorkflow.value.requirePullRequest, (value) => {
  requirePullRequest.value = value === true;
}, { immediate: true });
async function saveRepositoryWorkflow() {
  await repositoryWorkflowCommand.run({ requirePullRequest: requirePullRequest.value });
  await resource.reload();
}

const {
  engineeringAvailable,
  engineeringChanged,
  engineeringProfileDraft,
  engineeringProfiles,
  engineeringResource,
  engineeringSaving,
  engineeringSourceLabel,
  engineeringStatusText,
  engineeringUnavailableReason,
  saveEngineeringProfile,
  selectedEngineeringDescription
} = useVibe64EngineeringSettings({ projectSlug, route, router, routeSessionId });

const promptHints = computed(() => resource.data.value?.promptHints || {});
const promptHintsCanEdit = computed(() => promptHints.value.canEdit === true);
const loading = computed(() => (
  resource.isLoading.value === true || engineeringResource.isLoading.value === true
));
const initialLoading = computed(() => loading.value && (
  !resource.data.value || !engineeringResource.data.value
));
const loadError = computed(() => String(
  resource.loadError.value || engineeringResource.loadError.value || ""
));
const promptHintsSaving = computed(() => promptHintsSaveCommand.isRunning === true);
const promptHintsChanged = computed(() => promptHintsDraft.value !== savedPromptHints.value);

watch(() => promptHints.value.enabled, (value) => {
  const enabled = value !== false;
  if (!promptHintsChanged.value) {
    promptHintsDraft.value = enabled;
  }
  savedPromptHints.value = enabled;
}, {
  immediate: true
});

useRealtimeEvent({
  event: VIBE64_SESSION_SUMMARY_CHANGED_EVENT,
  matches: (event) => sessionListRealtimeShouldRefresh(event, projectSlug.value),
  onEvent() {
    void resource.reload();
    void engineeringResource.reload();
  }
});

async function refresh() {
  await Promise.all([
    resource.reload(),
    engineeringResource.reload()
  ]);
}

async function savePromptHints() {
  if (!promptHintsChanged.value || !promptHintsCanEdit.value || promptHintsSaving.value) {
    return;
  }
  await promptHintsSaveCommand.run({
    promptHints: promptHintsDraft.value
  });
  await resource.reload();
}

function openPersonalSettings() {
  requestVibe64AccountConnectionsDialog({
    refresh: false,
    section: "profile"
  });
}
</script>

<style scoped>
.project-settings {
  container: project-settings / inline-size;
  min-width: 0;
  max-width: 76rem;
  width: 100%;
}

.project-settings__header {
  align-items: start;
  display: flex;
  gap: 1rem;
  justify-content: space-between;
  padding-block-end: 1.5rem;
}

.project-settings p,
.project-settings h2 {
  margin: 0;
}

.project-settings p {
  color: rgba(var(--v-theme-on-surface), 0.7);
  overflow-wrap: anywhere;
}

.project-settings__header p {
  margin-top: 0.5rem;
}

.project-settings__refresh {
  flex: 0 0 auto;
}

.project-settings__section {
  align-items: start;
  border-top: thin solid rgba(var(--v-border-color), var(--v-border-opacity));
  display: grid;
  gap: 1.5rem 2rem;
  grid-template-columns: minmax(12rem, 1fr) minmax(0, 2fr);
  padding-block: 1.5rem;
}

.project-settings__section-copy,
.project-settings__content,
.project-settings__action {
  display: grid;
  gap: 1rem;
  min-width: 0;
}

.project-settings__section-copy {
  align-content: start;
  gap: 0.5rem;
}

.project-settings__action {
  justify-items: start;
}

.project-settings__account-link {
  justify-self: start;
  margin-inline-start: -0.75rem;
}

.project-settings__engineering-field,
.project-settings__option {
  min-width: 0;
}

.project-settings .project-settings__option-support {
  margin-inline-start: 2.5rem;
}

.project-settings__ai-fields {
  display: grid;
  gap: 1.5rem 1rem;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr));
  min-width: 0;
}

.project-settings__ai-note {
  grid-column: 1 / -1;
}

@container project-settings (max-width: 48rem) {
  .project-settings__section {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
