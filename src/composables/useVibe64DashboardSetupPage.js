import { computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  fallbackSetupTab,
  normalizeSetupTab
} from "@/lib/vibe64SetupTabs.js";
import {
  readRefOrGetterValue
} from "@/lib/vueRefOrGetterValue.js";

function useVibe64DashboardSetupPage({
  studioSetupEnabled = true
} = {}) {
  const route = useRoute();
  const router = useRouter();
  const setupTabOptions = computed(() => ({
    studioSetupEnabled: readRefOrGetterValue(studioSetupEnabled) !== false
  }));
  const activeTab = computed(() => normalizeSetupTab(route.query.tab, setupTabOptions.value) || fallbackSetupTab(setupTabOptions.value));

  function tabRoute(tab) {
    return {
      path: route.path,
      query: {
        ...route.query,
        tab
      }
    };
  }

  function selectTab(value, { replace = false } = {}) {
    const tab = normalizeSetupTab(value, setupTabOptions.value) || fallbackSetupTab(setupTabOptions.value);

    if (route.query.tab === tab) {
      return undefined;
    }

    return replace ? router.replace(tabRoute(tab)) : router.push(tabRoute(tab));
  }

  watch(
    () => [
      route.query.tab,
      setupTabOptions.value.studioSetupEnabled ? "studio-setup-enabled" : "studio-setup-disabled"
    ].join("|"),
    () => {
      if (route.query.tab !== activeTab.value) {
        void selectTab(activeTab.value, { replace: true });
      }
    },
    { immediate: true }
  );

  return {
    activeTab,
    selectTab
  };
}

export {
  useVibe64DashboardSetupPage
};
