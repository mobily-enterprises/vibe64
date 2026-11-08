import { computed, markRaw, nextTick, onBeforeUnmount, onMounted, ref, toRaw } from "vue";

import { buildErdRelationshipRoutes, erdRouteSnapshot } from "../../shared/erdRelationships.js";
import { erdLayoutGroups, placeErdNodes, visibleErdNodes } from "../../shared/erdModel.js";
import { emphasizeErdGraph, erdFlowEdges, erdFlowNodes, sameErdGraph, withDraggedPositions } from "../erdFlowGraph.js";
import { createErdLayoutWorker } from "../erdLayoutWorker.js";

/**
 * The ERD's diagram: its tables and relationship routes, arranged and routed by its own layout worker, its column
 * mode, focus, group filter, groups and saved views, the selection, an undo history of 30 steps, and the shared
 * layout. Each change is saved through `save-layout`; a newer shared layout replaces the diagram unless it only
 * acknowledges this viewer's save, and one arriving during a drag waits for the drop. A later arrangement, restore
 * or routing supersedes an earlier one still running.
 * @param {{
 *   props: { layout: Record<string, any>, schema: Record<string, any>, draggable: boolean, centralTable: string },
 *   emit: (event: "save-layout" | "inspect-table", value: any) => void,
 *   feedback: import("@jskit-ai/http-web/client/types").UiFeedback
 * }} options
 */
function useDatabaseErd({ props, emit, feedback }) {
  const nodes = ref([]);
  const edges = ref([]);
  const layoutError = ref("");
  const layoutPending = ref(false);
  const diagramReady = ref(false);
  const columnMode = ref(props.layout.columnMode || "keys");
  const focusTable = ref(props.layout.focusTable || "");
  const activeGroup = ref(props.layout.activeGroup || "");
  const groups = ref((props.layout.groups || []).map((group) => ({ ...group })));
  const views = ref(JSON.parse(JSON.stringify(props.layout.views || [])));
  const undoStack = ref([]);
  const redoStack = ref([]);
  const selectedTable = ref("");
  const selectedRelationshipId = ref("");
  const hoveredRelationshipId = ref("");
  const searchColumn = ref("");
  const obstructedCount = ref(0);
  // Schema refreshes replace the snapshot; its metadata is immutable between reads.
  const relationships = computed(() => toRaw(props.schema.relationships || []));
  const tables = computed(() => toRaw(props.schema.tables || []));
  let flow = null;
  let layoutWorker = null;
  let rebuildId = 0;
  let graphRefreshId = 0;
  let routingPromise = null;
  let relationshipDragFrame = null;
  let routes = props.layout.routes || [];
  let storedNodes = props.layout.nodes || [];
  let draggingSnapshot = null;
  let pendingRemoteLayout = null;
  let appliedLayoutRevision = props.layout.revision || 0;
  // The diagram this viewer last saved, or last took from the shared layout.
  let lastSharedLayout = null;
  let appliedFocusRequest = null;
  let disposed = false;
  let viewportSaveTimer = null;

  function tableName(id) { return tables.value.find((table) => table.qualifiedName === id)?.name || id; }
  function snapshot() {
    return {
      routes: erdRouteSnapshot(routes),
      nodes: nodes.value.map((node) => ({ table: node.id, x: node.position.x, y: node.position.y, collapsed: node.data.collapsed, expanded: node.data.expanded, pinned: node.data.pinned, group: node.data.group, hidden: false })),
      columnMode: columnMode.value, focusTable: focusTable.value, activeGroup: activeGroup.value,
      groups: groups.value.map((group) => ({ ...group })),
      viewport: { ...(flow?.getViewport() || { x: 0, y: 0, zoom: 1 }) }
    };
  }
  function checkpoint() {
    undoStack.value = [...undoStack.value, snapshot()].slice(-30);
    redoStack.value = [];
  }
  function clearViewportSave() { clearTimeout(viewportSaveTimer); viewportSaveTimer = null; }
  function persistPositions() {
    clearViewportSave();
    lastSharedLayout = snapshot();
    emit("save-layout", { ...lastSharedLayout, views: views.value });
  }
  function buildNodes(saved = storedNodes) {
    return erdFlowNodes({
      tables: tables.value, relationships: relationships.value, saved,
      columnMode: columnMode.value, groups: groups.value, draggable: props.draggable,
      onToggle: toggleNode, onExpand: expandNode, onPin: togglePin
    });
  }
  function applyVisibility() {
    nodes.value = visibleErdNodes(nodes.value, relationships.value, {
      focusTable: focusTable.value, activeGroup: activeGroup.value
    });
  }
  function emphasize() {
    emphasizeErdGraph(nodes.value, edges.value, routes, {
      selectedTable: selectedTable.value, selectedRelationshipId: selectedRelationshipId.value,
      hoveredRelationshipId: hoveredRelationshipId.value, searchColumn: searchColumn.value
    });
  }
  async function refreshGraph({ dragging = false, reset = false, layoutPaths = new Map() } = {}) {
    const request = ++graphRefreshId;
    applyVisibility();
    // Coalesce drag/visibility updates while the worker is routing. Only the most
    // recent graph may replace the current one, including after a remote restore.
    if (routingPromise) await routingPromise.catch(() => {});
    if (disposed || request !== graphRefreshId) return false;
    // Keep component callbacks and Vue's reactive proxies out of the worker payload.
    const routingNodes = nodes.value.filter((node) => !node.hidden).map((node) => ({
      id: node.id, position: node.position, dimensions: node.dimensions,
      data: { table: node.data.table, columns: node.data.columns, collapsed: node.data.collapsed }
    }));
    const operation = layoutWorker.request({
      kind: "routes",
      nodes: JSON.parse(JSON.stringify(routingNodes)),
      relationships: JSON.parse(JSON.stringify(relationships.value)),
      options: { previousRoutes: reset ? [] : erdRouteSnapshot(routes), dragging, fixedSides: reset, layoutPaths }
    });
    routingPromise = operation;
    let graph;
    try {
      graph = await operation;
    } catch (error) {
      if (!disposed && request === graphRefreshId) layoutError.value = error.message || "The ERD connections could not be drawn.";
      return false;
    } finally {
      if (routingPromise === operation) routingPromise = null;
    }
    if (disposed || request !== graphRefreshId) return false;
    layoutError.value = "";
    routes = graph.routes;
    // Vue Flow's nodes share their data with these, so only the cards redraw their ports: replacing every
    // node would also have Vue Flow re-read and redraw all of them.
    for (const node of nodes.value) node.data.relationshipPorts = markRaw(graph.portsByNode.get(node.id) || []);
    obstructedCount.value = routes.filter((route) => route.obstructed).length;
    // Vue Flow anchors connections at measured ports. Measuring the new ports before handing it the
    // connections renders each connection once, in the same task, rather than again after measurement.
    await nextTick();
    if (disposed || request !== graphRefreshId) return false;
    flow?.updateNodeInternals(nodes.value.filter((node) => !node.hidden).map((node) => node.id));
    edges.value = erdFlowEdges(routes, tableName);
    emphasize();
    return true;
  }
  async function rebuild({ force = false } = {}) {
    if (!layoutWorker) return;
    const request = ++rebuildId;
    graphRefreshId += 1;
    layoutPending.value = true;
    layoutError.value = "";
    const saved = nodes.value.length ? snapshot().nodes : storedNodes;
    const initialViewport = !force && (nodes.value.length ? flow?.getViewport() : saved.length ? props.layout.viewport : null);
    try {
      const sourceNodes = buildNodes(saved);
      const savedTables = new Set(saved.map((node) => node.table));
      const needsSave = force || sourceNodes.some((node) => !savedTables.has(node.id));
      const graph = buildErdRelationshipRoutes(sourceNodes, relationships.value, { fixedSides: true, calculatePaths: false });
      const layout = await layoutWorker.request({
        nodes: sourceNodes.map((node) => ({ id: node.id, ...node.dimensions, ports: graph.portsByNode.get(node.id) })),
        edges: graph.routes.map((route) => ({ id: route.id, source: route.source, target: route.target, sourceHandle: route.sourceHandle, targetHandle: route.targetHandle })),
        centralTable: props.centralTable,
        groups: erdLayoutGroups(sourceNodes, relationships.value)
      });
      if (disposed || request !== rebuildId) return;
      nodes.value = placeErdNodes(sourceNodes, layout.nodes, saved, force);
      if (!await refreshGraph({ reset: force, layoutPaths: force || !saved.length ? new Map(layout.paths.map((path) => [path.id, path.points])) : new Map() })) return;
      if (!await updateViewport(initialViewport, { animate: diagramReady.value })) return;
      diagramReady.value = true;
      if (needsSave || JSON.stringify(erdRouteSnapshot(routes)) !== JSON.stringify(props.layout.routes || [])) persistPositions();
      if (layout.fallback) feedback.error(new Error("The recommended layout was unavailable; a basic arrangement was used."), "Layout needs attention.");
    } catch (error) {
      if (request === rebuildId) layoutError.value = error.message || "The ERD could not be arranged.";
    } finally {
      if (request === rebuildId) layoutPending.value = false;
    }
  }
  async function restore(state, { remote = false } = {}) {
    const request = ++rebuildId;
    layoutPending.value = true;
    columnMode.value = state.columnMode || "keys";
    focusTable.value = state.focusTable || "";
    activeGroup.value = state.activeGroup || "";
    groups.value = (state.groups || []).map((group) => ({ ...group }));
    if (remote) {
      views.value = JSON.parse(JSON.stringify(state.views || []));
    } else {
      selectedTable.value = "";
      selectedRelationshipId.value = "";
      hoveredRelationshipId.value = "";
    }
    routes = state.routes || [];
    nodes.value = buildNodes(state.nodes);
    try {
      if (!await refreshGraph()) return false;
      if (!remote) {
        if (!await updateViewport(state.viewport)) return false;
        persistPositions();
      }
      return true;
    } finally {
      // An older restore cannot unlock a newer restore or arrangement.
      if (request === rebuildId) layoutPending.value = false;
    }
  }
  async function undo() {
    if (!undoStack.value.length || layoutPending.value) return;
    redoStack.value.push(snapshot());
    await restore(undoStack.value.pop());
  }
  async function redo() {
    if (!redoStack.value.length || layoutPending.value) return;
    undoStack.value.push(snapshot());
    await restore(redoStack.value.pop());
  }
  async function changeColumnMode(mode) {
    if (mode === columnMode.value || layoutPending.value) return;
    checkpoint();
    columnMode.value = mode;
    const saved = snapshot().nodes.map((node) => ({ ...node, expanded: false }));
    nodes.value = buildNodes(saved);
    if (!await refreshGraph()) return;
    persistPositions();
  }
  async function changeNode(id, changes) {
    checkpoint();
    const saved = snapshot().nodes.map((node) => node.table === id ? { ...node, ...changes } : node);
    nodes.value = buildNodes(saved);
    if (!await refreshGraph()) return;
    persistPositions();
  }
  function toggleNode(id) { return changeNode(id, { collapsed: !nodes.value.find((node) => node.id === id).data.collapsed }); }
  function expandNode(id) { return changeNode(id, { expanded: !nodes.value.find((node) => node.id === id).data.expanded }); }
  function togglePin(id) { return changeNode(id, { pinned: !nodes.value.find((node) => node.id === id).data.pinned }); }
  function onNodeDragStart() { draggingSnapshot = snapshot(); }
  function onNodeDrag() {
    if (relationshipDragFrame !== null) return;
    relationshipDragFrame = globalThis.requestAnimationFrame(() => {
      relationshipDragFrame = null;
      void refreshGraph({ dragging: true });
    });
  }
  async function onNodeDragStop() {
    if (relationshipDragFrame !== null) globalThis.cancelAnimationFrame(relationshipDragFrame);
    relationshipDragFrame = null;
    const beforeDrag = draggingSnapshot;
    if (beforeDrag) {
      undoStack.value = [...undoStack.value, beforeDrag].slice(-30);
      redoStack.value = [];
      draggingSnapshot = null;
    }
    if (pendingRemoteLayout) {
      // Keep this drag without reverting tables moved by another viewer during it.
      const mergedNodes = withDraggedPositions(pendingRemoteLayout.nodes, beforeDrag.nodes, snapshot().nodes);
      const shared = pendingRemoteLayout;
      pendingRemoteLayout = null;
      if (!await restore({ ...shared, nodes: mergedNodes }, { remote: true })) return;
    }
    if (!await refreshGraph()) return;
    persistPositions();
  }
  function onNodeClick({ node }) { selectedTable.value = node.id; emit("inspect-table", node.id); selectedRelationshipId.value = ""; hoveredRelationshipId.value = ""; searchColumn.value = ""; emphasize(); }
  function onEdgeClick({ edge }) { selectedRelationshipId.value = edge.data.relationshipId; selectedTable.value = ""; emit("inspect-table", ""); emphasize(); }
  function onEdgeHover({ edge }) { hoveredRelationshipId.value = edge.data.relationshipId; emphasize(); }
  function onEdgeLeave() { hoveredRelationshipId.value = ""; emphasize(); }
  function clearSelection() { selectedTable.value = ""; emit("inspect-table", ""); selectedRelationshipId.value = ""; hoveredRelationshipId.value = ""; searchColumn.value = ""; emphasize(); }
  async function setFocus(id) {
    checkpoint();
    focusTable.value = id;
    activeGroup.value = "";
    clearSelection();
    if (!await refreshGraph()) return;
    if (!await fitDiagram()) return;
    persistPositions();
  }
  async function changeGroupFilter(id) {
    checkpoint();
    activeGroup.value = id;
    focusTable.value = "";
    clearSelection();
    if (!await refreshGraph()) return;
    if (!await fitDiagram()) return;
    persistPositions();
  }
  /**
   * Locates a table the host asked to show, once, when the diagram has its node and is not arranging.
   * @param {{ qualifiedName?: string } | null} request
   * @param {number} count
   * @param {boolean} pending
   */
  async function openFocusRequest(request, count, pending) {
    if (!request?.qualifiedName || request === appliedFocusRequest || !count || pending) return;
    if (!nodes.value.some((node) => node.id === request.qualifiedName)) return;
    appliedFocusRequest = request;
    await locate({ table: request.qualifiedName, column: "" });
  }
  async function locate(item) {
    if (!item || layoutPending.value || !nodes.value.length) return;
    checkpoint();
    focusTable.value = "";
    activeGroup.value = "";
    selectedRelationshipId.value = "";
    hoveredRelationshipId.value = "";
    selectedTable.value = item.table;
    emit("inspect-table", item.table);
    searchColumn.value = item.column;
    const saved = snapshot().nodes.map((node) => node.table === item.table ? { ...node, collapsed: false, expanded: Boolean(item.column) || node.expanded } : node);
    nodes.value = placeErdNodes(buildNodes(saved), [], saved);
    if (!await refreshGraph()) return;
    const request = graphRefreshId;
    await flow?.fitView({ nodes: [item.table], maxZoom: 1.2, padding: 0.5, duration: 220 });
    if (disposed || request !== graphRefreshId) return;
    persistPositions();
  }
  async function resetPositions() { checkpoint(); await rebuild({ force: true }); }
  async function updateViewport(viewport, { animate = true } = {}) {
    const request = graphRefreshId;
    await nextTick();
    await new Promise((resolve) => globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve)));
    if (disposed || request !== graphRefreshId) return false;
    if (viewport) await flow?.setViewport(viewport, { duration: animate ? 180 : 0 });
    else await flow?.fitView({ nodes: nodes.value.filter((node) => !node.hidden).map((node) => node.id), duration: animate ? 220 : 0, padding: 0.18 });
    return !disposed && request === graphRefreshId;
  }
  function fitDiagram() { return updateViewport(); }
  function onFlowInit(instance) { flow = instance; }
  function onViewportMove() {
    clearViewportSave();
    if (layoutPending.value || draggingSnapshot || !nodes.value.length) return;
    // A wheel gesture ends after a short pause. Save the camera once it settles,
    // instead of triggering a shared-state reload between successive wheel ticks.
    viewportSaveTimer = setTimeout(() => {
      viewportSaveTimer = null;
      if (!disposed && !layoutPending.value && !draggingSnapshot) persistPositions();
    }, 600);
  }
  /**
   * Saves a table group, replacing the one being edited or the one with the same name, shows only it, and arranges
   * the diagram again.
   * @param {string} editingId the group being edited, or "" for a new group
   * @param {string} name
   * @param {string[]} members
   */
  async function storeGroup(editingId, name, members) {
    checkpoint();
    const existing = groups.value.find((group) => group.name.toLowerCase() === name.toLowerCase());
    const id = editingId || existing?.id || crypto.randomUUID();
    groups.value = [...groups.value.filter((group) => group.id !== id), { id, name }];
    const memberTables = new Set(members);
    const saved = snapshot().nodes.map((node) => ({ ...node, group: memberTables.has(node.table) ? id : node.group === id ? "" : node.group }));
    nodes.value = buildNodes(saved);
    activeGroup.value = id;
    focusTable.value = "";
    clearSelection();
    await rebuild({ force: true });
  }
  /**
   * Removes a table group from the diagram and its tables, and arranges the diagram again.
   * @param {string} id
   */
  async function deleteGroup(id) {
    checkpoint();
    groups.value = groups.value.filter((group) => group.id !== id);
    if (activeGroup.value === id) activeGroup.value = "";
    const saved = snapshot().nodes.map((node) => ({ ...node, group: node.group === id ? "" : node.group }));
    nodes.value = buildNodes(saved);
    await rebuild({ force: true });
  }
  /**
   * Saves the diagram as a named view, replacing the view with the same name.
   * @param {string} name
   * @param {string} [matchingId] the id of the saved view with the same name
   */
  function storeView(name, matchingId) {
    const id = matchingId || crypto.randomUUID();
    const view = { ...snapshot(), id, name };
    views.value = [...views.value.filter((item) => item.id !== id), view];
    persistPositions();
  }
  async function restoreView(view) { checkpoint(); await restore(view); }
  function removeView(id) { views.value = views.value.filter((view) => view.id !== id); persistPositions(); }
  /**
   * Takes a newer shared layout: an acknowledgement of this viewer's save updates only the saved views; a layout
   * arriving during a drag waits for the drop; any other replaces the diagram, as one undo step.
   * @param {Record<string, any>} layout
   */
  function receiveLayout(layout) {
    if (!layout.revision || layout.revision <= appliedLayoutRevision) return;
    appliedLayoutRevision = layout.revision;
    // Acknowledging our own save (or changing only named views) does not change
    // the graph. Rebuilding it would disable controls and repeat dense routing.
    // The acknowledgement can arrive while a newer change of ours is still being
    // drawn, such as a chosen saved view; that change saves once drawn, and taking
    // the acknowledged diagram would undo it. So it matches our last save as well.
    if (sameErdGraph(layout, snapshot()) || (lastSharedLayout && sameErdGraph(layout, lastSharedLayout))) {
      views.value = JSON.parse(JSON.stringify(layout.views || []));
      pendingRemoteLayout = null;
      return;
    }
    lastSharedLayout = layout;
    if (draggingSnapshot) {
      pendingRemoteLayout = layout;
    } else if (layoutWorker) {
      checkpoint();
      void restore(layout, { remote: true });
    }
  }
  onMounted(() => {
    layoutWorker = createErdLayoutWorker();
    void rebuild();
  });
  onBeforeUnmount(() => {
    clearViewportSave();
    disposed = true;
    rebuildId += 1;
    graphRefreshId += 1;
    if (relationshipDragFrame !== null) globalThis.cancelAnimationFrame(relationshipDragFrame);
    layoutWorker?.terminate();
  });

  return {
    activeGroup,
    changeColumnMode,
    changeGroupFilter,
    clearSelection,
    clearViewportSave,
    columnMode,
    deleteGroup,
    diagramReady,
    edges,
    fitDiagram,
    focusTable,
    groups,
    layoutError,
    layoutPending,
    locate,
    nodes,
    obstructedCount,
    onEdgeClick,
    onEdgeHover,
    onEdgeLeave,
    onFlowInit,
    onNodeClick,
    onNodeDrag,
    onNodeDragStart,
    onNodeDragStop,
    onViewportMove,
    openFocusRequest,
    rebuild,
    receiveLayout,
    redo,
    redoStack,
    relationships,
    removeView,
    resetPositions,
    restoreView,
    selectedRelationshipId,
    selectedTable,
    setFocus,
    storeGroup,
    storeView,
    tableName,
    tables,
    togglePin,
    undo,
    undoStack,
    views
  };
}

export { useDatabaseErd };
