<script setup>
import { useVibe64AddProjectWizard } from "@/composables/useVibe64AddProjectWizard.js";

const props = defineProps({
  closable: {
    default: false,
    type: Boolean
  }
});

const emit = defineEmits(["cancel", "created"]);

const {
  autocompleteRoot,
  canAddExistingProject,
  canContinueToRepository,
  canCreateRepositoryProject,
  createAllowed,
  createDescription,
  createName,
  createOwner,
  createOwnerSelectItems,
  createVisibility,
  editCreateName,
  editProjectSlug,
  closeOpenResults,
  continueToRepository,
  mdiAlertCircle,
  mdiArrowLeft,
  mdiCheckCircle,
  mdiClose,
  mdiEarth,
  mdiFolderOpen,
  mdiLock,
  mdiMagnify,
  mdiPlus,
  mdiSourceRepository,
  normalizedProjectSlug,
  openName,
  openOwner,
  openResults,
  openSearching,
  openSelectedRepository,
  ownerSelectItems,
  ownersError,
  ownersLoading,
  permissionLabel,
  projectSlug,
  projectSlugValid,
  repositoryMode,
  repositoryVisibilityIcon,
  saving,
  selectRepository,
  selectRepositoryMode,
  selectedCreateOwner,
  showOpenResults,
  showOpenResultsPanel,
  sourceHeading,
  step,
  stepLabel,
  submitExistingRepositoryProject,
  submitNewRepositoryProject,
  success,
  visibleFormError
} = useVibe64AddProjectWizard({
  onCreated: (response) => emit("created", response)
});
</script>

<template>
  <section class="project-wizard" aria-label="Add project">
    <header class="project-wizard__intro">
      <div>
        <p class="project-wizard__kicker">{{ stepLabel }}</p>
        <h3>Add project</h3>
        <p>Create a Vibe64 project, then connect it to source code.</p>
      </div>
      <button
        v-if="props.closable"
        aria-label="Close add project"
        class="project-wizard__close"
        type="button"
        @click="emit('cancel')"
      >
        <v-icon :icon="mdiClose" />
      </button>
    </header>

    <div class="project-wizard__progress" aria-label="Project creation progress">
      <span :class="{ 'project-wizard__progress-step--active': step === 'project', 'project-wizard__progress-step--done': projectSlugValid }">
        Project details
      </span>
      <span :class="{ 'project-wizard__progress-step--active': step === 'repository' }">
        Source code
      </span>
    </div>

    <div class="project-wizard__content">
      <v-alert v-if="visibleFormError" type="error" variant="tonal">
        {{ visibleFormError }}
      </v-alert>
      <v-alert v-if="success" type="success" variant="tonal">
        {{ success.project?.slug }} is linked to {{ success.repository?.fullName }}.
      </v-alert>

      <section v-if="step === 'project'" class="project-wizard__body" aria-label="Project details">
        <v-text-field
          :model-value="projectSlug"
          autocomplete="off"
          autofocus
          density="comfortable"
          hide-details="auto"
          label="Project name"
          placeholder="beepollen"
          variant="outlined"
          @update:model-value="editProjectSlug"
          @keydown.enter.prevent="continueToRepository"
        />

        <p class="project-wizard__field-note">
          This becomes the project slug and the Studio URL for the project.
        </p>

        <div v-if="projectSlugValid" class="project-wizard__derived">
          <span>
            <small>Project slug</small>
            <strong>{{ normalizedProjectSlug }}</strong>
          </span>
          <span>
            <small>Studio URL</small>
            <strong>/app/{{ normalizedProjectSlug }}</strong>
          </span>
        </div>

        <div v-if="projectSlug && !projectSlugValid" class="project-wizard__warning">
          <v-icon :icon="mdiAlertCircle" />
          Project names must start with a letter or number.
        </div>
      </section>

      <section v-else class="project-wizard__body" aria-label="GitHub repository">
        <div class="project-wizard__summary">
          <span>Project</span>
          <strong>{{ normalizedProjectSlug }}</strong>
          <button type="button" @click="step = 'project'">
            Edit
          </button>
        </div>

        <div class="project-wizard__source-choice" role="radiogroup" aria-label="Source code">
          <button
            class="project-wizard__source-card"
            :class="{ 'project-wizard__source-card--active': repositoryMode === 'existing' }"
            role="radio"
            :aria-checked="repositoryMode === 'existing'"
            type="button"
            @click="selectRepositoryMode('existing')"
          >
            <v-icon :icon="mdiFolderOpen" />
            <span>
              <strong>Use existing GitHub repository</strong>
              <small>Choose any repository your GitHub account can see.</small>
            </span>
          </button>
          <button
            class="project-wizard__source-card"
            :class="{ 'project-wizard__source-card--active': repositoryMode === 'create' }"
            role="radio"
            :aria-checked="repositoryMode === 'create'"
            type="button"
            @click="selectRepositoryMode('create')"
          >
            <v-icon :icon="mdiPlus" />
            <span>
              <strong>Create new GitHub repository</strong>
              <small>Create it under your account or an organization.</small>
            </span>
          </button>
        </div>

        <v-alert v-if="ownersError" type="error" variant="tonal">
          {{ ownersError }}
        </v-alert>

        <section class="project-wizard__source-panel" :aria-label="sourceHeading">
          <template v-if="repositoryMode === 'existing'">
            <div class="project-wizard__lookup-grid">
              <v-select
                v-model="openOwner"
                density="comfortable"
                :disabled="ownersLoading"
                hide-details="auto"
                item-title="title"
                item-value="value"
                :items="ownerSelectItems"
                label="GitHub owner"
                variant="outlined"
                @update:model-value="showOpenResults"
              >
                <template #item="{ props: itemProps, item }">
                  <v-list-item v-bind="itemProps">
                    <template #subtitle>
                      {{ item.raw?.type === 'organization' ? 'Organization' : 'Personal account' }}
                    </template>
                  </v-list-item>
                </template>
              </v-select>

              <div ref="autocompleteRoot" class="project-wizard__autocomplete">
                <v-text-field
                  v-model="openName"
                  autocomplete="off"
                  density="comfortable"
                  hide-details="auto"
                  label="Repository name"
                  placeholder="Type to search repositories"
                  variant="outlined"
                  @focus="showOpenResults"
                  @keydown.escape="closeOpenResults"
                >
                  <template #prepend-inner>
                    <v-icon :icon="mdiMagnify" />
                  </template>
                </v-text-field>

                <div
                  v-if="showOpenResultsPanel"
                  class="project-wizard__autocomplete-panel"
                  aria-label="Repository results"
                >
                  <div class="project-wizard__autocomplete-toolbar">
                    <span>Repositories</span>
                    <button
                      aria-label="Close repository suggestions"
                      type="button"
                      @click="closeOpenResults"
                    >
                      <v-icon :icon="mdiClose" />
                    </button>
                  </div>

                  <div v-if="openSearching" class="project-wizard__quiet">
                    Loading {{ openOwner }}...
                  </div>

                  <div v-if="openResults.length > 0" class="project-wizard__results">
                    <button
                      v-for="repository in openResults"
                      :key="repository.fullName"
                      class="project-wizard__result"
                      type="button"
                      @click="selectRepository(repository)"
                    >
                      <v-icon :icon="mdiSourceRepository" />
                      <span>
                        <strong>{{ repository.fullName }}</strong>
                        <small>{{ repository.description || permissionLabel(repository) }}</small>
                      </span>
                      <span class="project-wizard__pill">
                        <v-icon :icon="repositoryVisibilityIcon(repository)" />
                        {{ repository.visibility || (repository.isPrivate ? 'private' : 'public') }}
                      </span>
                    </button>
                  </div>

                  <div v-else-if="!openSearching && openName.trim()" class="project-wizard__quiet">
                    No repositories found for {{ openOwner }}/{{ openName.trim() }}.
                  </div>
                </div>
              </div>
            </div>

            <div v-if="openSelectedRepository" class="project-wizard__selected">
              <v-icon :icon="mdiCheckCircle" />
              <span>
                <strong>{{ openSelectedRepository.fullName }}</strong>
                <small>{{ permissionLabel(openSelectedRepository) }}</small>
              </span>
            </div>
          </template>

          <template v-else>
            <v-select
              v-model="createOwner"
              density="comfortable"
              :disabled="ownersLoading"
              hide-details="auto"
              item-title="title"
              item-value="value"
              :items="createOwnerSelectItems"
              label="GitHub owner"
              variant="outlined"
            >
              <template #item="{ props: itemProps, item }">
                <v-list-item v-bind="itemProps">
                  <template #subtitle>
                    {{ item.raw?.type === 'organization' ? 'Organization' : 'Personal account' }}
                  </template>
                </v-list-item>
              </template>
            </v-select>

            <div v-if="selectedCreateOwner && !createAllowed" class="project-wizard__warning">
              <v-icon :icon="mdiAlertCircle" />
              This account cannot create repositories.
            </div>

            <v-text-field
              :model-value="createName"
              autocomplete="off"
              density="comfortable"
              hide-details="auto"
              label="Repository name"
              placeholder="beepollen"
              variant="outlined"
              @update:model-value="editCreateName"
            />

            <v-text-field
              v-model="createDescription"
              autocomplete="off"
              density="comfortable"
              hide-details="auto"
              label="Description"
              placeholder="Optional"
              variant="outlined"
            />

            <div class="project-wizard__visibility-field">
              <span>Repository visibility</span>
              <div class="project-wizard__visibility" aria-label="Repository visibility">
                <button
                  :class="{ 'project-wizard__visibility-option--active': createVisibility === 'private' }"
                  type="button"
                  @click="createVisibility = 'private'"
                >
                  <v-icon :icon="mdiLock" />
                  Private
                </button>
                <button
                  :class="{ 'project-wizard__visibility-option--active': createVisibility === 'public' }"
                  type="button"
                  @click="createVisibility = 'public'"
                >
                  <v-icon :icon="mdiEarth" />
                  Public
                </button>
              </div>
            </div>
          </template>
        </section>
      </section>
    </div>

    <footer class="project-wizard__footer">
      <template v-if="step === 'project'">
        <v-btn
          v-if="props.closable"
          type="button"
          variant="text"
          @click="emit('cancel')"
        >
          Cancel
        </v-btn>
        <span v-else />
        <v-btn
          color="primary"
          :disabled="!canContinueToRepository"
          type="button"
          variant="flat"
          @click="continueToRepository"
        >
          Continue
        </v-btn>
      </template>

      <template v-else>
        <v-btn type="button" variant="text" @click="step = 'project'">
          <v-icon :icon="mdiArrowLeft" />
          Back
        </v-btn>
        <v-btn
          v-if="repositoryMode === 'existing'"
          color="primary"
          :disabled="!canAddExistingProject"
          :loading="saving"
          type="button"
          variant="flat"
          @click="submitExistingRepositoryProject"
        >
          <v-icon :icon="mdiFolderOpen" />
          Add project
        </v-btn>
        <v-btn
          v-else
          color="primary"
          :disabled="!canCreateRepositoryProject"
          :loading="saving"
          type="button"
          variant="flat"
          @click="submitNewRepositoryProject"
        >
          <v-icon :icon="mdiPlus" />
          Create repository and add project
        </v-btn>
      </template>
    </footer>
  </section>
</template>

<style scoped>
.project-wizard__autocomplete {
  min-width: 0;
  position: relative;
}

.project-wizard__autocomplete-panel {
  background: #ffffff;
  border: 1px solid rgba(15, 23, 42, 0.14);
  border-radius: 8px;
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.14);
  left: 0;
  max-height: min(18rem, 44dvh);
  overflow: auto;
  padding: 0.35rem;
  position: absolute;
  right: 0;
  top: calc(100% + 0.25rem);
  z-index: 30;
}

.project-wizard__autocomplete-toolbar {
  align-items: center;
  color: #64748b;
  display: flex;
  font-size: 0.78rem;
  font-weight: 680;
  justify-content: space-between;
  min-height: 2rem;
  padding: 0.15rem 0.2rem 0.3rem 0.55rem;
}

.project-wizard__autocomplete-toolbar button {
  align-items: center;
  border-radius: 999px;
  color: #475569;
  display: inline-flex;
  height: 1.8rem;
  justify-content: center;
  width: 1.8rem;
}

.project-wizard__autocomplete-toolbar button:hover {
  background: #f1f5f9;
}

.project-wizard__results {
  display: grid;
  gap: 0.35rem;
}

.project-wizard__result {
  align-items: center;
  background: #ffffff;
  border: 1px solid rgba(15, 23, 42, 0.14);
  border-radius: 8px;
  color: #111827;
  cursor: pointer;
  display: grid;
  gap: 0.7rem;
  grid-template-columns: auto minmax(0, 1fr);
  min-height: 3.35rem;
  min-width: 0;
  padding: 0.65rem 0.7rem;
  text-align: left;
}

.project-wizard__result:hover {
  border-color: rgba(var(--v-theme-primary), 0.55);
}

.project-wizard__result strong,
.project-wizard__result small {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-wizard__result strong {
  font-size: 0.92rem;
  font-weight: 720;
}

.project-wizard__result small {
  color: #64748b;
  font-size: 0.8rem;
  margin-top: 0.2rem;
}

.project-wizard__pill {
  align-items: center;
  background: #f1f5f9;
  border-radius: 999px;
  color: #334155;
  display: inline-flex;
  font-size: 0.76rem;
  gap: 0.25rem;
  grid-column: 2;
  justify-self: start;
  max-width: 9rem;
  min-height: 1.6rem;
  padding: 0 0.55rem;
  text-transform: capitalize;
}

.project-wizard__pill .v-icon {
  font-size: 0.95rem;
}

.project-wizard__quiet {
  color: #64748b;
  font-size: 0.85rem;
  padding: 0.55rem 0.65rem;
}

.project-wizard__selected,
.project-wizard__warning {
  align-items: center;
  border-radius: 8px;
  display: grid;
  gap: 0.6rem;
  grid-template-columns: auto minmax(0, 1fr);
  padding: 0.7rem 0.8rem;
}

.project-wizard__selected {
  background: #ecfdf5;
  color: #065f46;
}

.project-wizard__selected small {
  color: #047857;
  display: block;
  font-size: 0.78rem;
}

.project-wizard__warning {
  background: #fff7ed;
  color: #9a3412;
}

.project-wizard {
  background: #ffffff;
  border: 0;
  border-radius: 0;
  box-shadow: -8px 0 32px rgba(15, 23, 42, 0.18);
  color: #111827;
  display: grid;
  gap: 0;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  height: 100%;
  min-height: 100dvh;
  overflow: hidden;
  padding: 0;
}

.project-wizard__intro {
  align-items: start;
  border-bottom: 1px solid rgba(15, 23, 42, 0.08);
  display: grid;
  gap: 0.85rem;
  grid-template-columns: minmax(0, 1fr) auto;
  padding: 1rem 1.15rem 0.85rem;
}

.project-wizard__kicker {
  color: rgb(var(--v-theme-primary));
  font-size: 0.75rem;
  font-weight: 720;
  line-height: 1.2;
  margin: 0 0 0.45rem;
}

.project-wizard__intro h3 {
  font-size: 1.18rem;
  font-weight: 720;
  line-height: 1.2;
  margin: 0;
}

.project-wizard__intro p:not(.project-wizard__kicker) {
  color: #5f6f82;
  line-height: 1.4;
  margin: 0.35rem 0 0;
}

.project-wizard__close {
  align-items: center;
  border-radius: 999px;
  color: #475569;
  display: inline-flex;
  height: 2.25rem;
  justify-content: center;
  margin-top: -0.25rem;
  width: 2.25rem;
}

.project-wizard__progress {
  background: #ffffff;
  display: grid;
  gap: 0.6rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  padding: 0.65rem 1.15rem 0.75rem;
}

.project-wizard__progress span {
  border-bottom: 2px solid #e2e8f0;
  color: #7a8699;
  font-size: 0.76rem;
  font-weight: 720;
  line-height: 1.2;
  padding-bottom: 0.45rem;
}

.project-wizard__progress-step--active {
  border-bottom-color: rgb(var(--v-theme-primary)) !important;
  color: #111827 !important;
}

.project-wizard__progress-step--done {
  border-bottom-color: #22c55e !important;
  color: #166534 !important;
}

.project-wizard__content {
  align-content: start;
  display: grid;
  gap: 0.85rem;
  min-height: 0;
  overflow: auto;
  padding: 0.55rem 1.15rem 1rem;
}

.project-wizard__body,
.project-wizard__source-panel {
  align-content: start;
  display: grid;
  gap: 0.7rem;
  min-width: 0;
}

.project-wizard__field-note {
  color: #5f6f82;
  font-size: 0.86rem;
  line-height: 1.45;
  margin: -0.35rem 0 0;
}

.project-wizard__derived {
  background: #f8fafc;
  border: 1px solid rgba(15, 23, 42, 0.1);
  border-radius: 8px;
  display: grid;
  gap: 0.65rem;
  padding: 0.75rem;
}

.project-wizard__derived span {
  min-width: 0;
}

.project-wizard__derived small {
  color: #5f6f82;
  display: block;
  font-size: 0.75rem;
  font-weight: 720;
  line-height: 1.2;
  margin-bottom: 0.25rem;
}

.project-wizard__derived strong {
  display: block;
  font-size: 0.9rem;
  font-weight: 720;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-wizard__summary {
  align-items: center;
  background: #f8fafc;
  border: 1px solid rgba(15, 23, 42, 0.1);
  border-radius: 8px;
  display: grid;
  gap: 0.5rem;
  grid-template-columns: auto minmax(0, 1fr) auto;
  min-height: 3rem;
  padding: 0.6rem 0.7rem;
}

.project-wizard__summary span {
  color: #5f6f82;
  font-size: 0.78rem;
  font-weight: 720;
}

.project-wizard__summary button {
  color: rgb(var(--v-theme-primary));
  font-size: 0.84rem;
  font-weight: 720;
}

.project-wizard__source-choice {
  display: grid;
  gap: 0.5rem;
}

.project-wizard__source-card {
  align-items: start;
  background: #ffffff;
  border: 1px solid rgba(15, 23, 42, 0.14);
  border-radius: 8px;
  color: #111827;
  cursor: pointer;
  display: grid;
  gap: 0.65rem;
  grid-template-columns: auto minmax(0, 1fr);
  min-height: 3.7rem;
  padding: 0.65rem 0.75rem;
  text-align: left;
}

.project-wizard__source-card:hover {
  border-color: rgba(var(--v-theme-primary), 0.48);
}

.project-wizard__source-card--active {
  background: rgba(var(--v-theme-primary), 0.06);
  border-color: rgba(var(--v-theme-primary), 0.72);
}

.project-wizard__source-card > .v-icon {
  color: rgb(var(--v-theme-primary));
  margin-top: 0.1rem;
}

.project-wizard__source-card strong,
.project-wizard__source-card small {
  display: block;
}

.project-wizard__source-card strong {
  font-size: 0.92rem;
  font-weight: 720;
  line-height: 1.25;
}

.project-wizard__source-card small {
  color: #5f6f82;
  font-size: 0.82rem;
  line-height: 1.35;
  margin-top: 0.2rem;
}

.project-wizard__source-panel {
  border-top: 1px solid rgba(15, 23, 42, 0.08);
  padding-top: 0.7rem;
}

.project-wizard__lookup-grid {
  align-items: start;
  display: grid;
  gap: 0.75rem;
  grid-template-columns: minmax(0, 1fr);
}

.project-wizard__visibility {
  align-items: center;
  background: #f1f5f9;
  border: 1px solid rgba(15, 23, 42, 0.1);
  border-radius: 8px;
  display: grid;
  gap: 0.25rem;
  grid-template-columns: repeat(2, minmax(6.5rem, 1fr));
  justify-self: start;
  max-width: 18rem;
  padding: 0.25rem;
  width: 100%;
}

.project-wizard__visibility-field {
  align-content: start;
  display: grid;
  gap: 0.35rem;
}

.project-wizard__visibility-field > span {
  color: #5f6f82;
  font-size: 0.75rem;
  font-weight: 720;
  line-height: 1.2;
}

.project-wizard__visibility button {
  align-items: center;
  border-radius: 6px;
  color: #475569;
  display: inline-flex;
  font-weight: 720;
  gap: 0.35rem;
  justify-content: center;
  min-height: 2.45rem;
  padding: 0 0.65rem;
}

.project-wizard__visibility-option--active {
  background: #ffffff;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.12);
  color: #111827 !important;
}

.project-wizard__footer {
  align-items: center;
  background: #ffffff;
  border-top: 1px solid rgba(15, 23, 42, 0.1);
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
  min-height: 4.2rem;
  padding: 0.8rem 1.15rem;
}

.project-wizard__footer .v-btn {
  letter-spacing: 0;
  text-transform: none;
}

.project-wizard__footer .v-btn:last-child {
  min-width: 7.5rem;
}

@media (max-width: 460px) {
  .project-wizard__visibility {
    max-width: none;
  }

  .project-wizard__footer {
    align-items: stretch;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
