import { computed, ref } from "vue";

import { databaseClientDialect } from "../databaseDialect.js";
import { defaultTableQuery } from "../../shared/sqlQuoting.js";

const REPLAY_SAFE_COMMANDS = new Set(["DESC", "DESCRIBE", "EXPLAIN", "SELECT", "SHOW"]);
const NUMERIC_TYPE = /^(?:smallint|integer|bigint|decimal|numeric|real|double|float|int|tinyint|mediumint)/iu;

/**
 * A column name quoted as an identifier for the engine.
 * @param {string} name
 * @param {string} engine
 */
function quoteIdentifier(name, engine) {
  return databaseClientDialect(engine).quoteIdentifier(name);
}

/**
 * A filter value as a SQL literal: a number for a numeric column, TRUE or FALSE for a boolean one, otherwise a
 * string literal quoted for the engine.
 * @param {unknown} value
 * @param {{ dataType?: string, nativeType?: string }} column
 * @param {string} engine
 */
function sqlLiteral(value, column, engine) {
  const raw = String(value ?? "");
  const type = column.dataType || column.nativeType;
  if (NUMERIC_TYPE.test(type) && /^-?(?:\d+\.?\d*|\.\d+)$/u.test(raw.trim())) return raw.trim();
  if (/^(?:boolean|bool)/iu.test(type) && /^(?:true|false)$/iu.test(raw.trim())) return raw.trim().toUpperCase();
  return databaseClientDialect(engine).stringLiteral(raw);
}

/**
 * A table's default query with one WHERE predicate per filter, joined by AND.
 * @param {Record<string, any>} table
 * @param {Array<{ column: string, operator: string, value: string }>} filters
 * @param {string} engine
 */
function filteredTableSql(table, filters, engine) {
  const predicates = filters.map((filter) => {
    const column = table.columns.find((candidate) => candidate.name === filter.column) || {};
    return filter.operator.startsWith("IS ")
      ? `${quoteIdentifier(filter.column, engine)} ${filter.operator}`
      : `${quoteIdentifier(filter.column, engine)} ${filter.operator} ${sqlLiteral(filter.value, column, engine)}`;
  });
  const where = predicates.length ? `\nWHERE ${predicates.join("\n  AND ")}` : "";
  return `${defaultTableQuery(table, engine).replace(/;$/u, "")}${where};`;
}

/**
 * The Data view's table queries. Opening a table the first time runs its default read-only SELECT; each table keeps
 * its SQL draft, filters and last result while the workspace stays mounted, so returning to it runs nothing.
 * Copilot SQL, a snippet or a history entry put into the editor waits for Run.
 * @param {{
 *   activeView: import("vue").Ref<string>,
 *   cancelQuery: (queryId: string) => Promise<unknown>,
 *   connection: import("vue").ComputedRef<Record<string, any>>,
 *   reload: () => Promise<unknown>,
 *   runQuery: (request: Record<string, unknown>) => Promise<Record<string, any> | null>,
 *   running: import("vue").Ref<boolean>,
 *   schema: import("vue").ComputedRef<Record<string, any>>
 * }} options
 */
function useDatabaseTableQueries({ activeView, cancelQuery, connection, reload, runQuery, running, schema }) {
  const selectedTableName = ref("");
  const sqlText = ref("");
  const queryResult = ref(null);
  const activeQueryId = ref("");
  const resultSearch = ref("");
  const filters = ref([]);
  const tableQueryStates = new Map();

  const selectedTable = computed(() => schema.value.tables.find((table) => table.qualifiedName === selectedTableName.value) || null);
  const currentQueryIsDefault = computed(() => Boolean(
    selectedTable.value && sqlText.value.trim() === defaultTableSql(selectedTable.value)
  ));

  /**
   * @param {Record<string, any>} table
   */
  function defaultTableSql(table) {
    return defaultTableQuery(table, schema.value.engine);
  }

  /**
   * Keeps the selected table's draft, filters and result for when it is opened again.
   */
  function rememberSelectedTableState() {
    if (!selectedTableName.value) return;
    tableQueryStates.set(selectedTableName.value, {
      filters: filters.value.map((filter) => ({ ...filter })),
      queryResult: queryResult.value,
      sqlText: sqlText.value
    });
  }

  /**
   * Shows a table in Data: its remembered draft and result, or, the first time, its default query's result.
   * @param {Record<string, any>} table
   * @param {{ rememberCurrent?: boolean }} [options]
   */
  async function openTable(table, { rememberCurrent = true } = {}) {
    if (!table.qualifiedName || running.value) return;
    if (rememberCurrent) rememberSelectedTableState();
    selectedTableName.value = table.qualifiedName;
    resultSearch.value = "";
    activeView.value = "data";
    const saved = tableQueryStates.get(table.qualifiedName);
    if (saved) {
      filters.value = saved.filters.map((filter) => ({ ...filter }));
      sqlText.value = saved.sqlText;
      queryResult.value = saved.queryResult;
      return;
    }
    filters.value = [];
    sqlText.value = defaultTableSql(table);
    queryResult.value = null;
    await executeQuery({ automatic: true });
  }

  /**
   * @param {Record<string, any>} table
   */
  function selectTable(table) {
    return openTable(table);
  }

  /**
   * Leaves Data with no selected table, draft, result or filters.
   */
  function clearSelectedTable() {
    selectedTableName.value = "";
    sqlText.value = "";
    queryResult.value = null;
    filters.value = [];
  }

  /**
   * Forgets every table's remembered query, for another session.
   */
  function forgetTableQueries() {
    tableQueryStates.clear();
    clearSelectedTable();
  }

  /**
   * Puts saved or historical SQL into the editor and shows Data, without running it.
   * @param {string} value
   */
  function loadSql(value) {
    filters.value = [];
    sqlText.value = String(value || "");
    activeView.value = "data";
    rememberSelectedTableState();
  }

  /**
   * @param {string} value
   */
  function updateSqlText(value) {
    sqlText.value = String(value || "");
    rememberSelectedTableState();
  }

  /**
   * Puts the copilot's SQL into the editor and shows Data, without running it.
   * @param {string} sql
   */
  function useAssistantSql(sql) {
    filters.value = [];
    updateSqlText(sql);
    activeView.value = "data";
  }

  /**
   * Drops the selected table's filters and draft and runs its default query again.
   */
  async function resetTableQuery() {
    if (!selectedTable.value || running.value) return;
    filters.value = [];
    resultSearch.value = "";
    sqlText.value = defaultTableSql(selectedTable.value);
    queryResult.value = null;
    tableQueryStates.delete(selectedTable.value.qualifiedName);
    await executeQuery({ automatic: true });
  }

  /**
   * Writes the selected table's default query with the current filters into the editor.
   */
  function regenerateFilteredSql() {
    if (!selectedTable.value) return;
    sqlText.value = filteredTableSql(selectedTable.value, filters.value, schema.value.engine);
    rememberSelectedTableState();
  }

  /**
   * @param {{ column: string, operator: string, value: string }} filter
   */
  function addFilter(filter) {
    filters.value.push({ id: crypto.randomUUID(), ...filter });
    regenerateFilteredSql();
  }

  /**
   * @param {string} id
   */
  function removeFilter(id) {
    filters.value = filters.value.filter((filter) => filter.id !== id);
    regenerateFilteredSql();
  }

  /**
   * Runs the editor's SQL as written, writes included.
   */
  async function requestRun() {
    if (!sqlText.value.trim() || running.value) return;
    await executeQuery();
  }

  /**
   * Runs the editor's SQL. An automatic run (a table's own default query) is read-only and reloads nothing; any
   * other run reloads the workspace state afterwards.
   * @param {{ automatic?: boolean }} [options]
   */
  async function executeQuery({ automatic = currentQueryIsDefault.value } = {}) {
    const queryId = crypto.randomUUID();
    const querySql = sqlText.value;
    activeQueryId.value = queryId;
    try {
      const result = await runQuery({
        automatic,
        confirmationDatabase: connection.value.database,
        confirmed: true,
        queryId,
        readOnly: automatic,
        sql: querySql,
        writeUnlocked: true
      });
      if (result) {
        queryResult.value = result;
        rememberSelectedTableState();
      }
      if (!automatic) await reload();
    } finally {
      if (activeQueryId.value === queryId) activeQueryId.value = "";
    }
  }

  async function cancelActiveQuery() {
    if (activeQueryId.value) await cancelQuery(activeQueryId.value);
  }

  /**
   * Shows the rows again after a row changed: re-runs the editor's SQL only when its result came from a statement
   * that is safe to repeat, otherwise clears the result and reloads the workspace state.
   */
  async function refreshVisibleRows() {
    if (
      queryResult.value?.kind === "result-set" &&
      REPLAY_SAFE_COMMANDS.has(String(queryResult.value.command || "").toUpperCase()) &&
      sqlText.value.trim()
    ) {
      await executeQuery();
      return;
    }
    queryResult.value = null;
    await reload();
  }

  return {
    activeQueryId,
    addFilter,
    cancelActiveQuery,
    clearSelectedTable,
    filters,
    forgetTableQueries,
    loadSql,
    openTable,
    queryResult,
    refreshVisibleRows,
    rememberSelectedTableState,
    removeFilter,
    requestRun,
    resetTableQuery,
    resultSearch,
    selectTable,
    selectedTable,
    selectedTableName,
    sqlText,
    updateSqlText,
    useAssistantSql
  };
}

export { useDatabaseTableQueries };
