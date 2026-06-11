<template>
  <section class="project-type-setup">
    <section
      v-if="currentStep === 'application' && hasApplicationTypes"
      class="project-type-setup__step"
      :aria-labelledby="applicationHeadingId"
    >
      <div class="project-type-setup__application-heading">
        <p class="project-type-setup__section-kicker">App type</p>
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
        </button>
      </div>

      <div class="project-type-setup__step-actions">
        <v-btn
          class="project-type-setup__next-button"
          color="primary"
          size="large"
          variant="flat"
          :disabled="!selectedApplicationType"
          @click="continueToTechnology"
        >
          Next
        </v-btn>
      </div>
    </section>

    <section
      v-else
      class="project-type-setup__technology-section"
      :aria-labelledby="recommendedAdapter ? technologyHeadingId : undefined"
    >
      <div class="project-type-setup__technology-heading">
        <v-btn
          v-if="hasApplicationTypes"
          class="project-type-setup__back-button"
          color="primary"
          :prepend-icon="mdiArrowLeft"
          size="large"
          variant="outlined"
          @click="returnToApplication"
        >
          Back to app type
        </v-btn>
        <div class="project-type-setup__technology-copy">
          <p class="project-type-setup__section-kicker">Technology</p>
          <h3 :id="technologyHeadingId">{{ recommendedTechnologyHeading }}</h3>
          <p class="project-type-setup__technology-description">{{ recommendedTechnologyDescription }}</p>
        </div>
      </div>

      <div
        v-if="recommendedAdapter"
        class="project-type-setup__recommended"
      >
        <article
          class="project-type-setup__default-option"
          :title="recommendedAdapter.label"
        >
          <div class="project-type-setup__option-top">
            <div>
              <p class="project-type-setup__option-kicker">{{ recommendedAdapter.id }}</p>
              <h3 class="project-type-setup__option-title">{{ recommendedAdapter.label }}</h3>
            </div>
            <v-chip
              color="success"
              density="comfortable"
              size="small"
              variant="tonal"
            >
              Default
            </v-chip>
          </div>

          <p class="project-type-setup__summary">
            {{ adapterSummary(recommendedAdapter) }}
          </p>

          <div class="project-type-setup__details-shell">
            <v-btn
              class="project-type-setup__details-toggle"
              color="primary"
              density="comfortable"
              :append-icon="showRecommendedDetails ? mdiChevronUp : mdiChevronDown"
              variant="text"
              @click="showRecommendedDetails = !showRecommendedDetails"
            >
              {{ showRecommendedDetails ? "Hide details" : "Details" }}
            </v-btn>

            <div
              v-if="showRecommendedDetails"
              class="project-type-setup__details-panel"
            >
              <dl class="project-type-setup__details">
                <div>
                  <dt>Best for</dt>
                  <dd>{{ recommendedAdapter.bestFor || "Project-specific Vibe64 workflows." }}</dd>
                </div>
                <div>
                  <dt>End result</dt>
                  <dd>{{ recommendedAdapter.outcome || "Studio will use this adapter once it is implemented." }}</dd>
                </div>
              </dl>

              <div
                v-if="recommendedAdapter.techStack.length"
                class="project-type-setup__stack"
                aria-label="Technology stack"
              >
                <v-chip
                  v-for="tech in recommendedAdapter.techStack"
                  :key="tech"
                  class="project-type-setup__stack-chip"
                  density="comfortable"
                  size="small"
                  variant="tonal"
                >
                  {{ tech }}
                </v-chip>
              </div>
            </div>
          </div>

          <div class="project-type-setup__option-actions">
            <a
              v-if="recommendedAdapter.projectUrl"
              class="project-type-setup__project-link"
              :href="recommendedAdapter.projectUrl"
              rel="noreferrer"
              target="_blank"
            >
              <span>{{ recommendedAdapter.projectUrlLabel || "Open project" }}</span>
              <v-icon :icon="mdiOpenInNew" size="16" />
            </a>
            <span v-else class="project-type-setup__project-link project-type-setup__project-link--empty">
              Project link coming later
            </span>

            <v-btn
              color="primary"
              variant="flat"
              :disabled="saving"
              :loading="savingType === recommendedAdapter.id"
              @click="selectProjectType(recommendedAdapter.id)"
            >
              Use {{ recommendedAdapter.label }}
            </v-btn>
          </div>
        </article>
      </div>

      <div
        v-if="alternativeAdapters.length"
        class="project-type-setup__alternatives"
      >
        <v-btn
          class="project-type-setup__alternatives-toggle"
          color="primary"
          :append-icon="showAlternatives ? mdiChevronUp : mdiChevronDown"
          variant="outlined"
          @click="showAlternatives = !showAlternatives"
        >
          {{ showAlternatives ? "Hide alternatives" : `Alternatives (${alternativeAdapters.length})` }}
        </v-btn>

        <div
          v-if="showAlternatives"
          class="project-type-setup__options"
        >
          <article
            v-for="projectType in alternativeAdapters"
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
                density="comfortable"
                size="small"
                variant="tonal"
              >
                Alternative
              </v-chip>
            </div>

            <p class="project-type-setup__summary">
              {{ adapterSummary(projectType) }}
            </p>

            <div
              v-if="projectType.techStack.length"
              class="project-type-setup__stack"
              aria-label="Technology stack"
            >
              <v-chip
                v-for="tech in projectType.techStack.slice(0, 5)"
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
                variant="outlined"
                :disabled="saving"
                :loading="savingType === projectType.id"
                @click="selectProjectType(projectType.id)"
              >
                Use {{ projectType.label }}
              </v-btn>
            </div>
          </article>
        </div>
      </div>
    </section>
  </section>
</template>

<script setup>
import {
  mdiArrowLeft,
  mdiChevronDown,
  mdiChevronUp,
  mdiOpenInNew
} from "@mdi/js";
import {
  useProjectTypeSetup
} from "@/composables/useProjectTypeSetup.js";

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
const {
  adapterSummary,
  alternativeAdapters,
  applicationHeadingId,
  applicationTypes,
  continueToTechnology,
  currentStep,
  hasApplicationTypes,
  recommendedAdapter,
  recommendedTechnologyDescription,
  recommendedTechnologyHeading,
  returnToApplication,
  saving,
  selectApplicationType,
  selectedApplicationType,
  selectedApplicationTypeId,
  selectProjectType,
  showAlternatives,
  showRecommendedDetails,
  technologyHeadingId
} = useProjectTypeSetup(props, emit);
</script>

<style scoped>
.project-type-setup {
  display: grid;
  margin-inline: auto;
  max-width: 88rem;
}

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

.project-type-setup__technology-description {
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.98rem;
  line-height: 1.45;
  margin: 0;
}

.project-type-setup__step,
.project-type-setup__technology-section {
  display: grid;
  gap: 1.25rem;
}

.project-type-setup__application-heading {
  display: grid;
  gap: 0.35rem;
}

.project-type-setup__application-heading h3 {
  font-size: clamp(1.25rem, 2.2vw, 1.6rem);
  font-weight: 760;
  letter-spacing: 0;
  line-height: 1.12;
  margin: 0;
}

.project-type-setup__application-grid {
  display: grid;
  gap: 0.85rem;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.project-type-setup__application-card {
  align-items: center;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
  color: rgb(var(--v-theme-on-surface));
  cursor: pointer;
  display: grid;
  font: inherit;
  gap: 0.35rem 1rem;
  grid-template-columns: auto 1fr;
  min-height: 7rem;
  padding: 1.05rem 1.2rem;
  text-align: left;
}

.project-type-setup__application-card:hover {
  border-color: rgba(var(--v-theme-on-surface), 0.34);
}

.project-type-setup__application-card--selected {
  background: rgba(var(--v-theme-primary), 0.055);
  border-color: rgba(var(--v-theme-on-surface), 0.92);
  box-shadow: inset 0 0 0 1px rgba(var(--v-theme-on-surface), 0.92);
}

.project-type-setup__application-icon {
  color: rgb(var(--v-theme-primary));
  grid-row: span 2;
  height: 3rem;
  width: 3rem;
}

.project-type-setup__application-label {
  font-size: clamp(1.1rem, 1.8vw, 1.3rem);
  font-weight: 760;
  line-height: 1.15;
}

.project-type-setup__application-summary {
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.84rem;
  line-height: 1.35;
}

.project-type-setup__step-actions {
  align-items: center;
  border-top: 1px solid rgba(var(--v-theme-primary), 0.26);
  display: flex;
  justify-content: flex-end;
  padding-top: 1.1rem;
}

.project-type-setup__next-button {
  min-width: 11rem;
}

.project-type-setup__technology-section {
  display: grid;
  gap: 1rem;
}

.project-type-setup__technology-heading {
  align-items: start;
  display: grid;
  gap: 0.55rem;
}

.project-type-setup__technology-heading h3 {
  font-size: clamp(1.35rem, 2.4vw, 1.9rem);
  font-weight: 760;
  letter-spacing: 0;
  line-height: 1.12;
  margin: 0;
}

.project-type-setup__technology-copy {
  display: grid;
  gap: 0.25rem;
  max-width: 60rem;
}

.project-type-setup__recommended,
.project-type-setup__alternatives {
  display: grid;
  gap: 0.7rem;
}

.project-type-setup__options {
  display: grid;
  gap: 0.7rem;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 20rem), 1fr));
}

.project-type-setup__default-option,
.project-type-setup__option {
  align-content: start;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
  display: grid;
  gap: 0.85rem;
  min-height: 100%;
  padding: 1.05rem;
}

.project-type-setup__default-option {
  border-color: rgba(var(--v-theme-primary), 0.42);
  box-shadow: 0 1px 0 rgba(var(--v-theme-primary), 0.08), inset 3px 0 0 rgb(var(--v-theme-primary));
  max-width: 46rem;
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

.project-type-setup__details-shell {
  display: grid;
  gap: 0.65rem;
}

.project-type-setup__details-toggle {
  justify-self: start;
  margin-inline-start: -0.25rem;
}

.project-type-setup__details-panel {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  display: grid;
  gap: 0.75rem;
  padding-top: 0.75rem;
}

.project-type-setup__details {
  display: grid;
  gap: 0.65rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
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

.project-type-setup__back-button,
.project-type-setup__alternatives-toggle {
  justify-self: start;
}

@media (max-width: 900px) {
  .project-type-setup__application-grid {
    grid-template-columns: 1fr;
  }

  .project-type-setup__step-actions {
    justify-content: stretch;
  }

  .project-type-setup__next-button {
    inline-size: 100%;
  }
}

@media (max-width: 700px) {
  .project-type-setup {
    max-width: none;
  }

  .project-type-setup__application-card {
    min-height: 5.8rem;
    padding: 0.9rem;
  }

  .project-type-setup__application-icon {
    height: 2.35rem;
    width: 2.35rem;
  }

  .project-type-setup__details {
    grid-template-columns: 1fr;
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
