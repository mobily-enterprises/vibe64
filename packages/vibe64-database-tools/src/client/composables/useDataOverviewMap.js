import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";

/**
 * The Data overview's actor map: its actor cards and main connections, arranged by its own layout worker (only the
 * latest arrangement is drawn, and one that takes over 15 seconds fails with Retry), the connection selected for the
 * inspector, and actor positions. A dropped actor's position is saved at once; while a save is in flight only the
 * latest drop waits, and each following save uses the last acknowledgement, so concurrent edits still conflict.
 * @param {{
 *   props: {
 *     overview: Record<string, any>,
 *     saveOverview: (request: { definition: Record<string, any>, baseHash: string }) => Promise<Record<string, any> | null>
 *   },
 *   graph: import("vue").ComputedRef<Record<string, any>>,
 *   activeGroup: import("vue").ComputedRef<Record<string, any> | undefined>,
 *   feedback: import("@jskit-ai/http-web/client/types").UiFeedback
 * }} options
 */
function useDataOverviewMap({ props, graph, activeGroup, feedback }) {
  const savingPosition = ref(false);
  const nodes = ref([]);
  const edges = ref([]);
  const flow = ref(null);
  const pending = ref(false);
  const layoutError = ref("");
  const selection = ref(null);
  let dragging = false;
  let positionBase;
  let localPositions;
  let queuedPositions;
  let worker;
  let layoutGraph;
  let requestId = 0;
  let timer;
  let disposed = false;
  let fitAfterArrange = false;

  /** Whether an actor is being dragged; the click that ends a drag opens nothing. */
  function isDragging() { return dragging; }
  async function fit({ automatic = false } = {}) {
    const current = requestId;
    await nextTick();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (!disposed && current === requestId && !activeGroup.value) await flow.value?.fitView({
      padding: 0.06, maxZoom: 1, minZoom: automatic ? 0.5 : 0.01, duration: 0
    });
  }
  function arrange() {
    if (dragging || !worker || disposed) return;
    const id = ++requestId;
    clearTimeout(timer);
    layoutError.value = "";
    selection.value = null;
    layoutGraph = graph.value;
    pending.value = layoutGraph.nodes.length > 0;
    if (!pending.value) { nodes.value = []; edges.value = []; return; }
    const positions = localPositions || props.overview.definition.positions;
    worker.postMessage({
      id,
      kind: "overview",
      nodes: layoutGraph.nodes.map((node) => ({ id: node.id, count: node.data.count, ...node.dimensions })),
      overviewPositions: positions ? JSON.parse(JSON.stringify(positions)) : undefined,
      overviewRings: props.overview.definition.rings?.map((ring) => ring.map((table) => `actor:${table}`)),
      visibleEdges: layoutGraph.edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target }))
    });
    timer = setTimeout(() => {
      requestId += 1;
      pending.value = false;
      layoutError.value = "Actor arrangement timed out. Retry to arrange the overview.";
    }, 15000);
  }
  function startActorDrag({ node }) {
    dragging = true;
    // A routing reply from before this gesture must never move its cards.
    requestId += 1;
    clearTimeout(timer);
    pending.value = false;
    if (!savingPosition.value) positionBase = { hash: props.overview.hash, definition: JSON.parse(JSON.stringify(props.overview.definition)) };
    edges.value = edges.value.map(edge => ({ ...edge, data: { ...edge.data, dragging: edge.data.dragging || edge.source === node.id || edge.target === node.id } }));
  }
  async function finishActorDrag() {
    dragging = false;
    if (!positionBase) { arrange(); return; }
    const positions = Object.fromEntries(nodes.value.map(node => [node.data.group.table || "other-tables", { ...node.position }]));
    await savePositions(positions);
  }
  function resetActorPositions() {
    fitAfterArrange = true;
    void savePositions({});
  }
  async function savePositions(positions) {
    localPositions = positions;
    queuedPositions = positions;
    arrange();
    if (savingPosition.value) return;
    positionBase ||= { hash: props.overview.hash, definition: props.overview.definition };
    savingPosition.value = true;
    try {
      // Keep only the latest drop while a write is in flight. Each following
      // write uses our last acknowledgement, so concurrent edits still conflict.
      while (queuedPositions && !disposed) {
        const next = queuedPositions;
        queuedPositions = null;
        const result = await props.saveOverview({ definition: { ...positionBase.definition, positions: next }, baseHash: positionBase.hash });
        if (!result?.ok) throw new Error(result?.error || "Actor positions could not be saved.");
        positionBase = result.overview;
      }
    } catch (error) {
      queuedPositions = null;
      positionBase = null;
      feedback.error(error, "Actor positions could not be saved.");
    } finally {
      localPositions = null;
      if (!dragging) positionBase = null;
      if (!disposed) { savingPosition.value = false; arrange(); }
    }
  }
  onMounted(() => {
    worker = new Worker(new URL("../workers/erdLayout.worker.js", import.meta.url), { type: "module" });
    worker.onmessage = async ({ data }) => {
      if (disposed || data.id !== requestId) return;
      clearTimeout(timer);
      if (!data.ok) { pending.value = false; layoutError.value = data.error || "The overview could not be arranged."; return; }
      const initial = !nodes.value.length;
      const positions = new Map(data.nodes.map((node) => [node.id, { x: node.x, y: node.y }]));
      nodes.value = layoutGraph.nodes.map((node) => ({ ...node, position: positions.get(node.id) || node.position }));
      const routes = new Map(data.overviewRoutes.map((route) => [route.id, route]));
      edges.value = layoutGraph.edges.map((edge) => {
        const route = routes.get(edge.id);
        return { ...edge, sourceHandle: route.sourceHandle, targetHandle: route.targetHandle, data: { ...edge.data, points: route.points } };
      });
      if (data.overviewRoutes.some((route) => route.obstructed)) layoutError.value = "Some connections could not avoid actors. Try showing only main connections.";
      if (initial || fitAfterArrange) await fit({ automatic: initial });
      if (!disposed && data.id === requestId) {
        fitAfterArrange = false;
        pending.value = false;
      }
    };
    worker.onerror = () => { clearTimeout(timer); pending.value = false; layoutError.value = "The overview layout worker failed. Reload overview to retry."; };
    arrange();
  });
  onBeforeUnmount(() => { disposed = true; clearTimeout(timer); worker?.terminate(); });

  return {
    arrange,
    edges,
    finishActorDrag,
    fit,
    flow,
    isDragging,
    layoutError,
    nodes,
    pending,
    resetActorPositions,
    savingPosition,
    selection,
    startActorDrag
  };
}

export { useDataOverviewMap };
