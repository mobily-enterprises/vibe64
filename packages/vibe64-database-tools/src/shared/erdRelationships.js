import { ERD_HEADER_HEIGHT, ERD_ROW_HEIGHT, erdCardinality } from "./erdModel.js";
import { erdObstacles, erdPathClear, routeErdConnection } from "./erdRouting.js";

export function erdRouteSnapshot(routes = []) {
  return routes.map(({ id, sourcePosition, targetPosition, points, obstructed }) => ({
    id, sourcePosition, targetPosition, points: points.map(({ x, y }) => ({ x, y })), obstructed: Boolean(obstructed)
  }));
}

export function createErdRelationshipRoutes(nodes = [], relationships = [], { previousRoutes = [], dragging = false, fixedSides = false, calculatePaths = true, layoutPaths = new Map() } = {}) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const portsByNode = new Map(nodes.map((node) => [node.id, []]));
  const previous = new Map(previousRoutes.map((route) => [route.id, {
    ...route, start: route.points?.[0], end: route.points?.at(-1)
  }]));
  const routes = [];
  relationships.forEach((relationship, index) => {
    const sourceNode = nodeById.get(relationship.referencedTable);
    const targetNode = nodeById.get(relationship.sourceTable);
    if (!sourceNode || !targetNode) return;
    const relationshipId = String(relationship.id || relationship.constraintName || `relationship-${index}`);
    const cardinality = erdCardinality(relationship, sourceNode.data.table, targetNode.data.table);
    (relationship.columns || []).forEach((column, pairIndex) => {
      const id = relationship.columns.length > 1 ? `${relationshipId}:column-${pairIndex}` : relationshipId;
      const old = previous.get(id);
      const sourceColumn = sourceNode.data.collapsed ? null : relationship.referencedColumns[pairIndex];
      const targetColumn = targetNode.data.collapsed ? null : column;
      const reversed = sourceNode.position.x > targetNode.position.x + 24;
      const self = sourceNode.id === targetNode.id;
      const sourcePosition = old?.sourcePosition || (fixedSides || !reversed ? "right" : "left");
      const targetPosition = old?.targetPosition || (self ? sourcePosition : fixedSides || !reversed ? "left" : "right");
      const sourcePort = { id: `erd-source:${id}`, column: sourceColumn, position: sourcePosition, type: "source" };
      const targetPort = { id: `erd-target:${id}`, column: targetColumn, position: targetPosition, type: "target" };
      portsByNode.get(sourceNode.id).push(sourcePort);
      portsByNode.get(targetNode.id).push(targetPort);
      routes.push({
        id, relationshipId, relationship, pairIndex, cardinality,
        source: sourceNode.id, sourceNode, sourceColumn, sourcePosition, sourcePort, sourceHandle: sourcePort.id,
        target: targetNode.id, targetNode, targetColumn, targetPosition, targetPort, targetHandle: targetPort.id
      });
    });
  });

  for (const node of nodes) {
    const groups = new Map();
    for (const port of portsByNode.get(node.id)) {
      const key = `${port.position}:${port.column || ""}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(port);
    }
    for (const group of groups.values()) {
      group.sort((a, b) => a.id.localeCompare(b.id));
      group.forEach((port, index) => {
        const columns = node.data.columns || node.data.table.columns || [];
        const row = columns.findIndex((column) => column.name === port.column);
        port.column = row < 0 ? null : port.column;
        port.offset = group.length === 1 ? 50 : 25 + 50 * index / (group.length - 1);
        port.y = row < 0 ? ERD_HEADER_HEIGHT / 2 : ERD_HEADER_HEIGHT + row * ERD_ROW_HEIGHT + ERD_ROW_HEIGHT * port.offset / 100;
        port.x = port.position === "left" ? 0 : node.dimensions.width;
      });
    }
  }

  const obstacles = erdObstacles(nodes);
  const occupied = [];
  for (const [index, route] of routes.entries()) {
    route.start = { x: route.sourceNode.position.x + route.sourcePort.x, y: route.sourceNode.position.y + route.sourcePort.y };
    route.end = { x: route.targetNode.position.x + route.targetPort.x, y: route.targetNode.position.y + route.targetPort.y };
    route.laneX = route.source === route.target
      ? route.sourceNode.position.x + route.sourceNode.dimensions.width + 48 + index * 8
      : (route.start.x + route.end.x) / 2 + (index % 7 - 3) * 8;
    if (!calculatePaths) continue;
    const old = previous.get(route.id);
    const unchanged = old && old.start.x === route.start.x && old.start.y === route.start.y && old.end.x === route.end.x && old.end.y === route.end.y;
    const layoutPoints = layoutPaths.get(route.id);
    if (layoutPoints && erdPathClear(layoutPoints, obstacles, route.source, route.target) &&
        Math.abs(layoutPoints[0].x - route.start.x) < 1 && Math.abs(layoutPoints[0].y - route.start.y) < 1 &&
        Math.abs(layoutPoints.at(-1).x - route.end.x) < 1 && Math.abs(layoutPoints.at(-1).y - route.end.y) < 1) {
      route.points = layoutPoints;
      route.obstructed = false;
    } else if (unchanged && (dragging || erdPathClear(old.points, obstacles, route.source, route.target))) {
      route.points = old.points;
      route.obstructed = old.obstructed;
    } else {
      Object.assign(route, routeErdConnection(route, obstacles, occupied, index, dragging));
    }
    route.points.slice(1).forEach((point, i) => occupied.push([route.points[i], point]));
  }
  return { portsByNode, routes };
}
