import { inject, onBeforeUnmount, watchEffect } from "vue";
import { VIBE64_COLLEAGUE_DATABASE_KEY } from "/src/lib/vibe64AssistantHost.js";

/**
 * Tells Colleague what the active database workspace shows: its project and session, the selected view, the table
 * Data shows, and whether the workspace is loading, unavailable or open. Colleague can ask it to open a table of
 * the session's snapshot while no query runs. Hiding or removing the workspace withdraws it.
 * @param {{
 *   props: { projectSlug: string, sessionId: string, active: boolean },
 *   activeView: import("vue").Ref<string>,
 *   selectedTable: import("vue").ComputedRef<Record<string, any> | null>,
 *   state: import("vue").Ref<Record<string, any> | null>,
 *   schema: import("vue").ComputedRef<Record<string, any>>,
 *   running: import("vue").Ref<boolean>,
 *   loading: import("vue").Ref<boolean>,
 *   error: import("vue").Ref<string>,
 *   showTable: (table: Record<string, any>) => Promise<void>
 * }} options
 */
function useDatabaseColleagueView({ props, activeView, selectedTable, state, schema, running, loading, error, showTable }) {
  /** @type {import("/src/lib/vibe64AssistantHost.js").ShellSlot<typeof displayedDatabase>} */
  const colleagueDatabase = inject(VIBE64_COLLEAGUE_DATABASE_KEY);
  let disposed = false;
  const displayedDatabase = {
    get projectSlug() { return props.projectSlug; },
    get sessionId() { return props.sessionId; },
    get view() { return activeView.value; },
    get table() { return activeView.value === "data" ? selectedTable.value?.qualifiedName || "" : ""; },
    selectTable(qualifiedName) {
      if (disposed || !props.active || !state.value) throw new Error("Database is not available in this session.");
      const table = schema.value.tables.find(candidate => candidate.qualifiedName === qualifiedName);
      if (!table) throw new Error("The requested table is not in this session’s database snapshot.");
      if (running.value) throw new Error("A query is running. Wait for it to finish or cancel that query before selecting a table.");
      void showTable(table);
    },
    get screen() {
      if (state.value) return "workspace";
      if (loading.value || !error.value) return "loading";
      return "unavailable";
    }
  };
  watchEffect(() => {
    if (props.active) colleagueDatabase.value = displayedDatabase;
    else if (colleagueDatabase.value === displayedDatabase) colleagueDatabase.value = null;
  });
  onBeforeUnmount(() => {
    if (colleagueDatabase.value === displayedDatabase) colleagueDatabase.value = null;
    disposed = true;
  });
}

export { useDatabaseColleagueView };
