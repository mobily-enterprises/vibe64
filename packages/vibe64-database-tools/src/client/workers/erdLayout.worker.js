import ELK from "elkjs/lib/elk-api.js";
import ElkWorker from "elkjs/lib/elk-worker.min.js?worker";

import { buildErdRelationshipRoutes } from "../../shared/erdRelationships.js";
import { layoutErdGroups, layoutErdRings } from "./erdLayout.js";
import { routeOverviewEdges } from "../dataOverviewModel.js";

// readable-check: allow module-state - shared resource: every layout this worker answers uses one ELK engine, started on first need with its own nested worker
let elk = null;

/**
 * Answers one request from the page: relationship routes, the overview's actor rings, a central table's rings, or
 * an ELK arrangement of the table groups. A failure is answered too, so the page's request always settles.
 * @param {MessageEvent} event
 */
async function answerLayoutRequest(event) {
  const request = event.data || {};
  try {
    const nodes = Array.isArray(request.nodes) ? request.nodes : [];
    if (request.kind === "routes") {
      const relationships = Array.isArray(request.relationships) ? request.relationships : [];
      const graph = buildErdRelationshipRoutes(nodes, relationships, request.options);
      self.postMessage({
        id: request.id, ok: true, portsByNode: graph.portsByNode,
        routes: graph.routes.map((route) => ({ ...route, sourceNode: undefined, targetNode: undefined }))
      });
      return;
    }
    let result;
    if (request.kind === "overview") {
      const positioned = layoutErdRings(nodes, request.overviewRings, 64).map(node => ({
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
}

// readable-check: allow leaked-listener - platform object: this is the worker's own global scope, which ends with the worker when the page terminates it
self.addEventListener("message", answerLayoutRequest);
