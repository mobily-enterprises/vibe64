import { computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  normalizeVibe64SessionArchiveTab
} from "@/lib/vibe64SessionViewModel.js";

function useVibe64DashboardHistoryPage() {
  const route = useRoute();
  const router = useRouter();

  function replaceTabQuery(archive) {
    void router.replace({
      path: route.path,
      query: {
        ...route.query,
        tab: archive
      }
    });
  }

  const selectedArchive = computed({
    get() {
      return normalizeVibe64SessionArchiveTab(route.query.tab);
    },
    set(value) {
      replaceTabQuery(normalizeVibe64SessionArchiveTab(value));
    }
  });

  watch(
    () => route.query.tab,
    (tab) => {
      const rawTab = firstQueryValue(tab);
      const normalizedTab = normalizeVibe64SessionArchiveTab(rawTab);
      if (rawTab !== normalizedTab) {
        replaceTabQuery(normalizedTab);
      }
    },
    { immediate: true }
  );

  return {
    selectedArchive
  };
}

function firstQueryValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

export {
  useVibe64DashboardHistoryPage
};
