import { computed, ref, watch } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import {
  DEVELOPMENT_DATABASE_ENDPOINT,
  VIBE64_DEVELOPMENT_DATABASE_API_SUFFIX
} from "@/lib/studioGateApi.js";
import { VIBE64_SURFACE_ID } from "@/lib/vibe64RequestConfig.js";

/**
 * The project's development database choice in Project settings: a database per session or one
 * shared by the project, and whether several sessions may use the shared one. A choice can be saved
 * only when it changed and the installation allows it.
 * @param {{
 *   resource: {
 *     data: import("vue").Ref<{ developmentDatabase?: object } | null>,
 *     reload: () => Promise<unknown>
 *   }
 * }} options
 */
function useVibe64DevelopmentDatabaseSettings({ resource }) {
  const scopeDraft = ref("session");
  const sharedSessionsDraft = ref(false);
  const databaseSaveCommand = useCommand({
    access: "never",
    apiSuffix: VIBE64_DEVELOPMENT_DATABASE_API_SUFFIX,
    buildCommandOptions: () => ({
      method: "PUT",
      path: DEVELOPMENT_DATABASE_ENDPOINT
    }),
    buildRawPayload: (_model, { context }) => ({
      scope: context.scope,
      allowSharedDatabaseSessions: context.allowSharedDatabaseSessions
    }),
    fallbackRunError: "Development database choice could not be saved.",
    messages: {
      error: "Development database choice could not be saved.",
      success: "Development database choice saved."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.development-database.scope.save",
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "PUT"
  });

  const developmentDatabase = computed(() => resource.data.value?.developmentDatabase || {});
  const managed = computed(() => developmentDatabase.value.managed === true);
  const canChange = computed(() => developmentDatabase.value.canChange === true);
  const disabledReason = computed(() => String(developmentDatabase.value.disabledReason || ""));
  const sessionScopeOption = computed(() => developmentDatabase.value.options?.session || {});
  const projectScopeOption = computed(() => developmentDatabase.value.options?.project || {});
  const sessionScopeAvailable = computed(() => sessionScopeOption.value.available === true);
  const projectScopeAvailable = computed(() => projectScopeOption.value.available === true);
  const sessionScopeReason = computed(() => String(sessionScopeOption.value.disabledReason || ""));
  const projectScopeReason = computed(() => String(projectScopeOption.value.disabledReason || ""));
  const scopeDraftAvailable = computed(() => (
    scopeDraft.value === "project" ? projectScopeAvailable.value : sessionScopeAvailable.value
  ));
  const databaseSaving = computed(() => databaseSaveCommand.isRunning === true);
  const databaseChanged = computed(() => (
    managed.value && (scopeDraft.value !== developmentDatabase.value.scope ||
      sharedSessionsDraft.value !== (developmentDatabase.value.allowSharedDatabaseSessions === true))
  ));
  const databaseSaveAllowed = computed(() => scopeDraft.value === developmentDatabase.value.scope ||
    canChange.value && scopeDraftAvailable.value);
  watch(() => developmentDatabase.value.allowSharedDatabaseSessions, value => {
    sharedSessionsDraft.value = value === true;
  }, { immediate: true });
  watch(() => developmentDatabase.value.scope, (scope) => {
    if (["project", "session"].includes(scope)) {
      scopeDraft.value = scope;
    }
  }, {
    immediate: true
  });

  async function saveDatabase() {
    if (
      !databaseChanged.value ||
      !databaseSaveAllowed.value ||
      databaseSaving.value
    ) {
      return;
    }
    await databaseSaveCommand.run({
      scope: scopeDraft.value,
      allowSharedDatabaseSessions: sharedSessionsDraft.value
    });
    await resource.reload();
  }

  return {
    databaseChanged,
    databaseSaveAllowed,
    databaseSaving,
    disabledReason,
    managed,
    projectScopeAvailable,
    projectScopeReason,
    saveDatabase,
    scopeDraft,
    sessionScopeAvailable,
    sessionScopeReason,
    sharedSessionsDraft
  };
}

export {
  useVibe64DevelopmentDatabaseSettings
};
