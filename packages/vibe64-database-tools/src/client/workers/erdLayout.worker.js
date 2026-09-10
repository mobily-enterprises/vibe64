import ELK from "elkjs/lib/elk-api.js";
import ElkWorker from "elkjs/lib/elk-worker.min.js?worker";

import { createErdRelationshipRoutes } from "../erdRelationships.js";
import { layoutErdGroups, layoutErdRings } from "./erdLayout.js";
import { routeOverviewEdges } from "../dataOverviewModel.js";

let elk = null;

self.addEventListener("message", async (event) => {
  const request = event.data || {};
  try {
    const nodes = Array.isArray(request.nodes) ? request.nodes : [];
    if (request.kind === "routes") {
      const graph = createErdRelationshipRoutes(nodes, request.relationships, request.options);
      self.postMessage({
        id: request.id, ok: true, portsByNode: graph.portsByNode,
        routes: graph.routes.map((route) => ({ ...route, sourceNode: undefined, targetNode: undefined }))
      });
      return;
    }
    let result;
    if (request.kind === "overview") {
      const positioned = layoutErdRings(nodes, request.overviewRings).map(node => ({
        ...node, ...request.overviewPositions?.[node.id.startsWith("actor:") ? node.id.slice(6) : node.id]
      }));
      const positions = new Map(positioned.map((node) => [node.id, { x: node.x, y: node.y }]));
      const visible = nodes.map((node) => ({
        id: node.id,
        position: positions.get(node.id),
        dimensions: { width: node.width, height: node.height }
      }));
      result = { nodes: positioned, overviewRoutes: routeOverviewEdges(visible, request.visibleEdges) };
    } else if (request.centralTable) {
      result = { nodes: layoutErdRings(nodes.map((node) => ({ ...node, count: node.id === request.centralTable ? 1 : 0 }))), paths: [] };
    } else {
      elk ||= new ELK({ workerFactory: () => new ElkWorker() });
      const edges = Array.isArray(request.edges) ? request.edges : [];
      result = await layoutErdGroups(elk, nodes, edges, request.groups);
    }
    self.postMessage({
      ...result,
      id: request.id,
      ok: true
    });
  } catch (error) {
    self.postMessage({
      error: String(error?.message || error || "ERD layout failed."),
      id: request.id,
      ok: false
    });
  }
});
