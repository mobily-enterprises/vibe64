<script setup>
import ShellOutlet from "@jskit-ai/shell-web/client/components/ShellOutlet";
import { computed, provide } from "vue";
import { useRoute } from "vue-router";
import SectionContainerShell from "/src/components/SectionContainerShell.vue";
import {
  activeSessionMobileSectionLinks,
  useVibe64DashboardPage
} from "@/composables/useVibe64DashboardPage.js";
import {
  VIBE64_ACTIVE_SESSION_NAV_KEY
} from "@/lib/vibe64ActiveSessionNav.js";

const props = defineProps({
  dashboardContext: {
    default: () => ({}),
    type: Object
  }
});

const route = useRoute();
const githubBrowserOpen = computed(() => /\/dashboard\/(issues|pull-requests)\/?$/u.test(route.path));

const { dashboardSectionLinks } = useVibe64DashboardPage({
  dashboardContext: () => props.dashboardContext
});
const activeSessionNav = computed(() => {
  const nav = props.dashboardContext?.activeSessionNav || null;
  return nav && typeof nav === "object" ? nav : null;
});
const mobileDashboardSectionLinks = computed(() => [
  ...dashboardSectionLinks.value,
  ...activeSessionMobileSectionLinks(activeSessionNav.value)
]);

provide(VIBE64_ACTIVE_SESSION_NAV_KEY, activeSessionNav);
</script>

<template>
  <SectionContainerShell :mobile-section-links="mobileDashboardSectionLinks" :navigation-collapsed="githubBrowserOpen">
    <template #tabs>
      <ShellOutlet target="app-dashboard:primary-menu" :context="dashboardContext" />
      <ShellOutlet
        target="app-dashboard:active-session-menu"
        :context="{ activeSessionNav: activeSessionNav || {} }"
      />
    </template>

    <slot />
  </SectionContainerShell>
</template>
