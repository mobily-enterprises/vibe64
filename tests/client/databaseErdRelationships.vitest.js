import { describe, expect, it } from "vitest";

import { createErdRelationshipRoutes } from "../../packages/vibe64-database-tools/src/client/erdRelationships.js";
import { routeOverviewEdges } from "../../packages/vibe64-database-tools/src/client/dataOverviewModel.js";
import { erdObstacles, erdPathClear } from "../../packages/vibe64-database-tools/src/client/erdRouting.js";
import { erdCardinality, erdColumns, erdLayoutGroups, erdNeighbours, erdSearch, placeErdNodes } from "../../packages/vibe64-database-tools/src/client/erdModel.js";

function tableNode(id, x, columns, { collapsed = false, y = 0 } = {}) {
  return {
    data: {
      collapsed,
      table: {
        columns: columns.map((name) => ({ name }))
      }
    },
    dimensions: { height: 220, width: 280 },
    id,
    position: { x, y }
  };
}

const relationships = [
  {
    columns: ["parent_id"],
    id: "child:parent",
    referencedColumns: ["id"],
    referencedTable: "parent",
    sourceTable: "child"
  },
  {
    columns: ["backup_parent_id"],
    id: "child:backup-parent",
    referencedColumns: ["id"],
    referencedTable: "parent",
    sourceTable: "child"
  }
];

describe("Database ERD relationships", () => {
  it("routes dense radial actor connections without exhausting the obstacle search", () => {
    const nodes = [3, 14, 15].flatMap((count, ring) => Array.from({ length: count }, (_, index) => {
      const angle = -Math.PI / 2 + index * Math.PI * 2 / count;
      const width = 300 + (index % 5) * 24;
      const height = 144 + (index % 5) * 12;
      const radius = [400, 1500, 2200][ring];
      return {
        id: `${ring}:${index}`,
        position: { x: Math.cos(angle) * radius - width / 2, y: Math.sin(angle) * radius - height / 2 },
        dimensions: { width, height }
      };
    }));
    const edges = nodes.slice(0, 4).flatMap((source) => nodes.filter((target) => target !== source)
      .map((target) => ({ id: `${source.id}-${target.id}`, source: source.id, target: target.id })));
    const routes = routeOverviewEdges(nodes, edges);
    const obstacles = erdObstacles(nodes, 48);
    expect(routes).toHaveLength(124);
    for (const [index, route] of routes.entries()) {
      expect(route.obstructed, route.id).toBe(false);
      expect(erdPathClear(route.points, obstacles, edges[index].source, edges[index].target), route.id).toBe(true);
      expect(route.points.slice(1).every((point, i) => point.x === route.points[i].x || point.y === route.points[i].y)).toBe(true);
    }
  });

  it("routes parent keys to the matching child foreign-key columns", () => {
    const parent = tableNode("parent", 0, ["id", "name"]);
    const child = tableNode("child", 420, ["id", "parent_id", "backup_parent_id"], { y: 340 });
    const graph = createErdRelationshipRoutes([parent, child], relationships);

    expect(graph.routes).toHaveLength(2);
    expect(graph.routes.map((route) => [
      route.source,
      route.sourceColumn,
      route.target,
      route.targetColumn
    ])).toEqual([
      ["parent", "id", "child", "parent_id"],
      ["parent", "id", "child", "backup_parent_id"]
    ]);
    expect(new Set(graph.routes.map((route) => route.sourceHandle)).size).toBe(2);
    expect(new Set(graph.routes.map((route) => route.targetHandle)).size).toBe(2);
    expect(new Set(graph.routes.map((route) => route.laneX)).size).toBe(2);

    const parentPorts = graph.portsByNode.get("parent");
    const childPorts = graph.portsByNode.get("child");
    expect(parentPorts.every((port) => port.column === "id" && port.type === "source")).toBe(true);
    expect(childPorts.map((port) => port.column)).toEqual(["parent_id", "backup_parent_id"]);
    expect(new Set(parentPorts.map((port) => port.offset)).size).toBe(2);
  });

  it("uses a table-side target when its columns are collapsed", () => {
    const parent = tableNode("parent", 0, ["id"]);
    const child = tableNode("child", 420, ["parent_id"], { collapsed: true });
    const graph = createErdRelationshipRoutes([parent, child], relationships.slice(0, 1));

    expect(graph.routes[0].targetColumn).toBeNull();
    expect(graph.portsByNode.get("child")[0]).toMatchObject({
      column: null,
      type: "target"
    });
  });

  it("routes around intervening cards and keeps every segment orthogonal", () => {
    const nodes = [tableNode("parent", 0, ["id"]), tableNode("child", 800, ["id", "parent_id"]), tableNode("blocker", 380, ["id"], { y: -40 })];
    const { routes } = createErdRelationshipRoutes(nodes, relationships.slice(0, 1));
    const route = routes[0];
    expect(route.obstructed).toBe(false);
    expect(erdPathClear(route.points, erdObstacles(nodes), route.source, route.target)).toBe(true);
    expect(route.points[0]).toEqual(route.start);
    expect(route.points.at(-1)).toEqual(route.end);
    expect(route.points.slice(1).every((point, i) => point.x === route.points[i].x || point.y === route.points[i].y)).toBe(true);
  });

  it("reports enclosed column ports without searching for an impossible escape", () => {
    const nodes = [tableNode("parent", 0, ["id"]), tableNode("child", 800, ["parent_id"]), tableNode("blocker", 750, ["id"])];
    const { routes } = createErdRelationshipRoutes(nodes, relationships.slice(0, 1));
    expect(routes[0].obstructed).toBe(true);
    expect(routes[0].points[0]).toEqual(routes[0].start);
    expect(routes[0].points.at(-1)).toEqual(routes[0].end);
  });

  it("represents every composite column pair as one selectable relationship", () => {
    const relation = { ...relationships[0], columns: ["parent_id", "tenant_id"], referencedColumns: ["id", "tenant_id"] };
    const { routes } = createErdRelationshipRoutes([tableNode("parent", 0, ["id", "tenant_id"]), tableNode("child", 600, ["parent_id", "tenant_id"])], [relation]);
    expect(routes.map((route) => [route.sourceColumn, route.targetColumn])).toEqual([["id", "parent_id"], ["tenant_id", "tenant_id"]]);
    expect(new Set(routes.map((route) => route.relationshipId)).size).toBe(1);
    expect(new Set(routes.map((route) => route.id)).size).toBe(2);
  });

  it("preserves unrelated routes and port sides during dragging", () => {
    const nodes = [tableNode("parent", 0, ["id"]), tableNode("child", 600, ["parent_id", "backup_parent_id"])];
    const first = createErdRelationshipRoutes(nodes, relationships);
    const stable = createErdRelationshipRoutes(nodes, relationships, { previousRoutes: first.routes, dragging: true });
    expect(stable.routes[0].points).toBe(first.routes[0].points);
    nodes[1].position = { x: -600, y: 400 };
    const moved = createErdRelationshipRoutes(nodes, relationships, { previousRoutes: first.routes, dragging: true });
    expect(moved.routes[0].targetPosition).toBe(first.routes[0].targetPosition);
    expect(moved.routes[0].end.x).not.toBe(first.routes[0].end.x);
    expect(moved.routes[0].points.at(-1)).toEqual(moved.routes[0].end);
  });

  it("routes self references outside the table", () => {
    const node = tableNode("parent", 0, ["id", "parent_id"]);
    const { routes } = createErdRelationshipRoutes([node], [{ ...relationships[0], sourceTable: "parent" }]);
    expect(routes[0].obstructed).toBe(false);
    expect(erdPathClear(routes[0].points, erdObstacles([node]), "parent", "parent")).toBe(true);
  });

  it("separates parallel horizontal and vertical runs for multiple foreign keys", () => {
    const nodes = [tableNode("parent", 0, ["id"]), tableNode("child", 600, ["parent_id", "backup_parent_id"], { y: 380 })];
    const { routes } = createErdRelationshipRoutes(nodes, relationships);
    const segments = (route) => route.points.slice(1).map((b, i) => [route.points[i], b]);
    for (const [a, b] of segments(routes[0])) {
      for (const [c, d] of segments(routes[1])) {
        const sameVertical = a.x === b.x && c.x === d.x && a.x === c.x;
        const sameHorizontal = a.y === b.y && c.y === d.y && a.y === c.y;
        const overlap = sameVertical
          ? Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) - Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y))
          : sameHorizontal ? Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) : 0;
        expect(overlap).toBeLessThanOrEqual(0);
      }
    }
  });

  it("keeps another relationship's route unchanged while a table moves", () => {
    const nodes = [tableNode("parent", 0, ["id"]), tableNode("child", 600, ["parent_id"]), tableNode("other-parent", 0, ["id"], { y: 700 }), tableNode("other-child", 600, ["parent_id"], { y: 700 })];
    const relations = [relationships[0], { ...relationships[0], id: "other", referencedTable: "other-parent", sourceTable: "other-child" }];
    const before = createErdRelationshipRoutes(nodes, relations);
    nodes[1].position = { x: 900, y: 100 };
    const during = createErdRelationshipRoutes(nodes, relations, { previousRoutes: before.routes, dragging: true });
    expect(during.routes.find((route) => route.id === "other").points).toBe(before.routes.find((route) => route.id === "other").points);
    expect(during.routes[0].end).not.toEqual(before.routes[0].end);
  });
});

describe("Database ERD exploration", () => {
  const parent = { qualifiedName: "parent", name: "Parent", columns: [{ name: "id", nullable: false }, { name: "name" }], keys: [{ columns: ["id"], primary: true }] };
  const child = { qualifiedName: "child", name: "Child", columns: [{ name: "parent_id", nullable: true }, { name: "notes" }], keys: [{ columns: ["parent_id"] }] };
  it("derives optional and unique relationships without promising a child exists", () => {
    expect(erdCardinality(relationships[0], parent, child)).toEqual({ parent: "0..1", child: "0..1", optional: true });
    expect(erdCardinality(relationships[0], parent, { ...child, columns: [{ name: "parent_id", nullable: false }], keys: [] })).toEqual({ parent: "1", child: "0..N", optional: false });
    expect(erdCardinality(relationships[0], parent, { ...child, columns: [{ name: "parent_id" }] }).parent).toBe("?..1");
  });
  it("shows relationship columns in keys mode and restores all fields on expansion", () => {
    expect(erdColumns(parent, relationships).map((column) => column.name)).toEqual(["id"]);
    expect(erdColumns(child, relationships).map((column) => column.name)).toEqual(["parent_id"]);
    expect(erdColumns(child, relationships, "keys", true)).toEqual(child.columns);
    expect(erdColumns(child, relationships, "all")).toEqual(child.columns);
  });
  it("searches columns and focuses only immediate neighbours", () => {
    expect(erdSearch([parent, child], "notes")).toEqual([{ table: "child", column: "notes", title: "Child.notes" }]);
    expect([...erdNeighbours("parent", [...relationships, { sourceTable: "grandchild", referencedTable: "child" }])].sort()).toEqual(["child", "parent"]);
  });
  it("keeps pinned positions and places reset nodes outside their bounds", () => {
    const nodes = [tableNode("parent", 0, ["id"]), tableNode("child", 0, ["parent_id"])];
    const placed = placeErdNodes(nodes, [{ id: "parent", x: 900, y: 0 }, { id: "child", x: 0, y: 0 }], [{ table: "parent", pinned: true, x: 0, y: 0 }], true);
    expect(placed[0].position).toEqual({ x: 0, y: 0 });
    expect(placed[1].position.y).toBeGreaterThan(nodes[0].dimensions.height);
  });
  it("restores overlapping saved positions exactly and only places new tables around them", () => {
    const nodes = [tableNode("parent", 0, ["id"]), tableNode("child", 0, ["parent_id"]), tableNode("new", 0, ["id"])];
    const saved = [{ table: "parent", x: 50, y: 60 }, { table: "child", x: 70, y: 80 }];
    const placed = placeErdNodes(nodes, nodes.map((node) => ({ id: node.id, x: 0, y: 0 })), saved);
    expect(placed[0].position).toEqual({ x: 50, y: 60 });
    expect(placed[1].position).toEqual({ x: 70, y: 80 });
    expect(placed[2].position.y).toBeGreaterThan(80 + nodes[1].dimensions.height);
  });
  it("finds stable relationship neighbourhoods, with explicit groups taking precedence", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "isolated"];
    const nodes = ids.map((id) => ({ id, data: { table: { name: id } } }));
    const relations = [["a", "b"], ["b", "c"], ["c", "a"], ["d", "e"], ["e", "f"], ["f", "d"], ["a", "d"]]
      .map(([sourceTable, referencedTable]) => ({ sourceTable, referencedTable }));
    const groups = erdLayoutGroups(nodes, relations);
    expect(groups.map((group) => group.tables)).toEqual([["a", "b", "c"], ["d", "e", "f"], ["isolated"]]);
    const memberships = (result) => Object.fromEntries(result.flatMap((group) => group.tables.map((id) => [id, group.id])));
    expect(memberships(erdLayoutGroups([...nodes].reverse(), [...relations].reverse()))).toEqual(memberships(groups));
    nodes[0].data.group = "chosen";
    nodes[3].data.group = "chosen";
    expect(erdLayoutGroups(nodes, relations).find((group) => group.id === "chosen").tables).toEqual(["a", "d"]);
    expect(groups.find((group) => group.id === "erd-disconnected").tables).toEqual(["isolated"]);
    expect(erdLayoutGroups([{ id: "self" }], [{ sourceTable: "self", referencedTable: "self" }])[0].id).toBe("erd-auto:self");
  });
});
