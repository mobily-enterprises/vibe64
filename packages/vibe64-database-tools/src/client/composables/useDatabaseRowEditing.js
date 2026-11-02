import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";

import { parsedValue } from "../databaseText.js";
import { cellMetadata, rowDeleteIdentity } from "../queryResultCells.js";

const LOOKUP_DELAY_MS = 220;

/**
 * Changes to the source rows behind the Data view's result: editing one cell, with suggestions from the table its
 * foreign key references; deleting the one source row a result row came from; and inserting a row into the selected
 * table. A change that succeeds calls `changed`, so the caller can show the rows again.
 * @param {{
 *   changed: () => unknown,
 *   deleteRow: (request: Record<string, unknown>) => Promise<unknown>,
 *   insertRow: (request: Record<string, unknown>) => Promise<unknown>,
 *   queryResult: import("vue").Ref<Record<string, any> | null>,
 *   searchLookup: (request: { relationshipId: string, search: string }) => Promise<{ items?: unknown[] } | null>,
 *   selectedTable: import("vue").Ref<Record<string, any> | null>,
 *   updateCell: (request: Record<string, unknown>) => Promise<unknown>
 * }} options
 */
function useDatabaseRowEditing({ changed, deleteRow, insertRow, queryResult, searchLookup, selectedTable, updateCell }) {
  const cellDialog = ref(false);
  const editingCell = ref(null);
  const editingText = ref("");
  const editingNull = ref(false);
  const cellValidationError = ref("");
  const lookupItems = ref([]);
  const lookupSearch = ref("");
  const selectedLookupItem = ref(null);
  const deleteDialog = ref(false);
  const pendingDelete = ref(null);
  const insertDialog = ref(false);
  const insertValues = reactive({});
  const insertIncluded = reactive({});
  const insertValidationError = ref("");
  let lookupTimer = null;

  const editingColumn = computed(() => editingCell.value ? queryResult.value?.columns?.[editingCell.value.columnIndex] : null);
  const insertColumns = computed(() => (selectedTable.value?.columns || []).filter((column) => !column.immutable));
  const hasInsertValues = computed(() => insertColumns.value.some((column) => insertIncluded[column.name]));

  onBeforeUnmount(() => clearTimeout(lookupTimer));

  watch([cellDialog, lookupSearch], ([open]) => {
    clearTimeout(lookupTimer);
    if (!open || !editingColumn.value?.lookup) return;
    lookupTimer = setTimeout(() => void loadLookup(), LOOKUP_DELAY_MS);
  }, { immediate: true });

  watch(selectedLookupItem, (item) => {
    if (!item || !editingColumn.value?.lookup || !editingCell.value) return;
    const lookup = editingColumn.value.lookup;
    const sourceColumn = editingColumn.value.origin?.column;
    const sourceIndex = lookup.sourceColumns.indexOf(sourceColumn);
    const referencedColumn = lookup.referencedColumns[sourceIndex];
    if (referencedColumn && Object.hasOwn(item.keys || {}, referencedColumn)) {
      const value = item.keys[referencedColumn];
      editingNull.value = value == null;
      editingText.value = value == null ? "" : String(value);
    }
  });

  /**
   * Opens the cell editor on a result cell, when the cell is editable.
   * @param {number} rowIndex
   * @param {number} columnIndex
   */
  function openCellEditor(rowIndex, columnIndex) {
    const meta = cellMetadata(queryResult.value, rowIndex, columnIndex);
    if (!meta.editable) return;
    const value = queryResult.value.rows[rowIndex][columnIndex];
    editingCell.value = { columnIndex, meta, rowIndex, value };
    editingNull.value = value === null;
    editingText.value = value == null ? "" : (typeof value === "object" ? JSON.stringify(value, null, 2) : String(value));
    cellValidationError.value = "";
    lookupItems.value = [];
    lookupSearch.value = "";
    selectedLookupItem.value = null;
    cellDialog.value = true;
  }

  async function loadLookup() {
    const lookup = editingColumn.value?.lookup;
    if (!lookup) return;
    const result = await searchLookup({ relationshipId: lookup.relationshipId, search: lookupSearch.value });
    lookupItems.value = result?.items || [];
  }

  async function saveCell() {
    if (!editingCell.value) return;
    cellValidationError.value = "";
    let value;
    try {
      value = editingNull.value ? null : parsedValue(editingText.value, editingCell.value.value, editingColumn.value);
    } catch (error) {
      cellValidationError.value = String(error?.message || "Enter a valid value.");
      return;
    }
    const result = await updateCell({ edit: editingCell.value.meta, value });
    if (!result) return;
    cellDialog.value = false;
    await changed();
  }

  /**
   * Asks to delete a result row's source row, when it came from exactly one.
   * @param {number} rowIndex
   */
  function requestDeleteRow(rowIndex) {
    pendingDelete.value = rowDeleteIdentity(queryResult.value, rowIndex);
    if (pendingDelete.value) deleteDialog.value = true;
  }

  async function confirmDeleteRow() {
    if (!pendingDelete.value) return;
    const result = await deleteRow({ confirmed: true, key: pendingDelete.value.key, table: pendingDelete.value.table });
    if (!result) return;
    deleteDialog.value = false;
    pendingDelete.value = null;
    await changed();
  }

  /**
   * Opens the insert form for the selected table, including each column that has no default and cannot be NULL.
   */
  function openInsertDialog() {
    if (!selectedTable.value) return;
    insertValidationError.value = "";
    for (const column of insertColumns.value) {
      insertValues[column.name] = "";
      insertIncluded[column.name] = !column.nullable && !column.default;
    }
    insertDialog.value = true;
  }

  /**
   * @param {Record<string, any>} column
   */
  function insertValue(column) {
    const value = insertValues[column.name];
    if (value === "" && column.nullable) return null;
    return parsedValue(String(value ?? ""), "", { databaseType: column.nativeType });
  }

  async function saveInsertedRow() {
    insertValidationError.value = "";
    let values;
    try {
      values = Object.fromEntries(insertColumns.value
        .filter((column) => insertIncluded[column.name])
        .map((column) => [column.name, insertValue(column)]));
    } catch (error) {
      insertValidationError.value = String(error?.message || "Enter valid row values.");
      return;
    }
    const result = await insertRow({ table: { name: selectedTable.value.name, schema: selectedTable.value.schema }, values });
    if (!result) return;
    insertDialog.value = false;
    await changed();
  }

  return {
    cellDialog,
    cellValidationError,
    confirmDeleteRow,
    deleteDialog,
    editingColumn,
    editingNull,
    editingText,
    hasInsertValues,
    insertColumns,
    insertDialog,
    insertIncluded,
    insertValidationError,
    insertValues,
    lookupItems,
    lookupSearch,
    openCellEditor,
    openInsertDialog,
    pendingDelete,
    requestDeleteRow,
    saveCell,
    saveInsertedRow,
    selectedLookupItem
  };
}

export { useDatabaseRowEditing };
