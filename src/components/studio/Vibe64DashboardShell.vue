<script setup>
import ShellOutlet from "@jskit-ai/shell-web/client/components/ShellOutlet";
import { computed, provide } from "vue";
import { useRoute } from "vue-router";
import SectionContainerShell from "/src/components/SectionContainerShell.vue";
import {
  activeSessionMobileSectionLinks,
  useVibe64DashboardPage
} from "@/composables/useVibe64DashboardPage.js";
import { VIBE64_ACTIVE_SESSION_NAV_KEY } from "@/lib/vibe64ActiveSessionNav.js";

const props = defineProps({
  dashboardContext: {
    default: () => ({}),
    type: Object
  },
  // No project selected (Learn mode without a practice project): the section
  // list is shown without routing; `section` is the selected section's id.
  noProject: Boolean,
  section: {
    default: "",
    type: String
  }
});
const emit = defineEmits(["select"]);

const route = useRoute();
// The GitHub browser and an open page use the whole panel.
const wideSectionOpen = computed(() => /\/dashboard\/(?:issues|pull-requests|pages\/[^/]+)\/?$/u.test(route.path));

const { dashboardSectionLinks } = useVibe64DashboardPage({
  dashboardContext: () => props.dashboardContext
});
const activeSessionNav = computed(() => {
  const nav = props.dashboardContext?.activeSessionNav || null;
  return nav && typeof nav === "object" ? nav : null;
});
const mobileDashboardSectionLinks = computed(() => props.noProject ? [] : [
  ...dashboardSectionLinks.value,
  ...activeSessionMobileSectionLinks(activeSessionNav.value)
]);

provide(VIBE64_ACTIVE_SESSION_NAV_KEY, activeSessionNav);
</script>

<template>
  <SectionContainerShell
    :mobile-section-links="mobileDashboardSectionLinks"
    :navigation-collapsed="wideSectionOpen"
    navigation-guide-pane="dashboard"
  >
    <template #tabs>
      <span v-if="dashboardSectionLinks.length" class="vibe64-dashboard-nav-group-label">Project</span>
      <template v-if="noProject">
        <v-list-item
          v-for="(link, index) in dashboardSectionLinks"
          :key="link.id"
          :active="link.id === section || (!section && index === 0)"
          :prepend-icon="link.icon || undefined"
          :title="link.label"
          :data-dashboard-section="link.id"
          @click="emit('select', link.id)"
        />
      </template>
      <ShellOutlet v-else target="app-dashboard:primary-menu" :context="dashboardContext" />
      <ShellOutlet
        v-if="!noProject"
        target="app-dashboard:active-session-menu"
        :context="{ activeSessionNav: activeSessionNav || {} }"
      />
    </template>

    <slot />
  </SectionContainerShell>
</template>

<style scoped>
.vibe64-dashboard-nav-group-label {
  color: rgb(var(--v-theme-on-surface-variant));
  font: var(--v64-type-label-md);
  letter-spacing: 0.06em;
  padding: var(--v64-space-1) var(--v64-space-4) var(--v64-space-1);
  text-transform: uppercase;
}
</style>
