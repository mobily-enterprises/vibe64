<template>
  <section
    class="project-template-setup"
    :aria-busy="loading || applying ? 'true' : 'false'"
    aria-labelledby="project-template-heading"
  >
    <div class="project-template-setup__inner">
      <header class="project-template-setup__hero">
        <div class="project-template-setup__hero-copy">
          <p class="project-template-setup__eyebrow">
            <v-icon :icon="mdiCreationOutline" size="18" />
            <span>Ready-made JSKIT</span>
          </p>
          <h1 id="project-template-heading">Choose how your app should work</h1>
          <p class="project-template-setup__intro">
            Pick the starting point that feels closest. Vibe64 will copy the matching starter repository into this project as one clean first commit, ready for you to make it yours.
          </p>
        </div>
        <div class="project-template-setup__hero-mark" aria-hidden="true">
          <v-icon :icon="mdiRocketLaunchOutline" size="52" />
        </div>
      </header>

      <section class="project-template-setup__choices" aria-labelledby="project-template-choices-heading">
        <div class="project-template-setup__section-heading">
          <div>
            <p class="project-template-setup__section-kicker">Starting points</p>
            <h2 id="project-template-choices-heading">What will people do in your app?</h2>
          </div>
          <p>Choose the closest match. You can change the design and features afterwards.</p>
        </div>

        <div
          v-if="loading"
          class="project-template-setup__grid"
          aria-live="polite"
          aria-label="Loading project templates"
        >
          <article
            v-for="index in 4"
            :key="index"
            class="project-template-card project-template-card--loading"
          >
            <span class="project-template-card__skeleton project-template-card__skeleton--icon" />
            <span class="project-template-card__skeleton project-template-card__skeleton--title" />
            <span class="project-template-card__skeleton project-template-card__skeleton--line" />
            <span class="project-template-card__skeleton project-template-card__skeleton--line-short" />
          </article>
        </div>

        <div v-else class="project-template-setup__grid">
          <button
            v-for="template in templates"
            :key="template.id"
            :aria-describedby="`${template.id}-description`"
            :aria-pressed="selectedTemplateId === template.id"
            :class="[
              'project-template-card',
              `project-template-card--${template.accent}`,
              { 'project-template-card--selected': selectedTemplateId === template.id }
            ]"
            :disabled="applying"
            type="button"
            @click="selectTemplate(template)"
          >
            <span class="project-template-card__top">
              <span class="project-template-card__icon" aria-hidden="true">
                <v-icon :icon="templateIcon(template)" size="52" />
              </span>
              <span
                v-if="selectedTemplateId === template.id"
                class="project-template-card__selected-mark"
                aria-hidden="true"
              >
                <v-icon :icon="mdiCheckCircle" size="26" />
              </span>
            </span>

            <span class="project-template-card__copy">
              <span class="project-template-card__title">{{ template.name }}</span>
              <span class="project-template-card__tagline">{{ template.tagline }}</span>
              <span :id="`${template.id}-description`" class="project-template-card__description">
                {{ template.description }}
              </span>
            </span>

            <span class="project-template-card__capabilities">
              <span
                v-for="capability in template.capabilities"
                :key="capability"
                class="project-template-card__capability"
              >
                {{ capability }}
              </span>
            </span>
          </button>
        </div>
      </section>

      <section class="project-template-setup__action" aria-live="polite">
        <div class="project-template-setup__selection">
          <span
            :class="[
              'project-template-setup__selection-icon',
              selectedTemplate ? `project-template-setup__selection-icon--${selectedTemplate.accent}` : ''
            ]"
            aria-hidden="true"
          >
            <v-icon
              :icon="selectedTemplate ? templateIcon(selectedTemplate) : mdiRocketLaunchOutline"
              size="30"
            />
          </span>
          <span class="project-template-setup__selection-copy">
            <strong v-if="selectedTemplate">
              {{ applying ? `Creating your ${selectedTemplate.name} starting point…` : `${selectedTemplate.name} is ready to go` }}
            </strong>
            <strong v-else>Choose a starting point</strong>
            <span v-if="selectedTemplate">
              {{ applying ? "Getting the repository and creating your first commit." : "Vibe64 will copy the repository into this empty project." }}
            </span>
            <span v-else>Select one of the four options above to continue.</span>
          </span>
        </div>

        <v-btn
          class="project-template-setup__primary-action"
          color="primary"
          :disabled="!selectedTemplate || applying"
          :loading="applying"
          size="x-large"
          variant="flat"
          @click="applySelectedTemplate"
        >
          <span>{{ selectedTemplate ? `Start with ${selectedTemplate.name}` : "Select a starting point" }}</span>
          <v-icon v-if="!applying" :icon="mdiArrowRight" end size="21" />
        </v-btn>
      </section>

      <aside class="project-template-setup__advanced">
        <span class="project-template-setup__advanced-icon" aria-hidden="true">
          <v-icon :icon="mdiTuneVariant" size="32" />
        </span>
        <span class="project-template-setup__advanced-copy">
          <strong>Need a different setup?</strong>
          <span>Choose the technology and configuration yourself, then build an empty app with the existing guided seeding flow.</span>
        </span>
        <v-btn
          class="project-template-setup__advanced-action"
          :disabled="applying"
          :append-icon="mdiArrowRight"
          color="primary"
          size="large"
          variant="outlined"
          @click="openAdvancedSetup"
        >
          Advanced setup
        </v-btn>
      </aside>
    </div>
  </section>
</template>

<script setup>
import {
  useProjectTemplateSetup
} from "@/composables/useProjectTemplateSetup.js";

const props = defineProps({
  applyingTemplateId: {
    default: "",
    type: String
  },
  loading: {
    default: false,
    type: Boolean
  },
  templates: {
    default: () => [],
    type: Array
  }
});
const emit = defineEmits(["advanced", "apply"]);

const {
  applySelectedTemplate,
  applying,
  mdiArrowRight,
  mdiCheckCircle,
  mdiCreationOutline,
  mdiRocketLaunchOutline,
  mdiTuneVariant,
  openAdvancedSetup,
  selectedTemplate,
  selectedTemplateId,
  selectTemplate,
  templateIcon,
  templates
} = useProjectTemplateSetup(props, emit);
</script>

<style scoped>
.project-template-setup {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: clamp(1rem, 2.2vw, 2rem);
}

.project-template-setup__inner {
  display: grid;
  gap: clamp(1rem, 2vw, 1.6rem);
  margin-inline: auto;
  max-width: 76rem;
  padding-bottom: 1rem;
}

.project-template-setup__hero {
  align-items: center;
  background:
    radial-gradient(circle at 92% 10%, rgba(var(--v-theme-primary), 0.2), transparent 32%),
    linear-gradient(145deg, rgba(var(--v-theme-primary), 0.1), rgba(var(--v-theme-surface), 0.96) 58%);
  border: 1px solid rgba(var(--v-theme-primary), 0.2);
  border-radius: 1.75rem;
  display: grid;
  gap: 1.5rem;
  grid-template-columns: minmax(0, 1fr) auto;
  overflow: hidden;
  padding: clamp(1.45rem, 3vw, 2.5rem);
  position: relative;
}

.project-template-setup__hero::after {
  background: rgba(var(--v-theme-primary), 0.08);
  border-radius: 999px;
  content: "";
  height: 11rem;
  pointer-events: none;
  position: absolute;
  right: -4rem;
  top: -5rem;
  width: 11rem;
}

.project-template-setup__hero-copy {
  display: grid;
  gap: 0.65rem;
  max-width: 53rem;
  position: relative;
  z-index: 1;
}

.project-template-setup__eyebrow,
.project-template-setup__section-kicker {
  color: rgb(var(--v-theme-primary));
  font-size: 0.76rem;
  font-weight: 800;
  letter-spacing: 0.09em;
  line-height: 1.2;
  margin: 0;
  text-transform: uppercase;
}

.project-template-setup__eyebrow {
  align-items: center;
  display: inline-flex;
  gap: 0.42rem;
}

.project-template-setup__hero h1 {
  font-size: clamp(1.75rem, 3.8vw, 3rem);
  font-weight: 790;
  letter-spacing: -0.035em;
  line-height: 1.04;
  margin: 0;
  text-wrap: balance;
}

.project-template-setup__intro {
  color: rgba(var(--v-theme-on-surface), 0.72);
  font-size: clamp(1rem, 1.7vw, 1.14rem);
  line-height: 1.55;
  margin: 0;
  max-width: 48rem;
}

.project-template-setup__hero-mark {
  align-items: center;
  background: rgb(var(--v-theme-primary));
  border-radius: 1.45rem;
  box-shadow: 0 1rem 2.5rem rgba(var(--v-theme-primary), 0.24);
  color: rgb(var(--v-theme-on-primary));
  display: flex;
  height: 6rem;
  justify-content: center;
  position: relative;
  transform: rotate(3deg);
  width: 6rem;
  z-index: 1;
}

.project-template-setup__choices {
  display: grid;
  gap: 1rem;
}

.project-template-setup__section-heading {
  align-items: end;
  display: flex;
  gap: 1rem;
  justify-content: space-between;
  padding-inline: 0.25rem;
}

.project-template-setup__section-heading > div {
  display: grid;
  gap: 0.3rem;
}

.project-template-setup__section-heading h2 {
  font-size: clamp(1.2rem, 2vw, 1.55rem);
  font-weight: 760;
  letter-spacing: -0.015em;
  line-height: 1.18;
  margin: 0;
}

.project-template-setup__section-heading > p {
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 0.88rem;
  line-height: 1.4;
  margin: 0;
  max-width: 27rem;
  text-align: right;
}

.project-template-setup__grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.project-template-card {
  --template-accent: 2, 132, 199;
  appearance: none;
  background:
    linear-gradient(145deg, rgba(var(--template-accent), 0.055), transparent 42%),
    rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-border-color), calc(var(--v-border-opacity) + 0.08));
  border-radius: 1.4rem;
  box-shadow: 0 0.35rem 1.25rem rgba(15, 23, 42, 0.055);
  color: rgb(var(--v-theme-on-surface));
  cursor: pointer;
  display: grid;
  font: inherit;
  gap: 1rem;
  min-height: 19rem;
  padding: clamp(1.15rem, 2vw, 1.55rem);
  text-align: left;
  transition: border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease;
}

.project-template-card--violet {
  --template-accent: 124, 58, 237;
}

.project-template-card--amber {
  --template-accent: 217, 119, 6;
}

.project-template-card--emerald {
  --template-accent: 5, 150, 105;
}

.project-template-card:not(:disabled):hover {
  border-color: rgba(var(--template-accent), 0.5);
  box-shadow: 0 0.8rem 2rem rgba(15, 23, 42, 0.1);
  transform: translateY(-3px);
}

.project-template-card:focus-visible {
  outline: 3px solid rgba(var(--v-theme-primary), 0.42);
  outline-offset: 3px;
}

.project-template-card--selected {
  background:
    linear-gradient(145deg, rgba(var(--template-accent), 0.13), rgba(var(--template-accent), 0.025) 55%),
    rgb(var(--v-theme-surface));
  border-color: rgb(var(--template-accent));
  box-shadow: 0 0.8rem 2rem rgba(var(--template-accent), 0.14), inset 0 0 0 1px rgb(var(--template-accent));
}

.project-template-card:disabled {
  cursor: wait;
  opacity: 0.68;
}

.project-template-card__top {
  align-items: flex-start;
  display: flex;
  justify-content: space-between;
}

.project-template-card__icon {
  align-items: center;
  background: rgba(var(--template-accent), 0.12);
  border: 1px solid rgba(var(--template-accent), 0.16);
  border-radius: 1.2rem;
  color: rgb(var(--template-accent));
  display: flex;
  height: 5rem;
  justify-content: center;
  width: 5rem;
}

.project-template-card__selected-mark {
  color: rgb(var(--template-accent));
  display: inline-flex;
}

.project-template-card__copy {
  align-content: start;
  display: grid;
  gap: 0.42rem;
}

.project-template-card__title {
  font-size: clamp(1.35rem, 2vw, 1.65rem);
  font-weight: 790;
  letter-spacing: -0.02em;
  line-height: 1.08;
}

.project-template-card__tagline {
  color: rgb(var(--template-accent));
  font-size: 0.95rem;
  font-weight: 760;
  line-height: 1.3;
}

.project-template-card__description {
  color: rgba(var(--v-theme-on-surface), 0.69);
  font-size: 0.94rem;
  line-height: 1.52;
}

.project-template-card__capabilities {
  align-items: end;
  align-self: end;
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.project-template-card__capability {
  background: rgba(var(--template-accent), 0.09);
  border: 1px solid rgba(var(--template-accent), 0.13);
  border-radius: 999px;
  color: rgba(var(--v-theme-on-surface), 0.78);
  font-size: 0.74rem;
  font-weight: 700;
  line-height: 1.2;
  padding: 0.38rem 0.62rem;
}

.project-template-card--loading {
  cursor: default;
  grid-template-rows: auto auto auto auto;
  min-height: 19rem;
}

.project-template-card__skeleton {
  animation: project-template-pulse 1.4s ease-in-out infinite;
  background: rgba(var(--v-theme-on-surface), 0.09);
  border-radius: 0.6rem;
  display: block;
}

.project-template-card__skeleton--icon {
  border-radius: 1.2rem;
  height: 5rem;
  width: 5rem;
}

.project-template-card__skeleton--title {
  height: 1.65rem;
  margin-top: 0.25rem;
  width: 42%;
}

.project-template-card__skeleton--line,
.project-template-card__skeleton--line-short {
  height: 0.9rem;
  width: 92%;
}

.project-template-card__skeleton--line-short {
  width: 66%;
}

.project-template-setup__action {
  align-items: center;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-primary), 0.24);
  border-radius: 1.25rem;
  box-shadow: 0 0.55rem 1.8rem rgba(15, 23, 42, 0.075);
  display: grid;
  gap: 1rem;
  grid-template-columns: minmax(0, 1fr) auto;
  padding: 1rem 1.1rem;
}

.project-template-setup__selection {
  align-items: center;
  display: flex;
  gap: 0.8rem;
  min-width: 0;
}

.project-template-setup__selection-icon,
.project-template-setup__advanced-icon {
  align-items: center;
  background: rgba(var(--v-theme-primary), 0.1);
  border-radius: 0.9rem;
  color: rgb(var(--v-theme-primary));
  display: flex;
  flex: 0 0 auto;
  height: 3.3rem;
  justify-content: center;
  width: 3.3rem;
}

.project-template-setup__selection-icon--sky {
  background: rgba(2, 132, 199, 0.12);
  color: rgb(2, 132, 199);
}

.project-template-setup__selection-icon--violet {
  background: rgba(124, 58, 237, 0.12);
  color: rgb(124, 58, 237);
}

.project-template-setup__selection-icon--amber {
  background: rgba(217, 119, 6, 0.12);
  color: rgb(217, 119, 6);
}

.project-template-setup__selection-icon--emerald {
  background: rgba(5, 150, 105, 0.12);
  color: rgb(5, 150, 105);
}

.project-template-setup__selection-copy,
.project-template-setup__advanced-copy {
  display: grid;
  gap: 0.18rem;
  min-width: 0;
}

.project-template-setup__selection-copy strong,
.project-template-setup__advanced-copy strong {
  font-size: 0.98rem;
  font-weight: 760;
  line-height: 1.3;
}

.project-template-setup__selection-copy span,
.project-template-setup__advanced-copy span {
  color: rgba(var(--v-theme-on-surface), 0.63);
  font-size: 0.84rem;
  line-height: 1.4;
}

.project-template-setup__primary-action {
  min-width: 13.5rem;
  text-transform: none;
}

.project-template-setup__advanced {
  align-items: center;
  background: rgba(var(--v-theme-on-surface), 0.025);
  border: 1px dashed rgba(var(--v-theme-on-surface), 0.2);
  border-radius: 1.15rem;
  display: grid;
  gap: 0.85rem;
  grid-template-columns: auto minmax(0, 1fr) auto;
  padding: 1rem 1.1rem;
}

.project-template-setup__advanced-icon {
  background: rgba(var(--v-theme-on-surface), 0.075);
  color: rgba(var(--v-theme-on-surface), 0.68);
}

.project-template-setup__advanced-action {
  text-transform: none;
}

@keyframes project-template-pulse {
  0%,
  100% {
    opacity: 0.55;
  }

  50% {
    opacity: 1;
  }
}

@media (max-width: 800px) {
  .project-template-setup__hero {
    grid-template-columns: 1fr;
  }

  .project-template-setup__hero-mark {
    display: none;
  }

  .project-template-setup__section-heading {
    align-items: start;
    flex-direction: column;
  }

  .project-template-setup__section-heading > p {
    text-align: left;
  }

  .project-template-setup__grid {
    grid-template-columns: 1fr;
  }

  .project-template-card {
    min-height: 17rem;
  }
}

@media (max-width: 620px) {
  .project-template-setup {
    padding: 0.75rem;
  }

  .project-template-setup__hero {
    border-radius: 1.25rem;
    padding: 1.25rem;
  }

  .project-template-card {
    border-radius: 1.15rem;
    min-height: 0;
    padding: 1.1rem;
  }

  .project-template-card__icon {
    border-radius: 1rem;
    height: 4.25rem;
    width: 4.25rem;
  }

  .project-template-setup__action,
  .project-template-setup__advanced {
    align-items: stretch;
    grid-template-columns: 1fr;
  }

  .project-template-setup__primary-action,
  .project-template-setup__advanced-action {
    inline-size: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .project-template-card {
    transition: none;
  }

  .project-template-card:not(:disabled):hover {
    transform: none;
  }

  .project-template-card__skeleton {
    animation: none;
  }
}
</style>
