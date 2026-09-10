import { dataOverviewCoverage } from "../shared/dataOverview.js";
import { erdCardinality } from "./erdModel.js";
import { erdObstacles, routeErdConnection } from "./erdRouting.js";

export function routeOverviewEdges(nodes, edges) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const obstacles = erdObstacles(nodes, 48);
  const occupied = [];
  return edges.map((edge, index) => {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    const sourceCenter = { x: source.position.x + source.dimensions.width / 2, y: source.position.y + source.dimensions.height / 2 };
    const targetCenter = { x: target.position.x + target.dimensions.width / 2, y: target.position.y + target.dimensions.height / 2 };
    const horizontalGap = Math.abs(targetCenter.x - sourceCenter.x) - (source.dimensions.width + target.dimensions.width) / 2;
    const verticalGap = Math.abs(targetCenter.y - sourceCenter.y) - (source.dimensions.height + target.dimensions.height) / 2;
    const horizontal = horizontalGap >= verticalGap;
    const forward = horizontal ? targetCenter.x >= sourceCenter.x : targetCenter.y >= sourceCenter.y;
    const sourcePosition = horizontal ? (forward ? "right" : "left") : (forward ? "bottom" : "top");
    const targetPosition = horizontal ? (forward ? "left" : "right") : (forward ? "top" : "bottom");
    const start = horizontal
      ? { x: source.position.x + (forward ? source.dimensions.width : 0), y: source.position.y + 32 }
      : { x: sourceCenter.x, y: source.position.y + (forward ? source.dimensions.height : 0) };
    const end = horizontal
      ? { x: target.position.x + (forward ? 0 : target.dimensions.width), y: target.position.y + 32 }
      : { x: targetCenter.x, y: target.position.y + (forward ? 0 : target.dimensions.height) };
    const route = routeErdConnection({ source: edge.source, target: edge.target, start, end, sourcePosition, targetPosition, stubLength: 56, laneX: (start.x + end.x) / 2 }, obstacles, occupied, index);
    route.points.slice(1).forEach((point, i) => occupied.push([route.points[i], point]));
    return { id: edge.id, sourceHandle: `out-${sourcePosition}`, targetHandle: `in-${targetPosition}`, ...route };
  });
}

export function dataOverviewGraph(schema, definition, { allRelationships = false } = {}) {
  const tables = new Map((schema.tables || []).map((table) => [table.qualifiedName, table]));
  const coverage = dataOverviewCoverage(schema, definition);
  const groups = definition.actors.map((actor) => ({ ...actor, id: `actor:${actor.table}`, missing: actor.tables.filter((id) => !tables.has(id)) }));
  if (coverage.others.length) groups.push({ id: "other-tables", name: "Other tables", table: "", description: "Technical and unclassified tables", tables: coverage.others, missing: [] });
  const nodes = [];
  const endpoints = new Map();
  const largestGroup = Math.max(1, ...groups.map((group) => group.tables.filter((id) => tables.has(id)).length));
  for (const [index, group] of groups.entries()) {
    const members = group.tables.map((id) => tables.get(id)).filter(Boolean);
    for (const table of members) endpoints.set(table.qualifiedName, group.id);
    // Scale area with membership; even the largest collapsed card is at most
    // twice the smallest. Keep text at the same readable font size.
    const scale = Math.sqrt(1 + (Math.max(1, members.length) - 1) / Math.max(1, largestGroup - 1));
    const width = Math.floor(300 * scale);
    const height = Math.floor(144 * scale);
    nodes.push({
      id: group.id, type: "actor", position: { x: (index % 3) * 460, y: Math.floor(index / 3) * 240 },
      style: { width: `${width}px`, height: `${height}px` }, dimensions: { width, height },
      data: { group, count: members.length, width, height }
    });
  }
  const projected = new Map();
  const main = !allRelationships && definition.mainRelationships ? new Set(definition.mainRelationships) : null;
  for (const relationship of schema.relationships || []) {
    if (main && !main.has(relationship.id)) continue;
    const source = endpoints.get(relationship.referencedTable);
    const target = endpoints.get(relationship.sourceTable);
    if (!source || !target) continue;
    if (source === target) continue;
    const key = JSON.stringify([source, target]);
    if (!projected.has(key)) projected.set(key, { source, target, relationships: [] });
    projected.get(key).relationships.push({
      ...relationship,
      cardinality: erdCardinality(relationship, tables.get(relationship.referencedTable), tables.get(relationship.sourceTable))
    });
  }
  const edges = [...projected.values()].map((edge, index) => ({
    id: `relationship:${index}`, source: edge.source, target: edge.target,
    sourceHandle: "out-right", targetHandle: "in-left", type: "overview",
    markerEnd: { type: "arrowclosed", width: 16, height: 16 },
    label: edge.relationships.length === 1
      ? `${edge.relationships[0].cardinality.parent} : ${edge.relationships[0].cardinality.child}`
      : `${edge.relationships.length} relationships`,
    data: { relationships: edge.relationships },
    style: edge.relationships.every((rel) => rel.cardinality.optional) ? { strokeDasharray: "5 4" } : {}
  }));
  return { nodes, edges, groups, coverage };
}
