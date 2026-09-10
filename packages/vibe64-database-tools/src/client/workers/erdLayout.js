const HORIZONTAL_GAP = 72;
const VERTICAL_GAP = 112;

export const ERD_LAYOUT_OPTIONS = Object.freeze({
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.layered.compaction.connectedComponents": "true",
  "elk.layered.spacing.nodeNodeBetweenLayers": String(VERTICAL_GAP),
  "elk.spacing.componentComponent": "40",
  "elk.spacing.nodeNode": String(HORIZONTAL_GAP),
  "elk.spacing.edgeNode": "28",
  "elk.spacing.edgeEdge": "14",
  "elk.layered.spacing.edgeEdgeBetweenLayers": "14",
  "elk.layered.spacing.edgeNodeBetweenLayers": "28",
  "elk.layered.mergeEdges": "false",
  "elk.randomSeed": "1"
});

export function createErdLayoutGraph(nodes = [], edges = []) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  return {
    children: nodes.map((node) => ({
      height: Number(node.height || 180),
      id: node.id,
      width: Number(node.width || 296),
      layoutOptions: { "elk.portConstraints": "FIXED_POS" },
      ports: (node.ports || []).map((port) => ({
        id: port.id, x: port.x, y: port.y, width: 0, height: 0,
        layoutOptions: { "elk.port.side": port.position === "left" ? "WEST" : "EAST" }
      }))
    })),
    edges: edges
      .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
      .map((edge) => ({
        id: edge.id,
        sources: [edge.sourceHandle || edge.source],
        targets: [edge.targetHandle || edge.target]
      })),
    id: "database-erd",
    layoutOptions: ERD_LAYOUT_OPTIONS
  };
}

export async function layoutErdGroups(elk, nodes, edges, groups = []) {
  const sections = groups.length ? groups : [{ id: "erd-related", tables: nodes.map((node) => node.id) }];
  const result = { nodes: [], paths: [], fallback: false };
  const ordered = [...sections].sort((a, b) => (
    Number(a.id === "erd-disconnected") - Number(b.id === "erd-disconnected") || b.tables.length - a.tables.length || a.id.localeCompare(b.id)
  ));
  const layouts = [];
  for (const group of ordered) {
    const ids = new Set(group.tables);
    const children = nodes.filter((node) => ids.has(node.id));
    const connections = edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
    let graph;
    try {
      graph = await elk.layout(createErdLayoutGraph(children, connections));
    } catch {
      graph = { children: fallbackErdLayout(children, connections), edges: [] };
      result.fallback = true;
    }
    const width = Math.max(0, ...(graph.children || []).map((child) => (child.x || 0) + (children.find((node) => node.id === child.id)?.width || 296)));
    const height = Math.max(0, ...(graph.children || []).map((child) => (child.y || 0) + (children.find((node) => node.id === child.id)?.height || 180)));
    layouts.push({ group, graph, width, height });
  }
  // Try the few possible shelf widths, choosing the one that fits a landscape
  // viewport best. Each group remains a separate rectangle with a clear gutter.
  const widths = layouts.map((layout) => layout.width).sort((a, b) => b - a);
  let best = { score: Infinity, positions: [] };
  for (let count = 1; count <= layouts.length; count += 1) {
    const targetWidth = widths.slice(0, count).reduce((sum, width) => sum + width + 120, -120);
    let x = 0;
    let y = 0;
    let rowHeight = 0;
    let fullWidth = 0;
    const positions = layouts.map((layout) => {
      if (x && x + layout.width > targetWidth) { y += rowHeight + 120; x = 0; rowHeight = 0; }
      const position = { x, y };
      fullWidth = Math.max(fullWidth, x + layout.width);
      x += layout.width + 120;
      rowHeight = Math.max(rowHeight, layout.height);
      return position;
    });
    const score = Math.max(fullWidth / 1.6, y + rowHeight);
    if (score < best.score) best = { score, positions };
  }
  for (const [index, { graph }] of layouts.entries()) {
    const { x: offsetX, y: offsetY } = best.positions[index];
    for (const child of graph.children || []) {
      result.nodes.push({ id: child.id, x: (child.x || 0) + offsetX, y: (child.y || 0) + offsetY });
    }
    for (const edge of graph.edges || []) {
      const section = edge.sections?.[0];
      if (!section) continue;
      result.paths.push({
        id: edge.id,
        points: [section.startPoint, ...(section.bendPoints || []), section.endPoint]
          .map((point) => ({ x: point.x + offsetX, y: point.y + offsetY }))
      });
    }
  }
  return result;
}

export function fallbackErdLayout(nodes = [], edges = []) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, []]));
  const degree = new Map(nodes.map((node) => [node.id, 0]));
  for (const edge of edges) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) continue;
    incoming.set(edge.target, incoming.get(edge.target) + 1);
    outgoing.get(edge.source).push(edge.target);
    degree.set(edge.source, degree.get(edge.source) + 1);
    degree.set(edge.target, degree.get(edge.target) + 1);
  }

  const levels = new Map(nodes.map((node) => [node.id, 0]));
  const queue = nodes
    .filter((node) => incoming.get(node.id) === 0)
    .map((node) => node.id)
    .sort((left, right) => left.localeCompare(right));
  while (queue.length > 0) {
    const source = queue.shift();
    for (const target of outgoing.get(source)) {
      levels.set(target, Math.max(levels.get(target), levels.get(source) + 1));
      incoming.set(target, incoming.get(target) - 1);
      if (incoming.get(target) === 0) {
        queue.push(target);
        queue.sort((left, right) => left.localeCompare(right));
      }
    }
  }

  const rows = new Map();
  for (const node of nodes) {
    const level = levels.get(node.id) || 0;
    if (!rows.has(level)) rows.set(level, []);
    rows.get(level).push(node);
  }

  const positions = [];
  let y = 0;
  for (const [, row] of [...rows.entries()].sort(([left], [right]) => left - right)) {
    row.sort((left, right) => (
      degree.get(right.id) - degree.get(left.id) || left.id.localeCompare(right.id)
    ));
    let x = 0;
    let rowHeight = 0;
    for (const node of row) {
      positions.push({ id: node.id, x, y });
      x += Number(node.width || 280) + HORIZONTAL_GAP;
      rowHeight = Math.max(rowHeight, Number(node.height || 180));
    }
    y += rowHeight + VERTICAL_GAP;
  }
  return positions;
}

// Shared by the actor map and the physical ERD opened over it.
export function layoutErdRings(nodes, authoredRings) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const ordered = [...nodes].sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
  const authored = authoredRings?.length ? authoredRings : ordered.length ? [[ordered[0].id]] : [];
  const placed = new Set(authored.flat());
  const rings = authored.map((ring) => ring.map((id) => byId.get(id)).filter(Boolean)).filter((ring) => ring.length);
  const remaining = ordered.filter((node) => !placed.has(node.id));
  if (authoredRings?.length && remaining.length) {
    rings.at(-1).push(...remaining);
  } else {
    for (let start = 0, size = 8; start < remaining.length; start += size, size += 8) {
      rings.push(remaining.slice(start, start + size));
    }
  }
  const positioned = [];
  let outerRadius = 0;
  for (const [ringIndex, ring] of rings.entries()) {
    const diameter = Math.max(...ring.map((node) => Math.hypot(node.width, node.height)));
    // Bounding circles leave routing space around cards of different sizes.
    const radius = ringIndex === 0 && ring.length === 1 ? 0 : Math.max(
      outerRadius + diameter / 2 + 220,
      ring.length > 1 ? (diameter + 220) / (2 * Math.sin(Math.PI / ring.length)) : 0
    );
    for (const [index, node] of ring.entries()) {
      const angle = -Math.PI / 2 + index * Math.PI * 2 / ring.length;
      positioned.push({ ...node, x: Math.cos(angle) * radius - node.width / 2, y: Math.sin(angle) * radius - node.height / 2 });
    }
    outerRadius = radius + diameter / 2;
  }
  return positioned;
}
