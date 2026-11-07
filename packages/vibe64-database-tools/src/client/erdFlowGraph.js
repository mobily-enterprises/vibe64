import { markRaw } from "vue";

import { buildErdNodes, erdColumns } from "../shared/erdModel.js";

// The ERD as Vue Flow draws it: table nodes, relationship edges and their emphasis, built from the shared ERD model
// and the worker's routes.

/**
 * What one table node carries for DatabaseErdNode: the table, the columns it shows, its saved state, its keys, the
 * worker's relationship ports, its emphasis, and the diagram's handlers for its buttons.
 * @typedef {object} ErdNodeData
 * @property {Record<string, any>} table
 * @property {Array<Record<string, any>>} columns
 * @property {string} group
 * @property {string} [groupName]
 * @property {string} [layoutGroup]
 * @property {boolean} collapsed
 * @property {boolean} expanded
 * @property {boolean} pinned
 * @property {"keys" | "all"} columnMode
 * @property {number} keyColumnCount
 * @property {Set<string>} primaryColumns
 * @property {Set<string>} uniqueColumns
 * @property {Set<string>} foreignColumns
 * @property {Array<Record<string, any>>} [relationshipPorts]
 * @property {boolean} [highlighted]
 * @property {boolean} [dimmed]
 * @property {string[]} [highlightedColumns]
 * @property {(id: string) => Promise<void>} onToggle
 * @property {(id: string) => Promise<void>} onExpand
 * @property {(id: string) => Promise<void>} onPin
 */

/**
 * The schema's table nodes, placed and folded as the saved nodes say, each holding the handlers its buttons call.
 * @param {{
 *   tables: Array<Record<string, any>>,
 *   relationships: Array<Record<string, any>>,
 *   saved: Array<Record<string, any>>,
 *   columnMode: "keys" | "all",
 *   groups: Array<{ id: string, name: string }>,
 *   draggable: boolean,
 *   onToggle: (id: string) => Promise<void>,
 *   onExpand: (id: string) => Promise<void>,
 *   onPin: (id: string) => Promise<void>
 * }} graph
 */
function erdFlowNodes({ tables, relationships, saved, columnMode, groups, draggable, onToggle, onExpand, onPin }) {
  return buildErdNodes({ tables, relationships }, {
    nodes: saved, columnMode, groups
  }).map((node) => {
    const { table, columns } = node.data;
    return {
      ...node, type: "table", draggable: draggable && !node.data.pinned, dragHandle: ".database-erd-node header",
      data: {
        ...node.data, table: markRaw(table), columns: markRaw(columns),
        columnMode, keyColumnCount: erdColumns(table, relationships).length,
        primaryColumns: markRaw(new Set((table.keys || []).filter((key) => key.primary).flatMap((key) => key.columns))),
        uniqueColumns: markRaw(new Set((table.keys || []).flatMap((key) => key.columns))),
        foreignColumns: markRaw(new Set(relationships.filter((relationship) => relationship.sourceTable === table.qualifiedName).flatMap((relationship) => relationship.columns))),
        onToggle, onExpand, onPin
      }
    };
  });
}

/**
 * Marks what the selection reaches: the selected or hovered relationship's routes, or the selected table's, their
 * tables and columns, and the searched column. Everything else is dimmed while something is selected. Nodes and
 * edges change in place.
 * @param {Array<Record<string, any>>} nodes
 * @param {Array<Record<string, any>>} edges
 * @param {Array<Record<string, any>>} routes
 * @param {{ selectedTable: string, selectedRelationshipId: string, hoveredRelationshipId: string, searchColumn: string }} selection
 */
function emphasizeErdGraph(nodes, edges, routes, { selectedTable, selectedRelationshipId, hoveredRelationshipId, searchColumn }) {
  const selectedRoutes = routes.filter((route) => selectedRelationshipId ? route.relationshipId === selectedRelationshipId :
    selectedTable && (route.source === selectedTable || route.target === selectedTable));
  const selectedTables = new Set(selectedRoutes.flatMap((route) => [route.source, route.target]));
  if (selectedTable) selectedTables.add(selectedTable);
  const highlighted = hoveredRelationshipId ? routes.filter((route) =>
    route.relationshipId === hoveredRelationshipId || selectedRoutes.includes(route)) : selectedRoutes;
  const highlightedIds = new Set(highlighted.map((route) => route.id));
  const hasSelection = Boolean(selectedRelationshipId || selectedTable);
  const columnsByTable = new Map();
  for (const route of highlighted) {
    for (const [table, column] of [[route.source, route.sourceColumn], [route.target, route.targetColumn]]) {
      if (!columnsByTable.has(table)) columnsByTable.set(table, []);
      if (column) columnsByTable.get(table).push(column);
    }
  }
  // Preserve graph identities: replacing the arrays makes Vue Flow parse every
  // table and connection again for each pointer crossing.
  for (const node of nodes) {
    const columns = columnsByTable.get(node.id) || [];
    if (node.id === selectedTable && searchColumn) columns.push(searchColumn);
    node.data.highlighted = node.id === selectedTable || columnsByTable.has(node.id);
    node.data.dimmed = hasSelection && !selectedTables.has(node.id);
    const previous = node.data.highlightedColumns || [];
    if (previous.length !== columns.length || previous.some((column, index) => column !== columns[index])) node.data.highlightedColumns = columns;
  }
  for (const edge of edges) {
    const active = highlightedIds.has(edge.id);
    edge.selected = edge.data.relationshipId === selectedRelationshipId;
    edge.data.emphasized = active;
    edge.style ||= { stroke: "rgb(var(--v-theme-primary))", strokeDasharray: edge.data.cardinality.optional ? "6 3" : undefined, strokeLinejoin: "round" };
    edge.style.strokeWidth = active ? 2.4 : 1.6;
    edge.style.strokeOpacity = hasSelection && !active ? 0.12 : 0.85;
  }
}

/**
 * One relationship edge per routed column pair, labelled for assistive technology with its columns, cardinality
 * and constraint.
 * @param {Array<Record<string, any>>} routes
 * @param {(id: string) => string} tableName
 */
function erdFlowEdges(routes, tableName) {
  return routes.map((route) => ({
    id: route.id, type: "relationship", source: route.source, target: route.target,
    sourceHandle: route.sourceHandle, targetHandle: route.targetHandle,
    ariaLabel: `${tableName(route.source)}.${route.sourceColumn || "(collapsed)"} → ${tableName(route.target)}.${route.targetColumn || "(collapsed)"}; ${route.cardinality.parent} parent(s) per child; ${route.cardinality.child} children per parent; ${route.relationship.constraintName}`,
    data: { relationshipId: route.relationshipId, points: markRaw(route.points), cardinality: markRaw(route.cardinality) }
  }));
}

/**
 * A shared layout's nodes, keeping the positions of the tables one drag moved, so the drag survives without
 * reverting tables another viewer moved during it.
 * @param {Array<Record<string, any>>} sharedNodes the layout another viewer saved during the drag
 * @param {Array<Record<string, any>>} beforeDrag the nodes as the drag began
 * @param {Array<Record<string, any>>} afterDrag the nodes as the drag ended
 */
function withDraggedPositions(sharedNodes, beforeDrag, afterDrag) {
  const previous = new Map(beforeDrag.map((node) => [node.table, node]));
  const moved = new Map(afterDrag.filter((node) => {
    const before = previous.get(node.table);
    return before && (node.x !== before.x || node.y !== before.y);
  }).map((node) => [node.table, node]));
  return sharedNodes.map((node) => {
    const position = moved.get(node.table);
    return position ? { ...node, x: position.x, y: position.y } : node;
  });
}

/**
 * Whether a saved layout draws the same graph as the diagram's snapshot: the same columns, focus, group filter,
 * groups and nodes. Saved views and the camera do not count.
 * @param {Record<string, any>} layout
 * @param {Record<string, any>} current
 */
function sameErdGraph(layout, current) {
  return ["columnMode", "focusTable", "activeGroup"].every((key) => layout[key] === current[key]) &&
    JSON.stringify(layout.groups) === JSON.stringify(current.groups) &&
    layout.nodes.length === current.nodes.length && layout.nodes.every((node, index) =>
      Object.entries(current.nodes[index]).every(([key, value]) => node[key] === value));
}

export {
  emphasizeErdGraph,
  erdFlowEdges,
  erdFlowNodes,
  sameErdGraph,
  withDraggedPositions
};
