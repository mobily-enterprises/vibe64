<template>
  <div class="studio-home-shell-project-controls">
    <v-btn
      v-if="chatColumnVisible"
      class="studio-home-shell-chat-toggle"
      data-vibe64-guide="pane-switch"
      density="comfortable"
      :icon="chatToggleIcon"
      size="small"
      :title="chatToggleTitle"
      type="button"
      variant="tonal"
      :aria-label="chatToggleTitle"
      @click="emit('update:chat-collapsed', !chatCollapsed)"
    />

    <div
      v-if="projectPaneNavigationVisible"
      class="studio-home-shell-project-tabs studio-home-shell-project-tabs--desktop"
      role="tablist"
      aria-label="Project"
    >
      <button
        v-for="tab in projectTabs"
        :key="tab.id"
        class="studio-home-shell-project-tab"
        :class="{ 'studio-home-shell-project-tab--active': projectPane === tab.id }"
        role="tab"
        type="button"
        :data-vibe64-guide="tab.id"
        :aria-label="tab.name"
        :title="tab.name"
        :aria-selected="projectPane === tab.id ? 'true' : 'false'"
        @click="emit('select-pane', tab.id)"
      >
        {{ tab.label }}
      </button>
    </div>
    <!-- The lesson's own on/off flag: a sheet over Preview or Dash, apart from that choice.
         Shown one side at a time (a phone), it is on the step bar instead. -->
    <div v-if="lessonToggleVisible && projectPaneNavigationVisible" class="studio-home-shell-lesson-toggle">
      <Vibe64LessonToggle />
    </div>
    <div
      v-if="projectSlug"
      :id="usageRecordingHostId"
      class="studio-home-shell-usage-recording-host"
    />
    <div
      v-if="previewToolbarHostVisible"
      :id="previewToolbarHostId"
      class="studio-home-shell-preview-toolbar-host"
    />
    <button
      v-if="mobileProjectActionVisible && mobileProjectAction"
      class="studio-home-shell-project-mobile-action"
      data-vibe64-guide="pane-switch"
      type="button"
      :aria-label="mobileProjectAction.ariaLabel"
      :title="mobileProjectAction.name"
      @click="emit('select-pane', mobileProjectAction.pane)"
    >
      <v-icon class="studio-home-shell-project-mobile-action__icon" :icon="mobileProjectAction.icon" size="18" />
      <span class="studio-home-shell-project-mobile-action__label">{{ mobileProjectAction.label }}</span>
      <v-icon class="studio-home-shell-project-mobile-action__chevron" :icon="mdiChevronRight" size="15" />
    </button>
  </div>
</template>

<script setup>
// The project bar's pane controls: the chat toggle, the Preview | Dash switch (one next-pane button on a
// phone), the lesson toggle, and the hosts that the recording indicator and Preview's toolbar fill.
import { mdiChevronRight } from "@mdi/js";
import Vibe64LessonToggle from "@/components/learning/Vibe64LessonToggle.vue";

defineProps({
  chatCollapsed: { default: false, type: Boolean },
  chatColumnVisible: { default: false, type: Boolean },
  chatToggleIcon: { default: "", type: String },
  chatToggleTitle: { default: "", type: String },
  lessonToggleVisible: { default: false, type: Boolean },
  mobileProjectAction: { default: null, type: Object },
  mobileProjectActionVisible: { default: false, type: Boolean },
  previewToolbarHostId: { default: "", type: String },
  previewToolbarHostVisible: { default: false, type: Boolean },
  projectPane: { default: "", type: String },
  projectPaneNavigationVisible: { default: false, type: Boolean },
  projectSlug: { default: "", type: String },
  projectTabs: { default: () => [], type: Array },
  usageRecordingHostId: { default: "", type: String }
});
const emit = defineEmits(["select-pane", "update:chat-collapsed"]);
</script>

<style scoped>
.studio-home-shell-project-controls {
  align-items: center;
  display: flex;
  flex: 0 1 auto;
  gap: 0.45rem;
  min-width: 0;
}

/* M3 tonal icon button: circular, surface-container tone, state layer on
   hover/press. */
.studio-home-shell-chat-toggle {
  background: var(--v64-surface-container-high) !important;
  border: 0;
  border-radius: var(--v64-shape-full);
  box-shadow: none;
  color: var(--v64-on-surface-variant) !important;
  flex: 0 0 auto;
  height: 2.25rem;
  min-height: 2.25rem;
  min-width: 2.25rem;
  transition: background-color var(--v64-duration-short) var(--v64-ease-standard);
  width: 2.25rem;
}

.studio-home-shell-chat-toggle:hover {
  background: color-mix(in srgb, var(--v64-on-surface) 8%, var(--v64-surface-container-high)) !important;
}

/* M3 segmented button: an outlined pill of equal-width segments split by
   hairlines. The selected segment fills with the secondary container and
   gains a check that slides in. */
/* The Lesson toggle stands apart from the Preview | Dash segments: a divider,
   then its own pill. */
.studio-home-shell-lesson-toggle {
  align-items: center;
  border-inline-start: 1px solid var(--v64-outline-variant);
  display: inline-flex;
  flex: 0 0 auto;
  padding-inline-start: var(--studio-home-project-gap);
}

.studio-home-shell-project-tabs {
  border: 1px solid var(--v64-outline);
  border-radius: var(--v64-shape-full);
  display: inline-grid;
  flex: 0 0 auto;
  grid-auto-columns: minmax(5.25rem, 1fr);
  grid-auto-flow: column;
  min-width: 0;
  overflow: hidden;
}

.studio-home-shell-project-tab {
  align-items: center;
  background: transparent;
  border: 0;
  border-inline-start: 1px solid var(--v64-outline);
  color: var(--v64-on-surface);
  cursor: pointer;
  display: inline-flex;
  font: var(--v64-type-label-lg);
  gap: var(--v64-space-1);
  height: 2.25rem;
  justify-content: center;
  letter-spacing: 0.01em;
  min-width: 0;
  padding: 0 var(--v64-space-3);
  position: relative;
  transition:
    background-color var(--v64-duration-short) var(--v64-ease-standard),
    color var(--v64-duration-short) var(--v64-ease-standard);
  white-space: nowrap;
}

.studio-home-shell-project-tab:first-child {
  border-inline-start: 0;
}

.studio-home-shell-project-tab::after {
  background: currentColor;
  content: "";
  inset: 0;
  opacity: 0;
  pointer-events: none;
  position: absolute;
  transition: opacity var(--v64-duration-short) var(--v64-ease-standard);
}

.studio-home-shell-project-tab:hover:not(:disabled)::after {
  opacity: var(--v64-state-hover);
}

.studio-home-shell-project-tab:active:not(:disabled)::after {
  opacity: var(--v64-state-pressed);
}

.studio-home-shell-project-tab:focus-visible {
  outline: var(--v64-focus-ring-width) solid var(--v64-focus-ring-color);
  outline-offset: -4px;
}

.studio-home-shell-project-tab--active {
  background: var(--v64-secondary-container);
  color: var(--v64-on-secondary-container);
  font-weight: 600;
}

.studio-home-shell-project-tab--active::before {
  animation: studio-home-shell-check-in var(--v64-duration-medium) var(--v64-ease-emphasized-decelerate);
  background: currentColor;
  content: "";
  flex: 0 0 auto;
  height: 1.125rem;
  -webkit-mask: var(--studio-home-shell-check) center / contain no-repeat;
  mask: var(--studio-home-shell-check) center / contain no-repeat;
  width: 1.125rem;
}

.studio-home-shell-project-tabs {
  --studio-home-shell-check: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z'/%3E%3C/svg%3E");
}

.studio-home-shell-project-tab:disabled {
  color: color-mix(in srgb, var(--v64-on-surface) 38%, transparent);
  cursor: not-allowed;
}

@keyframes studio-home-shell-check-in {
  from { opacity: 0; width: 0; }
  to { opacity: 1; width: 1.125rem; }
}

.studio-home-shell-preview-toolbar-host {
  align-items: center;
  display: flex;
  flex: 1 1 auto;
  justify-content: flex-start;
  max-width: min(43rem, 54vw);
  min-width: 0;
}

.studio-home-shell-preview-toolbar-host:empty {
  display: none;
}

/* The recording indicator decides wide or compact from this host's width, so
   the width is set here and gives way to the bar, never follows the
   indicator. With nothing to show it stays out of the bar's flow (and gap);
   its live region still announces. */
.studio-home-shell-usage-recording-host {
  align-items: center;
  display: flex;
  flex: 0 1 auto;
  justify-content: flex-end;
  min-width: 0;
  position: absolute;
  width: 0;
}

.studio-home-shell-usage-recording-host:has(.usage-recording-indicator__pill) {
  position: static;
  width: 22rem;
}

/* Phone "next pane" control: an M3 tonal pill button with a 40px target. */
.studio-home-shell-project-mobile-action {
  align-items: center;
  background: var(--v64-secondary-container);
  border: 0;
  border-radius: var(--v64-shape-full);
  color: var(--v64-on-secondary-container);
  cursor: pointer;
  display: none;
  flex: 0 0 auto;
  font: var(--v64-type-label-lg);
  gap: var(--v64-space-1);
  justify-content: center;
  letter-spacing: 0.01em;
  min-height: 2.5rem;
  min-width: 4.5rem;
  padding: 0 var(--v64-space-2) 0 var(--v64-space-4);
  position: relative;
  transition: background-color var(--v64-duration-short) var(--v64-ease-standard);
  white-space: nowrap;
}

.studio-home-shell-project-mobile-action__icon {
  display: none !important;
}

.studio-home-shell-project-mobile-action:hover {
  background: color-mix(in srgb, var(--v64-on-secondary-container) 8%, var(--v64-secondary-container));
}

.studio-home-shell-project-mobile-action:focus-visible {
  outline: var(--v64-focus-ring-width) solid var(--v64-focus-ring-color);
  outline-offset: var(--v64-focus-ring-offset);
}

@media (prefers-reduced-motion: reduce) {
  .studio-home-shell-project-tab--active::before {
    animation: none;
  }
}

@media (max-width: 980px) {
  .studio-home-shell-project-controls {
    display: flex;
    justify-content: flex-end;
    margin-left: auto;
    min-width: 0;
  }

  .studio-home-shell-project-tabs--desktop {
    display: none;
  }

  .studio-home-shell-project-mobile-action {
    display: inline-flex;
  }

  .studio-home-shell-preview-toolbar-host {
    flex: 0 1 auto;
    max-width: min(26rem, 42vw);
  }

  /* One pane control at a time on a narrow bar: the next-pane pill, then
     Preview's controls, which give way first. The Lesson toggle is on the
     step bar here. */
  .studio-home-shell-project-mobile-action { order: 1; }
  .studio-home-shell-preview-toolbar-host { order: 2; }
}

@media (max-width: 600px) {
  .studio-home-shell-project-controls {
    flex: 0 0 auto;
    gap: 0.3rem;
  }

  .studio-home-shell-preview-toolbar-host {
    max-width: min(12rem, 32vw);
  }

  .studio-home-shell-project-mobile-action {
    min-width: 4rem;
    padding-inline: var(--v64-space-3) var(--v64-space-1);
  }

  .studio-home-shell-chat-toggle {
    height: 2.5rem;
    min-height: 2.5rem;
    min-width: 2.5rem;
    width: 2.5rem;
  }
}

/* Narrow phones: the next-pane button is a 40px icon button showing its
   pane's icon instead of "Dashboard ›"/"Preview ›" (its name stays "Go to
   dashboard"/"Go to preview"), which leaves the project name readable beside
   Preview's controls. */
@media (max-width: 480px) {
  .studio-home-shell-project-mobile-action {
    min-width: 2.5rem;
    padding: 0;
    width: 2.5rem;
  }

  .studio-home-shell-project-mobile-action__icon {
    display: inline-flex !important;
  }

  .studio-home-shell-project-mobile-action__label,
  .studio-home-shell-project-mobile-action__chevron {
    display: none !important;
  }
}
</style>
