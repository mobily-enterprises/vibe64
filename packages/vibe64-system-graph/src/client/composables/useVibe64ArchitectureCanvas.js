import { computed, markRaw, nextTick, onBeforeUnmount, ref, shallowRef, toRaw, unref, watch } from 'vue';
import { architectureOverview, subsystemOutline } from '../architectureModel.js';
import { adaptViewport, arrangedMapNodes, easedViewport, readingNodes, readingWidth, touchDistance } from '../architectureCanvas.js';

/** A camera move that needs nothing done when it arrives. */
function ignoreArrival() {}

/**
 * Architecture's Map canvas: the overview's nodes and edges, the reader zoomed into one subsystem (its interface, a
 * file or a Program, with Back history), and the camera that moves between them by wheel, pinch, controls and
 * navigation.
 * @param {object} options
 * @param {{ active: boolean, sessionId: string, openProgramRequest: { id: string } | null }} options.props the view's props
 * @param {import('vue').Ref<object | null>} options.architecture the loaded architecture snapshot
 * @param {import('vue').Ref<{ view: string }>} options.usageState the view's Map | Usage state
 * @param {import('vue').Ref<HTMLElement | null>} options.canvas the Map canvas element
 */
export function useVibe64ArchitectureCanvas({ props, architecture, usageState, canvas }) {
  const expandedSubsystemId = ref('');
  const outline = shallowRef(null);
  const retainedOutline = shallowRef(null);
  const focusOwner = computed(() => {
    const native = architecture.value?.subsystems?.find(owner => owner.id === expandedSubsystemId.value);
    return native ? { ...native, ...(overview.value.nodes.find(node => node.id === native.id)?.data || {}) } : null;
  });
  watch([expandedSubsystemId, architecture], async ([id], previous, onCleanup) => {
    outline.value = null;
    if (!id) return;
    let cancelled = false;
    onCleanup(() => { cancelled = true; });
    // Paint the square and its context first; prepare only this owner's detail.
    await nextTick();
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    if (!cancelled) {
      const detail = subsystemOutline(toRaw(architecture.value), id);
      outline.value = detail ? markRaw(detail) : null;
    }
  }, { flush: 'sync' });
  const layoutPositions = ref({});
  const fileRequest = ref(null);
  const retainedFileRequest = shallowRef(null);
  const viewHistory = shallowRef([]);
  const programId = ref('');
  const retainedProgramId = ref('');
  const currentProgram = computed(() => architecture.value?.program?.modules?.find(program => program.id === programId.value));
  const retainedProgram = computed(() => architecture.value?.program?.modules?.find(program => program.id === retainedProgramId.value));
  const parentProgram = computed(() => architecture.value?.program?.modules?.find(program => program.id === viewHistory.value.findLast(entry => entry.programId)?.programId));
  let dragging = false;
  let lastDragEnded = 0;
  let zoomAnchor;
  let zoomTarget;
  let parentViewport;
  let parentNode;
  let fileParentViewport;
  let transitioning = false;
  let gestureTarget;
  let gestureTimer;
  let gestureDirection;
  let zoomMotion;
  let zoomFrame;
  let zoomTime;
  let navigationVersion = 0;
  let pinchDistance;
  let pinchTarget;
  function finishGesture() {
    if (zoomMotion || transitioning) { gestureTimer = setTimeout(finishGesture, 80); return; }
    gestureTarget = undefined; zoomTarget = undefined; zoomAnchor = undefined;
  }
  function stopZoomMotion() { cancelAnimationFrame(zoomFrame); zoomFrame = undefined; zoomMotion = undefined; }
  function moveCamera(viewport, { semantic = false, done = ignoreArrival }) {
    zoomMotion = { viewport, semantic, done };
    if (!zoomFrame) { zoomTime = undefined; zoomFrame = requestAnimationFrame(animateZoom); }
  }
  function animateZoom(time) {
    if (!zoomMotion || !flow || !props.active) { stopZoomMotion(); return; }
    const motion = zoomMotion;
    const destination = motion.viewport;
    const current = flow.getViewport();
    const { next, complete } = easedViewport(current, destination, time - (zoomTime || time - 16));
    zoomTime = time;
    void flow.setViewport(complete ? destination : next, { duration: 0 });
    // Programmatic VueFlow transforms emit no viewport-change-end event.
    if (motion.semantic) viewportChanged(complete ? destination : next);
    if (zoomMotion !== motion) return;
    if (complete) { zoomFrame = undefined; zoomMotion = undefined; motion.done(); }
    else zoomFrame = requestAnimationFrame(animateZoom);
  }
  async function readingViewport(origin) {
    const version = ++navigationVersion;
    stopZoomMotion();
    if (gestureTarget) gestureTarget.consumed = true;
    transitioning = true;
    canvas.value?.focus({ preventScroll: true });
    if (origin && flow && canvas.value) {
      const width = readingWidth(canvas.value.clientWidth);
      const zoom = Math.min(1, origin.width / width);
      // Move the camera before Vue paints the new origin-based square; there
      // must not be a blank frame between hiding the circle and its skeleton.
      void flow.setViewport({ x: origin.x + origin.width / 2 - width * zoom / 2, y: origin.y + origin.height / 2 - 160 * zoom, zoom }, { duration: 0 });
    }
    await nextTick();
    await new Promise(requestAnimationFrame);
    if (version !== navigationVersion || !flow || !canvas.value) return;
    const node = unref(flow?.getNodes)?.find(node => node.type === 'subsystem-detail');
    const width = node?.dimensions.width || readingWidth(canvas.value.clientWidth);
    const height = Math.min(node?.dimensions.height || canvas.value.clientHeight - 48, canvas.value.clientHeight - 48);
    // Detail can grow after the skeleton paints. A stable top inset keeps its
    // first signatures readable without shifting again when analysis arrives.
    const destination = { x: (canvas.value.clientWidth - width) / 2, y: 24, zoom: 1 };
    if (origin) {
      const zoom = Math.min(1, origin.width / width);
      await flow.setViewport({ x: origin.x + origin.width / 2 - width * zoom / 2, y: origin.y + origin.height / 2 - height * zoom / 2, zoom }, { duration: 0 });
    }
    moveCamera(destination, { done: () => { transitioning = false; } });
  }
  async function closeDetail(event) {
    const external = outline.value?.owner.opaque;
    const currentViewport = flow?.getViewport();
    const detailWidth = unref(flow?.getNodes)?.find(node => node.type === 'subsystem-detail')?.dimensions.width || readingWidth(canvas.value.clientWidth);
    const detailHeight = unref(flow?.getNodes)?.find(node => node.type === 'subsystem-detail')?.dimensions.height || canvas.value.clientHeight;
    const outAnchor = zoomAnchor || { x: canvas.value.clientWidth / 2, y: canvas.value.clientHeight / 2 };
    stopZoomMotion();
    ++navigationVersion;
    if (event?.type === 'click' || event?.type === 'keydown') gestureTarget = undefined;
    else if (gestureTarget) gestureTarget.consumed = true;
    transitioning = true;
    expandedSubsystemId.value = '';
    fileRequest.value = null;
    retainedFileRequest.value = null; retainedOutline.value = null; programId.value = ''; retainedProgramId.value = '';
    viewHistory.value = [];
    zoomTarget = undefined;
    await nextTick();
    if (!external && parentViewport && parentNode && currentViewport) {
      const zoom = Math.min(3, detailWidth * currentViewport.zoom / parseFloat(parentNode.style.width));
      // Match the parent's screen centre/size before the camera moves outward.
      // The diagram data stays cached; no analysis is rebuilt during this motion.
      const centreX = currentViewport.x + detailWidth * currentViewport.zoom / 2;
      const centreY = currentViewport.y + Math.min(detailHeight, canvas.value.clientHeight) * currentViewport.zoom / 2;
      const matched = { zoom, x: centreX - (parentNode.position.x + parseFloat(parentNode.style.width) / 2) * zoom,
        y: centreY - (parentNode.position.y + parseFloat(parentNode.style.height) / 2) * zoom };
      await flow?.setViewport(matched, { duration: 0 });
      const destination = { zoom: parentViewport.zoom, x: outAnchor.x - (outAnchor.x - matched.x) / zoom * parentViewport.zoom,
        y: outAnchor.y - (outAnchor.y - matched.y) / zoom * parentViewport.zoom };
      moveCamera(destination, { done: () => { transitioning = false; } });
      return;
    }
    transitioning = false;
  }
  function rememberView() {
    viewHistory.value = [...viewHistory.value, {
      request: fileRequest.value && { ...fileRequest.value }, programId: programId.value, ownerId: expandedSubsystemId.value,
      parentNode, parentViewport, fileParentViewport, viewport: { ...flow.getViewport() }
    }];
  }
  async function openProgram(id) {
    const program = architecture.value?.program?.modules?.find(program => program.id === id);
    if (!program || programId.value === id) return;
    rememberView();
    const ownerNode = nodes.value.find(node => node.id === program.subsystemId);
    if (ownerNode && program.subsystemId !== expandedSubsystemId.value) {
      parentNode = { position: { ...ownerNode.position }, style: { ...ownerNode.style } };
      expandedSubsystemId.value = program.subsystemId;
    }
    programId.value = id;
    retainedProgramId.value = id;
    fileRequest.value = null;
    await readingViewport();
  }
  async function openFile(request) {
    // Explanatory documents are Program views, never file-navigation targets.
    const program = architecture.value?.program?.modules?.find(program => program.path === request.path);
    if (program) return openProgram(program.id);
    if (request.path === 'genesis/subsystems.md' || request.path.startsWith('genesis/program/')) return;
    if (fileRequest.value?.path === request.path && !request.symbolId && !request.symbol && !request.presentation) return;
    rememberView();
    programId.value = '';
    const file = architecture.value?.files?.find(file => file.path === request.path);
    const ownerNode = nodes.value.find(node => node.id === file?.subsystemId);
    if (ownerNode && file.subsystemId !== expandedSubsystemId.value) {
      parentNode = { position: { ...ownerNode.position }, style: { ...ownerNode.style } };
      expandedSubsystemId.value = file.subsystemId;
    }
    // Return to the enclosing reading view, before its icon grew to entry size.
    fileParentViewport = gestureDirection === true && zoomTarget?.kind === 'file' ? gestureTarget.viewport
      : { ...(zoomMotion && !zoomMotion.semantic ? zoomMotion.viewport : flow.getViewport()) };
    fileRequest.value = { path: request.path, symbolId: request.symbolId, symbol: request.symbol, line: request.line, presentation: request.presentation || 'interface', symbolPresentation: request.symbolPresentation };
    retainedFileRequest.value = fileRequest.value;
    zoomTarget = undefined;
    await readingViewport();
  }
  function updateFileLocation(location) {
    if (!fileRequest.value || location.path !== fileRequest.value.path) return;
    if (['symbolId', 'presentation', 'symbolPresentation'].every(key => fileRequest.value[key] === location[key])) return;
    fileRequest.value = { ...fileRequest.value, ...location };
    retainedFileRequest.value = fileRequest.value;
  }
  async function goBack(event) {
    const previous = viewHistory.value.at(-1);
    if (!previous) return closeDetail(event);
    ++navigationVersion;
    stopZoomMotion();
    gestureTarget = undefined;
    transitioning = false;
    viewHistory.value = viewHistory.value.slice(0, -1);
    expandedSubsystemId.value = previous.request
      ? architecture.value.files.find(file => file.path === previous.request.path)?.subsystemId || previous.ownerId
      : architecture.value.program?.modules?.find(program => program.id === previous.programId)?.subsystemId || previous.ownerId;
    parentNode = previous.parentNode;
    parentViewport = previous.parentViewport;
    fileParentViewport = previous.fileParentViewport;
    fileRequest.value = previous.request;
    if (previous.request) retainedFileRequest.value = previous.request;
    programId.value = previous.programId || '';
    if (previous.programId) retainedProgramId.value = previous.programId;
    await nextTick();
    await flow.setViewport(previous.viewport, { duration: 0 });
  }
  async function showSubsystem() {
    ++navigationVersion;
    stopZoomMotion();
    if (gestureTarget) gestureTarget.consumed = true;
    transitioning = true;
    canvas.value?.focus({ preventScroll: true });
    fileRequest.value = null;
    programId.value = '';
    viewHistory.value = [];
    await nextTick();
    moveCamera(fileParentViewport || { x: 24, y: 24, zoom: 1 }, { done: () => { transitioning = false; } });
  }
  const nodes = shallowRef([]);
  const edges = shallowRef([]);
  const showCalls = ref(false);
  const selectedPageId = ref('');
  const visibleEdges = computed(() => (focusOwner.value && !focusOwner.value.opaque ? [] : edges.value).filter(edge => edge.type !== 'controller' || showCalls.value || edge.source === selectedPageId.value).map(edge =>
    expandedSubsystemId.value && edge.type !== 'controller' ? { ...edge, style: { ...edge.style, opacity: edge.source === expandedSubsystemId.value || edge.target === expandedSubsystemId.value ? 0.4 : 0.05 } } : edge));
  function toggleCalls() { showCalls.value = !showCalls.value; selectedPageId.value = ''; }
  function selectNode({ node, event }) {
    if (node.type === 'page') { selectedPageId.value = node.id; showCalls.value = false; }
    else if (node.type === 'subsystem' && !node.data.opaque && !dragging && Date.now() - lastDragEnded > 250 && !event?.target?.closest('.engine-subsystem__grip')) {
      gestureTarget = undefined;
      enterSubsystem(node, flow.getViewport());
    }
  }
  function clearSelection() { selectedPageId.value = ''; }
  function startDrag() { dragging = true; }
  function rearrangeSubsystem({ node }) {
    dragging = false;
    lastDragEnded = Date.now();
    if (!node.data.arrangeable) return;
    layoutPositions.value = { ...layoutPositions.value, [node.id]: { ...node.position } };
  }
  function moveSubsystem(id, direction) {
    const node = nodes.value.find(entry => entry.id === id);
    if (!node) return;
    rearrangeSubsystem({ node: { ...node, position: { ...node.position, x: node.position.x + direction * 32 } } });
  }
  function captureZoomAnchor(event) {
    const rect = canvas.value.getBoundingClientRect();
    zoomAnchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const element = event.target.closest('[data-zoom-kind]');
    zoomTarget = element ? { kind: element.dataset.zoomKind, path: element.dataset.filePath, element } : undefined;
  }
  function zoomGesture(event, factor, inward) {
    const current = flow.getViewport();
    if (!gestureTarget || gestureDirection !== inward) {
      captureZoomAnchor(event);
      const hovered = event.target.closest('.vue-flow__node');
      const node = nodes.value.find(node => node.id === hovered?.dataset.id);
      const element = inward ? zoomTarget?.element : undefined;
      const rect = element?.getBoundingClientRect();
      const canvasRect = canvas.value.getBoundingClientRect();
      const centred = inward && (element || node && node.type !== 'subsystem-detail' && node.type !== 'annotation');
      const point = rect ? { x: (rect.x - canvasRect.x + rect.width / 2 - current.x) / current.zoom, y: (rect.y - canvasRect.y + rect.height / 2 - current.y) / current.zoom }
        : centred ? { x: node.position.x + parseFloat(node.style.width) / 2, y: node.position.y + parseFloat(node.style.height) / 2 }
          : { x: (zoomAnchor.x - current.x) / current.zoom, y: (zoomAnchor.y - current.y) / current.zoom };
      gestureTarget = { point, anchor: centred ? { x: canvas.value.clientWidth / 2, y: canvas.value.clientHeight / 2 } : { ...zoomAnchor }, detail: zoomTarget, nodeId: node?.id, viewport: { ...current } };
      gestureDirection = inward;
    }
    clearTimeout(gestureTimer);
    gestureTimer = setTimeout(finishGesture, 220);
    if (gestureTarget.consumed) return;
    // A reversed gesture interrupts camera navigation without awaiting a D3
    // transition promise that may never resolve after interruption.
    if (transitioning) { ++navigationVersion; transitioning = false; stopZoomMotion(); }
    const zoom = Math.max(0.08, Math.min(3, (zoomMotion?.viewport.zoom || current.zoom) * factor));
    zoomTarget = gestureTarget.detail;
    zoomAnchor = gestureTarget.anchor;
    moveCamera({ zoom, x: zoomAnchor.x - gestureTarget.point.x * zoom, y: zoomAnchor.y - gestureTarget.point.y * zoom }, { semantic: true });
  }
  function zoomWheel(event) {
    if (!flow || !props.active || focusOwner.value?.opaque || !event.deltaY) return;
    // Ordinary wheel/touchpad scrolling belongs to the expanded square, even
    // at its scroll boundary. Zoom only outside it or with an explicit pinch.
    if (!event.ctrlKey && event.target.closest('.subsystem-zoom')) return;
    event.preventDefault();
    event.stopPropagation();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.value.clientHeight : 1);
    zoomGesture(event, 2 ** (-Math.max(-300, Math.min(300, delta)) * (event.ctrlKey ? 0.006 : 0.003)), delta < 0);
  }
  function startPinch(event) {
    if (event.touches.length !== 2 || !flow || focusOwner.value?.opaque) return;
    event.preventDefault(); event.stopPropagation();
    pinchDistance = touchDistance(event.touches);
    pinchTarget = event.target;
    gestureTarget = undefined;
  }
  function movePinch(event) {
    if (event.touches.length !== 2 || !pinchDistance || !props.active) return;
    event.preventDefault(); event.stopPropagation();
    const distance = touchDistance(event.touches);
    if (!distance || distance === pinchDistance) return;
    const factor = distance / pinchDistance;
    zoomGesture({ target: pinchTarget, clientX: (event.touches[0].clientX + event.touches[1].clientX) / 2, clientY: (event.touches[0].clientY + event.touches[1].clientY) / 2 }, factor, factor > 1);
    clearTimeout(gestureTimer);
    pinchDistance = distance;
  }
  function endPinch(event) { if (event.touches.length < 2) { pinchDistance = undefined; pinchTarget = undefined; gestureTimer = setTimeout(finishGesture, 220); } }
  function zoomControl(inward) {
    if (!flow || !canvas.value) return;
    gestureTarget = undefined;
    const rect = canvas.value.getBoundingClientRect();
    zoomGesture({ target: canvas.value, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 }, inward ? 1.4 : 1 / 1.4, inward);
  }
  function enterSubsystem(node, viewport) {
    if (expandedSubsystemId.value || !canvas.value) return;
    parentNode = { position: { ...node.position }, style: { ...node.style } };
    parentViewport = gestureTarget ? { ...gestureTarget.viewport } : { ...viewport };
    expandedSubsystemId.value = node.id;
    void readingViewport({ x: node.position.x * viewport.zoom + viewport.x, y: node.position.y * viewport.zoom + viewport.y,
      width: parseFloat(node.style.width) * viewport.zoom, height: parseFloat(node.style.height) * viewport.zoom });
  }
  function viewportChanged(viewport) {
    if (!props.active || !canvas.value || !contentCount.value || dragging || transitioning) return;
    if (focusOwner.value?.opaque) { zoomAnchor = undefined; return; }
    const rect = canvas.value.getBoundingClientRect();
    if (outline.value && !outline.value.owner.opaque) {
      if (viewport.zoom < 0.7) {
        if (fileRequest.value || programId.value) void goBack();
        else void closeDetail();
      }
      return;
    }
    const centerX = ((zoomAnchor?.x ?? rect.width / 2) - viewport.x) / viewport.zoom;
    const centerY = ((zoomAnchor?.y ?? rect.height / 2) - viewport.y) / viewport.zoom;
    const candidate = gestureDirection === true && nodes.value.find(node => node.type === 'subsystem' && node.id === gestureTarget?.nodeId && !node.data.opaque
      && parseFloat(node.style.width) * viewport.zoom >= Math.min(560, rect.width * 0.8)
      && centerX >= node.position.x && centerX <= node.position.x + parseFloat(node.style.width)
      && centerY >= node.position.y && centerY <= node.position.y + parseFloat(node.style.height));
    if (candidate) {
      enterSubsystem(candidate, viewport);
    }
  }

  const uiIds = ref([]);
  const engineIds = ref([]);
  const externalCount = ref(0);
  const initialIds = ref([]);
  const contentCount = computed(() => uiIds.value.length + engineIds.value.length);
  let flow;
  const flowReady = ref(false);
  let fitPending = true;
  async function fit(ids) {
    if (!flow || !props.active || !contentCount.value || usageState.value.view !== 'map') return;
    stopZoomMotion();
    ++navigationVersion;
    gestureTarget = undefined;
    transitioning = true;
    if (focusOwner.value && !focusOwner.value.opaque) {
      expandedSubsystemId.value = ''; fileRequest.value = null; retainedFileRequest.value = null; retainedOutline.value = null; programId.value = ''; retainedProgramId.value = ''; viewHistory.value = [];
      ids = undefined;
    }
    await nextTick();
    const measured = unref(flow.getNodes);
    if (measured.length !== nodes.value.length || measured.some(node => !node.dimensions.width || !node.dimensions.height)) { transitioning = false; return; }
    await flow.fitView({ nodes: Array.isArray(ids) ? ids : undefined, padding: 0.12, maxZoom: 1, duration: 0 });
    transitioning = false;
    fitPending = false;
  }
  async function initialize(instance) { flow = instance; await fit(initialIds.value); flowReady.value = true; }
  function fitIfPending() { if (fitPending) void fit(initialIds.value); }
  // Returning to Map fits the diagram once it has painted, when a fit is still owed.
  function fitWhenMapShown() { if (fitPending) void nextTick(() => fit(initialIds.value)); }
  // Index snapshots are immutable. Traversing reactive proxies for every symbol
  // adds work without making the displayed facts any more current.
  const overview = computed(() => architectureOverview(toRaw(architecture.value)));
  watch([overview, expandedSubsystemId, layoutPositions], ([diagram, expanded, positions], previous) => {
    if (architecture.value && expanded) {
      const currentOwner = fileRequest.value
        ? architecture.value.files.find(file => file.path === fileRequest.value.path)?.subsystemId
        : currentProgram.value?.subsystemId;
      if (currentOwner && currentOwner !== expanded) expandedSubsystemId.value = currentOwner;
      else if (!focusOwner.value) {
        expandedSubsystemId.value = ''; fileRequest.value = null; programId.value = ''; viewHistory.value = [];
      }
    }
    const arranged = arrangedMapNodes(diagram.nodes, positions);
    if (!(architecture.value?.ui?.pages || []).some(page => page.id === selectedPageId.value)) selectedPageId.value = '';
    const focused = focusOwner.value && !focusOwner.value.opaque;
    nodes.value = focused ? readingNodes(arranged, outline.value, focusOwner.value) : arranged;
    edges.value = diagram.edges;
    uiIds.value = diagram.uiIds;
    engineIds.value = diagram.engineIds;
    externalCount.value = diagram.externalCount;
    initialIds.value = diagram.initialIds;
    if (!previous || diagram !== previous[0]) {
      fitPending = true;
      if (!expandedSubsystemId.value) void fit(initialIds.value);
    }
  }, { immediate: true });
  watch([outline, fileRequest, programId], ([detail, file, program]) => {
    // Detail arriving must not rebuild the retained map during its animation.
    flow?.updateNodeData('visual:subsystem-detail', { outline: detail });
    // Following a consumer into another owner must not replace the hidden
    // signature list, file disclosures or search that Back will return to.
    if (detail && detail.owner.id === expandedSubsystemId.value && !file && !program) retainedOutline.value = detail;
  });
  watch(() => props.sessionId, () => { ++navigationVersion; stopZoomMotion(); clearTimeout(gestureTimer); gestureTarget = undefined; transitioning = false; expandedSubsystemId.value = ''; fileRequest.value = null; retainedFileRequest.value = null; retainedOutline.value = null; programId.value = ''; retainedProgramId.value = ''; viewHistory.value = []; selectedPageId.value = ''; showCalls.value = false; layoutPositions.value = {}; zoomAnchor = undefined; zoomTarget = undefined; parentViewport = undefined; fileParentViewport = undefined; });
  let handledProgramRequest;
  watch([() => props.openProgramRequest, architecture, () => props.active, flowReady], ([request, snapshot, active, ready]) => {
    if (!ready || !active || !request || handledProgramRequest === request || !snapshot?.program?.modules.some(program => program.id === request.id)) return;
    handledProgramRequest = request;
    void openProgram(request.id);
  });
  watch(architecture, snapshot => {
    if (programId.value && !snapshot?.program?.modules.some(program => program.id === programId.value)) void showSubsystem();
  });
  watch(() => props.active, active => { if (!active) { ++navigationVersion; stopZoomMotion(); clearTimeout(gestureTimer); gestureTarget = undefined; transitioning = false; } else if (fitPending) void fit(initialIds.value); });
  watch(canvas, (element, previous, onCleanup) => {
    if (!element) return;
    // Disabling a generation button can release focus to body. Escape still
    // closes this reader, without handling keys from chat or another dialog.
    const pageEscape = event => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.target !== document.body || !props.active || usageState.value.view !== 'map' || !expandedSubsystemId.value) return;
      event.preventDefault();
      void goBack(event);
    };
    document.addEventListener('keydown', pageEscape);
    let width = element.clientWidth;
    let height = element.clientHeight;
    const observer = new ResizeObserver(() => {
      const nextWidth = element.clientWidth;
      const nextHeight = element.clientHeight;
      if (!nextWidth || !nextHeight || (width === nextWidth && height === nextHeight)) return;
      const oldWidth = width;
      width = nextWidth; height = nextHeight;
      if (!props.active || !flow || !expandedSubsystemId.value || focusOwner.value?.opaque) return;
      // Preserve magnification, scroll and the square's offset from the canvas
      // centre. Responsive CSS changes its width without remounting its content.
      const adapt = viewport => adaptViewport(viewport, width, oldWidth);
      stopZoomMotion();
      ++navigationVersion;
      clearTimeout(gestureTimer);
      gestureTarget = undefined; zoomTarget = undefined; zoomAnchor = undefined;
      transitioning = false;
      fileParentViewport = adapt(fileParentViewport);
      viewHistory.value = viewHistory.value.map(entry => ({ ...entry, viewport: adapt(entry.viewport), fileParentViewport: adapt(entry.fileParentViewport) }));
      void flow.setViewport(adapt(flow.getViewport()), { duration: 0 });
    });
    observer.observe(element);
    onCleanup(() => { observer.disconnect(); document.removeEventListener('keydown', pageEscape); });
  }, { flush: 'post' });
  onBeforeUnmount(() => { stopZoomMotion(); clearTimeout(gestureTimer); });

  return {
    expandedSubsystemId,
    outline,
    retainedOutline,
    layoutPositions,
    fileRequest,
    retainedFileRequest,
    programId,
    currentProgram,
    retainedProgram,
    parentProgram,
    nodes,
    edges,
    showCalls,
    selectedPageId,
    visibleEdges,
    uiIds,
    engineIds,
    externalCount,
    contentCount,
    closeDetail,
    openProgram,
    openFile,
    updateFileLocation,
    goBack,
    showSubsystem,
    toggleCalls,
    selectNode,
    clearSelection,
    startDrag,
    rearrangeSubsystem,
    moveSubsystem,
    zoomWheel,
    startPinch,
    movePinch,
    endPinch,
    zoomControl,
    viewportChanged,
    fit,
    initialize,
    fitIfPending,
    fitWhenMapShown
  };
}
