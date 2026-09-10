import {
  computed,
  unref
} from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";
import { VIBE64_DATABASE_LAYOUT_CHANGED_EVENT } from "../../shared/events.js";

const DATABASE_API_SUFFIX = "/vibe64/database";
const DATABASE_SURFACE = "app";

function encodeSegment(value = "") {
  return encodeURIComponent(String(value || "").trim());
}

function databaseSessionPath(apiPath = "", sessionId = "", suffix = "") {
  return `${apiPath}/sessions/${encodeSegment(sessionId)}${suffix}`;
}

function useVibe64DatabaseTools({
  active = true,
  projectSlug = "",
  sessionId = ""
} = {}) {
  const paths = usePaths();
  const normalizedSessionId = computed(() => String(unref(sessionId) || "").trim());
  const normalizedProjectSlug = computed(() => String(unref(projectSlug) || "").trim());
  const enabled = computed(() => Boolean(unref(active) && normalizedSessionId.value));
  const apiPath = computed(() => paths.api(DATABASE_API_SUFFIX, {
    surface: DATABASE_SURFACE
  }));
  const sessionPath = computed(() => databaseSessionPath(apiPath.value, normalizedSessionId.value));

  const stateResource = useEndpointResource({
    enabled,
    fallbackLoadError: "The session database workspace could not be loaded.",
    path: computed(() => enabled.value ? sessionPath.value : ""),
    queryKey: computed(() => ["vibe64", "database", normalizedProjectSlug.value, normalizedSessionId.value, "state"]),
    realtime: {
      event: VIBE64_DATABASE_LAYOUT_CHANGED_EVENT,
      matches: ({ payload = {} } = {}) => (
        payload.projectSlug === normalizedProjectSlug.value && payload.sessionId === normalizedSessionId.value
      )
    },
    requestRecoveryLabel: "Session database"
  });

  function databaseCommand({
    fallback,
    method = "POST",
    placement,
    success = "Completed.",
    suppressSuccessMessage = false
  } = {}) {
    return useCommand({
      access: "never",
      apiSuffix: DATABASE_API_SUFFIX,
      buildCommandOptions: (_input, { context }) => ({
        method: context.method || method,
        path: context.path || sessionPath.value
      }),
      buildRawPayload: (_model, { context }) => context.payload || {},
      fallbackRunError: fallback,
      messages: {
        error: fallback,
        success
      },
      ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
      placementSource: `vibe64.database.${placement}`,
      suppressSuccessMessage,
      surfaceId: DATABASE_SURFACE,
      writeMethod: method
    });
  }

  const refreshCommand = databaseCommand({
    fallback: "The database schema could not be refreshed.",
    placement: "schema.refresh",
    success: "Database schema refreshed."
  });
  const queryCommand = databaseCommand({
    fallback: "The SQL statement could not be run.",
    placement: "query.run",
    success: "SQL statement completed."
  });
  const defaultQueryCommand = databaseCommand({
    fallback: "The table data could not be loaded.",
    placement: "query.default",
    suppressSuccessMessage: true
  });
  const cancelCommand = databaseCommand({
    fallback: "The database query could not be cancelled.",
    placement: "query.cancel",
    suppressSuccessMessage: true
  });
  const updateCommand = databaseCommand({
    fallback: "The database value could not be saved.",
    method: "PATCH",
    placement: "cell.update",
    success: "Database value saved."
  });
  const insertCommand = databaseCommand({
    fallback: "The database row could not be inserted.",
    placement: "row.insert",
    success: "Database row inserted."
  });
  const deleteCommand = databaseCommand({
    fallback: "The database row could not be deleted.",
    placement: "row.delete",
    success: "Database row deleted."
  });
  const lookupCommand = databaseCommand({
    fallback: "The lookup table could not be searched.",
    placement: "lookup.search",
    suppressSuccessMessage: true
  });
  const layoutCommand = databaseCommand({
    fallback: "The ERD layout could not be saved.",
    method: "PUT",
    placement: "layout.save",
    suppressSuccessMessage: true
  });
  const overviewCommand = databaseCommand({
    fallback: "The main actor grouping could not be saved.",
    method: "PUT",
    placement: "overview.save",
    success: "Main actors saved in project source."
  });
  const snippetCommand = databaseCommand({
    fallback: "The SQL snippet could not be saved.",
    method: "PUT",
    placement: "snippet.save",
    success: "SQL snippet saved."
  });
  const snippetDeleteCommand = databaseCommand({
    fallback: "The SQL snippet could not be deleted.",
    method: "DELETE",
    placement: "snippet.delete",
    success: "SQL snippet deleted."
  });
  const assistantCommand = databaseCommand({
    fallback: "The database copilot could not answer.",
    placement: "assistant.ask",
    suppressSuccessMessage: true
  });

  async function reload() {
    if (enabled.value) return stateResource.reload();
  }

  async function refreshSchema() {
    const result = await refreshCommand.run({
      path: `${sessionPath.value}/schema/refresh`
    });
    await reload();
    return result;
  }

  function runQuery(payload = {}) {
    const command = payload.automatic === true
      ? defaultQueryCommand
      : queryCommand;
    return command.run({
      path: `${sessionPath.value}/queries`,
      payload
    });
  }

  function cancelQuery(queryId = "") {
    return cancelCommand.run({
      path: `${sessionPath.value}/queries/${encodeSegment(queryId)}/cancel`
    });
  }

  function updateCell(payload = {}) {
    return updateCommand.run({
      path: `${sessionPath.value}/cells`,
      payload
    });
  }

  function insertRow(payload = {}) {
    return insertCommand.run({
      path: `${sessionPath.value}/rows`,
      payload
    });
  }

  function deleteRow(payload = {}) {
    return deleteCommand.run({
      path: `${sessionPath.value}/rows/delete`,
      payload
    });
  }

  function searchLookup(payload = {}) {
    return lookupCommand.run({
      path: `${sessionPath.value}/lookups/search`,
      payload
    });
  }

  function saveLayout(layout = {}) {
    return layoutCommand.run({
      path: `${sessionPath.value}/layout`,
      payload: { layout }
    });
  }

  async function saveOverview(payload) {
    const result = await overviewCommand.run({ path: `${sessionPath.value}/overview`, payload });
    if (result?.ok !== false) await reload();
    return result;
  }

  function saveSnippet(snippet = {}) {
    return snippetCommand.run({
      path: `${sessionPath.value}/snippets`,
      payload: { snippet }
    });
  }

  function deleteSnippet(snippetId = "") {
    return snippetDeleteCommand.run({
      method: "DELETE",
      path: `${sessionPath.value}/snippets/${encodeSegment(snippetId)}`
    });
  }

  function askAssistant(messages = []) {
    return assistantCommand.run({
      path: `${sessionPath.value}/assistant`,
      payload: { messages }
    });
  }

  return {
    askAssistant,
    assistantBusy: computed(() => assistantCommand.isRunning === true),
    cancelQuery,
    cancelling: computed(() => cancelCommand.isRunning === true),
    deleteRow,
    deleteSnippet,
    deleting: computed(() => deleteCommand.isRunning === true),
    error: stateResource.loadError,
    insertRow,
    inserting: computed(() => insertCommand.isRunning === true),
    layoutSaving: computed(() => layoutCommand.isRunning === true),
    loading: stateResource.isLoading,
    lookupBusy: computed(() => lookupCommand.isRunning === true),
    refreshSchema,
    refreshing: computed(() => refreshCommand.isRunning === true),
    reload,
    runQuery,
    running: computed(() => (
      queryCommand.isRunning === true || defaultQueryCommand.isRunning === true
    )),
    saveLayout,
    saveOverview,
    saveSnippet,
    searchLookup,
    state: computed(() => stateResource.data.value || null),
    updateCell,
    updating: computed(() => updateCommand.isRunning === true)
  };
}

export {
  DATABASE_API_SUFFIX,
  databaseSessionPath,
  useVibe64DatabaseTools
};
