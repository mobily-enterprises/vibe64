import { computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

const tabs = [
  { label: "Project Setup", value: "project-setup" }
];
const tabValues = new Set(tabs.map((tab) => tab.value));

function useVibe64DashboardSetupPage() {
  const route = useRoute();
  const router = useRouter();
  const activeTab = computed(() => normalizeTab(route.query.tab) || fallbackTab());

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
    const tab = normalizeTab(value) || fallbackTab();

    if (route.query.tab === tab) {
      return undefined;
    }

    return replace ? router.replace(tabRoute(tab)) : router.push(tabRoute(tab));
  }

  watch(
    () => route.query.tab,
    (tab) => {
      if (!normalizeTab(tab)) {
        void selectTab(fallbackTab(), { replace: true });
      }
    },
    { immediate: true }
  );

  return {
    activeTab,
    selectTab
  };
}

function normalizeTab(value) {
  return typeof value === "string" && tabValues.has(value) ? value : "";
}

function fallbackTab() {
  return "project-setup";
}

export {
  useVibe64DashboardSetupPage
};
