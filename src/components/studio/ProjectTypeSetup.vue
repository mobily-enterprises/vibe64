<template>
  <section class="project-type-setup">
    <div class="project-type-setup__heading">
      <p class="project-type-setup__eyebrow">AI Studio</p>
      <h2 class="project-type-setup__title">What do you want to build?</h2>
      <p class="project-type-setup__message">
        {{ headingMessage }}
      </p>
    </div>

    <section
      v-if="hasApplicationTypes"
      class="project-type-setup__application-section"
      :aria-labelledby="applicationHeadingId"
    >
      <div class="project-type-setup__application-heading">
        <p class="project-type-setup__section-kicker">Step 1</p>
        <h3 :id="applicationHeadingId">Choose app type</h3>
      </div>

      <div class="project-type-setup__application-grid">
        <button
          v-for="applicationType in applicationTypes"
          :key="applicationType.id"
          :aria-pressed="applicationType.id === selectedApplicationTypeId"
          :class="[
            'project-type-setup__application-card',
            { 'project-type-setup__application-card--selected': applicationType.id === selectedApplicationTypeId }
          ]"
          type="button"
          @click="selectApplicationType(applicationType.id)"
        >
          <svg
            class="project-type-setup__application-icon"
            :viewBox="applicationType.iconViewBox"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="4"
          >
            <path
              v-for="iconPath in applicationType.iconPaths"
              :key="iconPath"
              :d="iconPath"
            />
          </svg>
          <span class="project-type-setup__application-label">{{ applicationType.label }}</span>
          <span class="project-type-setup__application-summary">{{ applicationType.summary }}</span>
          <v-chip
            class="project-type-setup__application-count"
            density="comfortable"
            size="small"
            variant="tonal"
          >
            {{ applicationType.adapters.length }} {{ applicationType.adapters.length === 1 ? "option" : "options" }}
          </v-chip>
        </button>
      </div>
    </section>

    <section
      class="project-type-setup__technology-section"
      :aria-labelledby="selectedApplicationType ? technologyHeadingId : undefined"
    >
      <div
        v-if="selectedApplicationType"
        class="project-type-setup__technology-heading"
      >
        <div class="project-type-setup__technology-copy">
          <p class="project-type-setup__section-kicker">Step 2</p>
          <h3 :id="technologyHeadingId">Choose technology for {{ selectedApplicationType.label }}</h3>
          <p class="project-type-setup__technology-description">{{ selectedApplicationType.description }}</p>
        </div>
        <div class="project-type-setup__selected-type">
          <span class="project-type-setup__selected-type-label">Selected app type</span>
          <span class="project-type-setup__selected-type-name">{{ selectedApplicationType.label }}</span>
        </div>
      </div>

      <div class="project-type-setup__options">
        <article
          v-for="projectType in adapterChoices"
          :key="projectType.id"
          class="project-type-setup__option"
          :title="projectType.label"
        >
          <div class="project-type-setup__option-top">
            <div>
              <p class="project-type-setup__option-kicker">{{ projectType.id }}</p>
              <h3 class="project-type-setup__option-title">{{ projectType.label }}</h3>
            </div>
            <v-chip
              color="success"
              density="comfortable"
              size="small"
              variant="tonal"
            >
              Ready
            </v-chip>
          </div>

          <p class="project-type-setup__summary">
            {{ adapterSummary(projectType) }}
          </p>

          <dl class="project-type-setup__details">
            <div>
              <dt>Best for</dt>
              <dd>{{ projectType.bestFor || "Project-specific AI Studio workflows." }}</dd>
            </div>
            <div>
              <dt>End result</dt>
              <dd>{{ projectType.outcome || "Studio will use this adapter once it is implemented." }}</dd>
            </div>
          </dl>

          <div
            v-if="projectType.techStack.length"
            class="project-type-setup__stack"
            aria-label="Technology stack"
          >
            <v-chip
              v-for="tech in projectType.techStack"
              :key="tech"
              class="project-type-setup__stack-chip"
              density="comfortable"
              size="small"
              variant="tonal"
            >
              {{ tech }}
            </v-chip>
          </div>

          <div class="project-type-setup__option-actions">
            <a
              v-if="projectType.projectUrl"
              class="project-type-setup__project-link"
              :href="projectType.projectUrl"
              rel="noreferrer"
              target="_blank"
            >
              <span>{{ projectType.projectUrlLabel || "Open project" }}</span>
              <v-icon :icon="mdiOpenInNew" size="16" />
            </a>
            <span v-else class="project-type-setup__project-link project-type-setup__project-link--empty">
              Project link coming later
            </span>

            <v-btn
              color="primary"
              variant="flat"
              :disabled="saving"
              :loading="savingType === projectType.id"
              @click="emit('select', projectType.id)"
            >
              Use {{ projectType.label }}
            </v-btn>
          </div>
        </article>
      </div>
    </section>
  </section>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import {
  mdiOpenInNew
} from "@mdi/js";

const props = defineProps({
  savingType: {
    type: String,
    default: ""
  },
  state: {
    type: Object,
    default: () => ({})
  }
});

const emit = defineEmits(["select"]);
const selectedApplicationTypeId = ref("");
const applicationHeadingId = "project-type-setup-application-heading";
const technologyHeadingId = "project-type-setup-technology-heading";

const saving = computed(() => Boolean(props.savingType));
const headingMessage = computed(() => {
  if (props.state?.status && props.state.status !== "missing" && props.state.message) {
    return props.state.message;
  }
  return "Choose the kind of app first, then pick the technology Studio and Codex should use for it.";
});

const projectTypes = computed(() => {
  return Array.isArray(props.state?.availableProjectTypes)
    ? props.state.availableProjectTypes
        .map(normalizeProjectType)
        .filter((projectType) => projectType.enabled === true)
    : [];
});

const applicationTypes = computed(() => {
  return Array.isArray(props.state?.availableApplicationTypes)
    ? props.state.availableApplicationTypes
        .map(normalizeApplicationType)
        .filter((applicationType) => applicationType.adapters.length > 0)
    : [];
});
const hasApplicationTypes = computed(() => applicationTypes.value.length > 0);
const selectedApplicationType = computed(() => {
  return applicationTypes.value.find((applicationType) => applicationType.id === selectedApplicationTypeId.value) ||
    applicationTypes.value[0] ||
    null;
});
const adapterChoices = computed(() => {
  return selectedApplicationType.value
    ? selectedApplicationType.value.adapters
    : projectTypes.value;
});

function normalizeProjectType(projectType = {}) {
  return {
    ...projectType,
    applicationTypeId: String(projectType.applicationTypeId || ""),
    explanation: String(projectType.explanation || ""),
    techStack: Array.isArray(projectType.techStack) ? projectType.techStack : []
  };
}

function normalizeApplicationType(applicationType = {}) {
  return {
    ...applicationType,
    adapters: Array.isArray(applicationType.adapters)
      ? applicationType.adapters.map(normalizeProjectType)
      : [],
    iconPaths: Array.isArray(applicationType.iconPaths) ? applicationType.iconPaths : [],
    iconViewBox: String(applicationType.iconViewBox || "0 0 64 64")
  };
}

function adapterSummary(projectType = {}) {
  return projectType.explanation ||
    projectType.summary ||
    projectType.description ||
    "A configured AI Studio adapter for this project type.";
}

function selectApplicationType(applicationTypeId) {
  selectedApplicationTypeId.value = String(applicationTypeId || "");
}

watch(applicationTypes, (nextApplicationTypes) => {
  if (
    nextApplicationTypes.length > 0 &&
    !nextApplicationTypes.some((applicationType) => applicationType.id === selectedApplicationTypeId.value)
  ) {
    selectedApplicationTypeId.value = nextApplicationTypes[0].id;
  }
}, {
  immediate: true
});
</script>

<style scoped>
.project-type-setup {
  display: grid;
  gap: 1rem;
  margin-inline: auto;
  max-width: 82rem;
}

.project-type-setup__heading {
  display: grid;
  gap: 0.25rem;
  max-width: 58rem;
}

.project-type-setup__eyebrow,
.project-type-setup__section-kicker,
.project-type-setup__option-kicker {
  color: rgba(var(--v-theme-on-surface), 0.56);
  font-size: 0.72rem;
  font-weight: 750;
  letter-spacing: 0.06em;
  line-height: 1.1;
  margin: 0;
  text-transform: uppercase;
}

.project-type-setup__title {
  font-size: clamp(1.55rem, 2.4vw, 2.2rem);
  font-weight: 760;
  letter-spacing: 0;
  line-height: 1.08;
  margin: 0;
}

.project-type-setup__message,
.project-type-setup__technology-description {
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.98rem;
  line-height: 1.45;
  margin: 0;
}

.project-type-setup__application-section {
  display: grid;
  gap: 0.75rem;
}

.project-type-setup__application-heading {
  display: grid;
  gap: 0.2rem;
}

.project-type-setup__application-heading h3 {
  font-size: 1.1rem;
  font-weight: 760;
  letter-spacing: 0;
  line-height: 1.12;
  margin: 0;
}

.project-type-setup__application-grid {
  display: grid;
  gap: 0.75rem;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr));
}

.project-type-setup__application-card {
  align-content: start;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
  color: rgb(var(--v-theme-on-surface));
  cursor: pointer;
  display: grid;
  font: inherit;
  gap: 0.55rem;
  min-height: 13.5rem;
  padding: 1rem;
  text-align: left;
}

.project-type-setup__application-card:hover,
.project-type-setup__application-card--selected {
  border-color: rgba(var(--v-theme-primary), 0.56);
}

.project-type-setup__application-card--selected {
  background: rgba(var(--v-theme-primary), 0.06);
}

.project-type-setup__application-icon {
  color: rgb(var(--v-theme-primary));
  height: 4.8rem;
  width: 4.8rem;
}

.project-type-setup__application-label {
  font-size: 1.1rem;
  font-weight: 760;
  line-height: 1.15;
}

.project-type-setup__application-summary {
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.88rem;
  line-height: 1.35;
}

.project-type-setup__application-count {
  justify-self: start;
}

.project-type-setup__technology-section {
  background: rgba(var(--v-theme-primary), 0.035);
  border-top: 3px solid rgba(var(--v-theme-primary), 0.34);
  display: grid;
  gap: 0.9rem;
  margin-top: 0.35rem;
  padding: 1rem 0 0;
}

.project-type-setup__technology-heading {
  align-items: start;
  display: flex;
  gap: 1rem;
  justify-content: space-between;
}

.project-type-setup__technology-heading h3 {
  font-size: 1.25rem;
  font-weight: 760;
  letter-spacing: 0;
  line-height: 1.12;
  margin: 0;
}

.project-type-setup__technology-copy {
  display: grid;
  gap: 0.2rem;
  max-width: 54rem;
}

.project-type-setup__selected-type {
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-primary), 0.32);
  border-radius: 8px;
  display: grid;
  gap: 0.18rem;
  min-width: 13rem;
  padding: 0.7rem 0.85rem;
}

.project-type-setup__selected-type-label {
  color: rgba(var(--v-theme-on-surface), 0.56);
  font-size: 0.72rem;
  font-weight: 760;
  letter-spacing: 0.04em;
  line-height: 1.15;
  text-transform: uppercase;
}

.project-type-setup__selected-type-name {
  color: rgb(var(--v-theme-primary));
  font-size: 1rem;
  font-weight: 780;
  line-height: 1.2;
}

.project-type-setup__options {
  display: grid;
  gap: 0.85rem;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 24rem), 1fr));
}

.project-type-setup__option {
  align-content: start;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
  display: grid;
  gap: 0.8rem;
  min-height: 100%;
  padding: 1rem;
}

.project-type-setup__option-top,
.project-type-setup__option-actions {
  align-items: center;
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
}

.project-type-setup__option-title {
  font-size: 1.18rem;
  font-weight: 760;
  letter-spacing: 0;
  line-height: 1.12;
  margin: 0;
}

.project-type-setup__summary {
  color: rgb(var(--v-theme-on-surface));
  font-size: 0.95rem;
  font-weight: 650;
  line-height: 1.38;
  margin: 0;
}

.project-type-setup__details {
  display: grid;
  gap: 0.65rem;
  margin: 0;
}

.project-type-setup__details div {
  display: grid;
  gap: 0.18rem;
}

.project-type-setup__details dt {
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-size: 0.72rem;
  font-weight: 760;
  letter-spacing: 0.04em;
  line-height: 1.15;
  text-transform: uppercase;
}

.project-type-setup__details dd {
  color: rgba(var(--v-theme-on-surface), 0.74);
  font-size: 0.88rem;
  line-height: 1.42;
  margin: 0;
}

.project-type-setup__stack {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.project-type-setup__stack-chip {
  color: rgba(var(--v-theme-on-surface), 0.78);
}

.project-type-setup__project-link {
  align-items: center;
  color: rgb(var(--v-theme-primary));
  display: inline-flex;
  font-size: 0.86rem;
  font-weight: 700;
  gap: 0.25rem;
  min-height: 2.25rem;
  text-decoration: none;
}

.project-type-setup__project-link:hover {
  text-decoration: underline;
}

.project-type-setup__project-link--empty {
  color: rgba(var(--v-theme-on-surface), 0.5);
}

@media (max-width: 700px) {
  .project-type-setup__technology-heading {
    display: grid;
  }

  .project-type-setup__selected-type {
    min-width: 0;
  }

  .project-type-setup__option-actions {
    align-items: stretch;
    flex-direction: column;
  }

  .project-type-setup__project-link {
    min-height: 1.5rem;
  }
}
</style>
