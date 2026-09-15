export const ERD_NODE_WIDTH = 296;
export const ERD_HEADER_HEIGHT = 64;
export const ERD_ROW_HEIGHT = 28;
export const ERD_FOOTER_HEIGHT = 28;
export const ERD_LAYOUT_MAX_BYTES = 4 * 1024 * 1024;

// The browser and agent inspection use the same table rectangles and field ports.
export function createErdNodes(schema, layout) {
  const records = new Map((layout.nodes || []).map((node) => [node.table, node]));
  const nodes = (schema.tables || []).map((table) => {
    const record = records.get(table.qualifiedName) || {};
    const columns = erdColumns(table, schema.relationships, layout.columnMode, record.expanded);
    return {
      id: table.qualifiedName,
      position: { x: record.x || 0, y: record.y || 0 },
      dimensions: { width: ERD_NODE_WIDTH, height: erdNodeHeight(columns, record.collapsed) },
      data: { table, columns, group: record.group || "", collapsed: record.collapsed === true,
        expanded: record.expanded === true, pinned: record.pinned === true }
    };
  });
  const membership = new Map(erdLayoutGroups(nodes, schema.relationships || [])
    .flatMap((group) => group.tables.map((id) => [id, group])));
  for (const node of nodes) {
    node.data.layoutGroup = membership.get(node.id)?.id;
    node.data.groupName = layout.groups?.find((group) => group.id === node.data.group)?.name || membership.get(node.id)?.name;
  }
  return nodes;
}

export function visibleErdNodes(nodes, relationships, layout) {
  const neighbours = erdNeighbours(layout.focusTable, relationships);
  const connected = new Set(relationships.flatMap((relationship) => [relationship.sourceTable, relationship.referencedTable]));
  return nodes.map((node) => ({ ...node, hidden: Boolean(
    (layout.focusTable && !neighbours.has(node.id)) ||
    (layout.activeGroup && layout.activeGroup !== node.data.layoutGroup &&
      !(layout.activeGroup === "erd-related" && connected.has(node.id)))
  ) }));
}

export function erdColumns(table, relationships = [], mode = "keys", expanded = false) {
  if (mode === "all" || expanded) return table.columns || [];
  const names = new Set((table.keys || []).flatMap((key) => key.columns));
  for (const relationship of relationships) {
    if (relationship.sourceTable === table.qualifiedName) {
      for (const name of relationship.columns) names.add(name);
    }
    if (relationship.referencedTable === table.qualifiedName) {
      for (const name of relationship.referencedColumns) names.add(name);
    }
  }
  return (table.columns || []).filter((column) => names.has(column.name));
}

export function erdNodeHeight(columns = [], collapsed = false) {
  return ERD_HEADER_HEIGHT + (collapsed ? 0 : Math.max(1, columns.length) * ERD_ROW_HEIGHT + ERD_FOOTER_HEIGHT);
}

function uniqueColumns(table, columns) {
  return (table?.keys || []).some((key) => key.columns.length > 0 &&
    key.columns.every((column) => columns.includes(column)));
}

export function erdCardinality(relationship, parent, child) {
  const columns = (relationship.columns || []).map((name) => child?.columns?.find((column) => column.name === name));
  const known = columns.length > 0 && columns.every((column) => typeof column?.nullable === "boolean");
  const optional = columns.some((column) => column?.nullable === true);
  const parentMax = uniqueColumns(parent, relationship.referencedColumns || []) ? "1" : "N";
  const parentMin = optional ? "0" : known ? "1" : "?";
  return {
    parent: parentMin === parentMax ? parentMax : `${parentMin}..${parentMax}`,
    child: uniqueColumns(child, relationship.columns || []) ? "0..1" : "0..N",
    optional: optional || !known
  };
}

export function erdNeighbours(table, relationships = []) {
  const ids = new Set(table ? [table] : []);
  for (const relationship of relationships) {
    if (relationship.sourceTable === table) ids.add(relationship.referencedTable);
    if (relationship.referencedTable === table) ids.add(relationship.sourceTable);
  }
  return ids;
}

export function erdSearch(tables = [], search = "") {
  const query = search.trim().toLowerCase();
  if (!query) return [];
  return tables.flatMap((table) => [
    ...(table.qualifiedName.toLowerCase().includes(query) ? [{ table: table.qualifiedName, column: "", title: table.name }] : []),
    ...(table.columns || []).filter((column) => column.name.toLowerCase().includes(query))
      .map((column) => ({ table: table.qualifiedName, column: column.name, title: `${table.name}.${column.name}` }))
  ]).slice(0, 40);
}

// A bounded, deterministic modularity pass finds neighbourhoods without letting
// a shared users table pull the entire database into one very tall layer.
export function erdLayoutGroups(nodes, relationships) {
  const ids = new Set(nodes.map((node) => node.id));
  const neighbours = new Map(nodes.map((node) => [node.id, []]));
  const connected = new Set();
  for (const relationship of relationships) {
    const { sourceTable: source, referencedTable: target } = relationship;
    if (!ids.has(source) || !ids.has(target)) continue;
    connected.add(source);
    connected.add(target);
    if (source === target) continue;
    neighbours.get(source).push(target);
    neighbours.get(target).push(source);
  }
  const labels = new Map(nodes.map((node) => [node.id, node.id]));
  const degree = new Map(nodes.map((node) => [node.id, neighbours.get(node.id).length]));
  const totals = new Map(degree);
  const totalDegree = [...degree.values()].reduce((sum, value) => sum + value, 0) || 1;
  const ordered = [...ids].sort();
  for (let pass = 0; pass < 12; pass += 1) {
    let changed = false;
    for (const id of ordered) {
      const current = labels.get(id);
      totals.set(current, totals.get(current) - degree.get(id));
      const weights = new Map([[current, 0]]);
      for (const neighbour of neighbours.get(id)) {
        const label = labels.get(neighbour);
        weights.set(label, (weights.get(label) || 0) + 1);
      }
      let best = current;
      let score = (weights.get(current) || 0) - degree.get(id) * totals.get(current) / totalDegree;
      for (const [label, weight] of [...weights].sort(([a], [b]) => a.localeCompare(b))) {
        const candidate = weight - degree.get(id) * totals.get(label) / totalDegree;
        if (candidate > score + 0.0001) { score = candidate; best = label; }
      }
      labels.set(id, best);
      totals.set(best, totals.get(best) + degree.get(id));
      changed ||= best !== current;
    }
    if (!changed) break;
  }
  const groups = new Map();
  for (const node of nodes) {
    const id = node.data?.group || (connected.has(node.id) ? `erd-auto:${labels.get(node.id)}` : "erd-disconnected");
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(node.id);
  }
  return [...groups].map(([id, tables]) => {
    const anchor = [...tables].sort((a, b) => degree.get(b) - degree.get(a) || a.localeCompare(b))[0];
    return { id, tables, name: id === "erd-disconnected" ? "Disconnected tables" : `${nodes.find((node) => node.id === anchor)?.data?.table?.name || anchor} & related` };
  });
}

export function placeErdNodes(nodes, positions, stored = [], force = false) {
  const previous = new Map(stored.map((node) => [node.table, node]));
  const suggested = new Map(positions.map((node) => [node.id, node]));
  const result = nodes.map((node) => {
    const saved = previous.get(node.id);
    const keep = saved && (!force || saved.pinned);
    const position = keep ? saved : suggested.get(node.id) || node.position;
    return { ...node, position: { x: position.x || 0, y: position.y || 0 } };
  });
  const fixed = new Set(stored.filter((node) => !force || node.pinned).map((node) => node.table));
  const occupied = result.filter((node) => fixed.has(node.id)).map((node) => ({ ...node.position, ...node.dimensions }));
  for (const node of result) {
    if (fixed.has(node.id)) continue;
    const rectangle = { ...node.position, ...node.dimensions };
    let collision;
    while ((collision = occupied.find((box) => rectangle.x < box.x + box.width + 36 &&
      rectangle.x + rectangle.width + 36 > box.x && rectangle.y < box.y + box.height + 36 && rectangle.y + rectangle.height + 36 > box.y))) {
      rectangle.y = collision.y + collision.height + 48;
    }
    node.position = { x: rectangle.x, y: rectangle.y };
    occupied.push(rectangle);
  }
  return result;
}
