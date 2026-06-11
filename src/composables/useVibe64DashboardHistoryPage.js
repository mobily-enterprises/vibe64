import { computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

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
      return normalizeArchive(firstQueryValue(route.query.tab));
    },
    set(value) {
      replaceTabQuery(normalizeArchive(value));
    }
  });

  watch(
    () => route.query.tab,
    (tab) => {
      const rawTab = firstQueryValue(tab);
      const normalizedTab = normalizeArchive(rawTab);
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

function normalizeArchive(value) {
  return value === "abandoned" ? "abandoned" : "completed";
}

export {
  useVibe64DashboardHistoryPage
};
