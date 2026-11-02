// What a query result lets a person change: each cell's edit metadata, and the one source row a result row deletes.

/**
 * A result cell's edit metadata: editable with the source it writes, or read-only with the reason.
 * @param {Record<string, any> | null} result
 * @param {number} rowIndex
 * @param {number} columnIndex
 * @returns {Record<string, any>}
 */
function cellMetadata(result, rowIndex, columnIndex) {
  return result?.cellMeta?.[rowIndex]?.[columnIndex] || { editable: false, reason: "This result is read-only." };
}

/**
 * The source row a result row can delete: its table and key when the row came from exactly one source row, else null.
 * @param {Record<string, any> | null} result
 * @param {number} rowIndex
 * @returns {Record<string, any> | null}
 */
function rowDeleteIdentity(result, rowIndex) {
  const sources = result?.rowMeta?.[rowIndex] || [];
  return sources.length === 1 ? sources[0] : null;
}

export {
  cellMetadata,
  rowDeleteIdentity
};
