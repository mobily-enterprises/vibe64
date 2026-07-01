<script setup>
import ShellOutlet from "@jskit-ai/shell-web/client/components/ShellOutlet";
import { computed, provide } from "vue";
import SectionContainerShell from "/src/components/SectionContainerShell.vue";
import {
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

const { dashboardSectionLinks } = useVibe64DashboardPage();
const activeSessionNav = computed(() => {
  const nav = props.dashboardContext?.activeSessionNav || null;
  return nav && typeof nav === "object" ? nav : null;
});

provide(VIBE64_ACTIVE_SESSION_NAV_KEY, activeSessionNav);
</script>

<template>
  <SectionContainerShell :mobile-section-links="dashboardSectionLinks">
    <template #tabs>
      <ShellOutlet target="app-dashboard:primary-menu" />
      <ShellOutlet
        target="app-dashboard:active-session-menu"
        :context="{ activeSessionNav: activeSessionNav || {} }"
      />
    </template>

    <slot />
  </SectionContainerShell>
</template>
