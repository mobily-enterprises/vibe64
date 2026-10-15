<script setup>
import ShellOutlet from "@jskit-ai/shell-web/client/components/ShellOutlet";
import { computed, provide } from "vue";
import { useRoute } from "vue-router";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { projectSlugFromRoute } from "@/lib/vibe64ProjectScope.js";
import { scopedDevelopmentApiUrl } from "@/lib/studioUrls.js";
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
const incomingPath = computed(() => scopedDevelopmentApiUrl("/api/vibe64/incoming", projectSlugFromRoute(route)));
const incomingQuery = computed(() => ({ sessionId: props.dashboardContext.sessionId, state: "pending", limit: 1 }));
const incoming = useEndpointResource({ path: incomingPath, readQuery: incomingQuery,
  queryKey: computed(() => ["vibe64.incoming", incomingPath.value, "badge", incomingQuery.value]),
  enabled: computed(() => props.dashboardContext.active !== false && Boolean(props.dashboardContext.sessionId) &&
    props.dashboardContext.projectContext?.repositoryMode === "github"),
  queryOptions: { retry: false, staleTime: 30_000, refetchInterval: 60_000 }
});
const incomingCount = computed(() => incoming.loadError.value ? null : incoming.data.value?.pendingCount ?? null);
provide("vibe64.incoming.pendingCount", incomingCount);
const githubBrowserOpen = computed(() => /\/dashboard\/(issues|pull-requests)\/?$/u.test(route.path));

const { dashboardSectionLinks } = useVibe64DashboardPage({
  dashboardContext: () => props.dashboardContext
});
const activeSessionNav = computed(() => {
  const nav = props.dashboardContext?.activeSessionNav || null;
  return nav && typeof nav === "object" ? nav : null;
});
const mobileDashboardSectionLinks = computed(() => [
  ...dashboardSectionLinks.value.map(link => link.id === "vibe64.incoming.link" && incomingCount.value > 0
    ? { ...link, label: `${link.label} (${incomingCount.value})` } : link),
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
