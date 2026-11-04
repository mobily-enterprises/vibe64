// The Map canvas's pure geometry: the nodes it draws for an architecture
// overview, the reading sheet's size and the camera's steps. Nothing here
// reads the page; the canvas composable supplies every measurement.

/** The reading sheet's width on a canvas this wide: the canvas less its inset, within 280–960 px. */
export function readingWidth(canvasWidth) {
  return Math.min(960, Math.max(280, canvasWidth - 48));
}

/** One animation frame's step of the camera towards its destination, and whether it has arrived. */
export function easedViewport(current, destination, elapsed) {
  const amount = 1 - Math.exp(-Math.min(50, elapsed) / 45);
  const next = { x: current.x + (destination.x - current.x) * amount, y: current.y + (destination.y - current.y) * amount, zoom: current.zoom + (destination.zoom - current.zoom) * amount };
  const complete = Math.abs(next.zoom - destination.zoom) < 0.001 && Math.abs(next.x - destination.x) < 0.3 && Math.abs(next.y - destination.y) < 0.3;
  return { next, complete };
}

/**
 * A viewport after the canvas resized from oldWidth to width: the same magnification and scroll, and the reading
 * sheet's offset from the canvas centre, which responsive CSS changes without remounting its content.
 */
export function adaptViewport(viewport, width, oldWidth) {
  return viewport && ({ ...viewport, x: viewport.x + (width - oldWidth) / 2 + (readingWidth(oldWidth) - readingWidth(width)) * viewport.zoom / 2 });
}

/** The distance between the two fingers of a pinch. */
export function touchDistance(touches) {
  return Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
}

/** The overview's nodes, each arrangeable subsystem at its remembered position kept inside its layer. */
export function arrangedMapNodes(nodes, positions) {
  const arranged = nodes.map(node => ({ ...node, class: node.class || '', position: { ...node.position } }));
  for (const node of arranged) if (node.data.arrangeable && positions[node.id]) {
    const [minimum, maximum] = node.extent;
    node.position = { x: Math.max(minimum[0], Math.min(maximum[0] - parseFloat(node.style.width), positions[node.id].x)),
      y: Math.max(minimum[1], Math.min(maximum[1] - parseFloat(node.style.height), positions[node.id].y)) };
  }
  return arranged;
}

/**
 * The map while a subsystem is read: its node IDs and types stay mounted but hidden, which keeps their DOM and
 * VueFlow geometry rather than reconstructing the map on zoom-out, under one reading sheet.
 */
export function readingNodes(arranged, outline, owner) {
  return [...arranged.map(node => ({ ...node, class: 'architecture-map-node--hidden' })),
    { id: 'visual:subsystem-detail', type: 'subsystem-detail', position: { x: 0, y: 0 }, draggable: false,
      style: { width: 'clamp(280px, calc(100cqw - 48px), 960px)' }, data: { outline, owner } }];
}

/** A UI call's straight line from its page to its operation. */
export function controllerPath(edge) {
  const { sourceX, sourceY, targetX, targetY } = edge;
  return `M ${sourceX},${sourceY} L ${targetX},${targetY}`;
}
