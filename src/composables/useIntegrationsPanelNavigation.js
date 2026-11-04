import { computed, ref, watch } from "vue";
import { readLocalStorageJson, writeLocalStorageJson } from "@/lib/browserLocalStorage.js";

/**
 * Keeps the Integrations panel where the person left it in this browser: the environment shown for each project, and
 * the integration selected and the search typed for each project, session (or the deployed release) and environment.
 * @param {{
 *   dashboardContext: () => import("@/composables/useVibe64DashboardPage.js").Vibe64DashboardContext,
 *   environment: import("vue").Ref<string>,
 *   projectSlug: import("vue").Ref<string>,
 *   selectedId: import("vue").Ref<string>
 * }} options
 */
function useIntegrationsPanelNavigation({ dashboardContext, environment, projectSlug, selectedId }) {
  const production = computed(() => environment.value === "production");
  watch([projectSlug, () => dashboardContext().productionIntegrationsApiPath], ([slug, apiPath]) => {
    environment.value = apiPath && readLocalStorageJson(`vibe64:integrations:environment:${slug}`, "development") === "production"
      ? "production" : "development";
  }, { immediate: true, flush: "sync" });
  watch(environment, (value) => {
    writeLocalStorageJson(`vibe64:integrations:environment:${projectSlug.value}`, value);
  });
  const search = ref("");
  const navigationKey = computed(() => `vibe64:integrations:${encodeURIComponent(projectSlug.value)}:${production.value ? 'published' : encodeURIComponent(dashboardContext().sessionId || "")}:${environment.value}`);
  watch(navigationKey, (key) => {
    const saved = readLocalStorageJson(key, {});
    selectedId.value = typeof saved?.selectedId === "string" ? saved.selectedId : "";
    search.value = typeof saved?.search === "string" ? saved.search : "";
  }, { immediate: true, flush: "sync" });
  watch([selectedId, search], () => {
    if (production.value || dashboardContext().sessionId) writeLocalStorageJson(navigationKey.value, {
      selectedId: selectedId.value, search: search.value
    });
  });
  return { navigationKey, production, search };
}

export { useIntegrationsPanelNavigation };
