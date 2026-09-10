const CLEARANCE = 14;
const STUB = 18;
const BEND_COST = 32;

export function erdObstacles(nodes = [], clearance = CLEARANCE) {
  return nodes.map((node) => ({
    id: node.id,
    left: node.position.x - clearance,
    right: node.position.x + node.dimensions.width + clearance,
    top: node.position.y - clearance,
    bottom: node.position.y + node.dimensions.height + clearance
  }));
}

export function segmentBlocked(a, b, obstacles, ignoreStart = null, ignoreEnd = null) {
  return obstacles.some((box) => box.id !== ignoreStart && box.id !== ignoreEnd && (a.x === b.x
    ? a.x > box.left && a.x < box.right && Math.max(a.y, b.y) > box.top && Math.min(a.y, b.y) < box.bottom
    : a.y > box.top && a.y < box.bottom && Math.max(a.x, b.x) > box.left && Math.min(a.x, b.x) < box.right));
}

function compact(points) {
  const result = [];
  for (const point of points) {
    const last = result.at(-1);
    if (last && last.x === point.x && last.y === point.y) continue;
    const before = result.at(-2);
    if (before && ((before.x === last.x && last.x === point.x) || (before.y === last.y && last.y === point.y))) result.pop();
    result.push(point);
  }
  return result;
}

export function erdPathClear(points, obstacles, source, target) {
  return points?.length > 1 && points.slice(1).every((point, index) =>
    !segmentBlocked(points[index], point, obstacles, index === 0 ? source : null, index === points.length - 2 ? target : null));
}

function segmentPenalty(a, b, occupied) {
  let cost = 0;
  const vertical = a.x === b.x;
  for (const [c, d] of occupied) {
    const otherVertical = c.x === d.x;
    if (vertical === otherVertical) {
      const distance = Math.abs(vertical ? a.x - c.x : a.y - c.y);
      if (distance >= 7) continue;
      const overlap = vertical
        ? Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) - Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y))
        : Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x));
      if (overlap > 0) cost += overlap * (distance < 1 ? 8 : 3);
    } else {
      const v1 = vertical ? a : c;
      const v2 = vertical ? b : d;
      const h1 = vertical ? c : a;
      const h2 = vertical ? d : b;
      if (v1.x > Math.min(h1.x, h2.x) && v1.x < Math.max(h1.x, h2.x) &&
        h1.y > Math.min(v1.y, v2.y) && h1.y < Math.max(v1.y, v2.y)) cost += 48;
    }
  }
  return cost;
}

// A small binary heap keeps routing proportional to the explored corridors.
function push(queue, item) {
  let index = queue.length;
  queue.push(item);
  while (index > 0) {
    const parent = (index - 1) >> 1;
    if (queue[parent].score <= item.score) break;
    queue[index] = queue[parent];
    index = parent;
  }
  queue[index] = item;
}

function pop(queue) {
  const first = queue[0];
  const last = queue.pop();
  if (queue.length) {
    let index = 0;
    while (index * 2 + 1 < queue.length) {
      let child = index * 2 + 1;
      if (child + 1 < queue.length && queue[child + 1].score < queue[child].score) child += 1;
      if (queue[child].score >= last.score) break;
      queue[index] = queue[child];
      index = child;
    }
    queue[index] = last;
  }
  return first;
}

export function routeErdConnection(route, obstacles, occupied = [], index = 0, dragging = false) {
  const start = route.start;
  const end = route.end;
  const stub = route.stubLength ?? STUB;
  const offsets = { left: [-stub, 0], right: [stub, 0], top: [0, -stub], bottom: [0, stub] };
  const [sourceX, sourceY] = offsets[route.sourcePosition];
  const [targetX, targetY] = offsets[route.targetPosition];
  const from = { x: start.x + sourceX, y: start.y + sourceY };
  const to = { x: end.x + targetX, y: end.y + targetY };
  const basic = compact([start, from, { x: route.laneX, y: from.y }, { x: route.laneX, y: to.y }, to, end]);
  if (dragging) return { points: basic, obstructed: !erdPathClear(basic, obstacles, route.source, route.target) };
  // Expanded or overlapping cards can enclose an endpoint. No grid search can
  // escape that obstacle, regardless of how many corridors it explores.
  if (obstacles.some((box) => [from, to].some((point) => point.x > box.left && point.x < box.right && point.y > box.top && point.y < box.bottom)) ||
      segmentBlocked(start, from, obstacles.filter((box) => box.id !== route.source)) ||
      segmentBlocked(to, end, obstacles.filter((box) => box.id !== route.target))) {
    return { points: basic, obstructed: true };
  }
  const gap = 4 + (index % 7) * 8;
  const xs = [...new Set([from.x, to.x, route.laneX, ...obstacles.flatMap((box) => [box.left - gap, box.right + gap])])].sort((a, b) => a - b);
  const ys = [...new Set([from.y, to.y, ...obstacles.flatMap((box) => [box.top - gap, box.bottom + gap])])].sort((a, b) => a - b);
  // Most links need only one clear horizontal or vertical corridor. Check those
  // before searching the full obstacle grid; dense schemas otherwise make the
  // crossing penalties explore tens of thousands of points for each link.
  const candidates = [
    ...xs.map((x) => compact([start, from, { x, y: from.y }, { x, y: to.y }, to, end])),
    ...ys.map((y) => compact([start, from, { x: from.x, y }, { x: to.x, y }, to, end]))
  ].map((points) => ({
    points,
    cost: points.slice(1).reduce((sum, b, i) => sum + Math.abs(points[i].x - b.x) + Math.abs(points[i].y - b.y) + BEND_COST, 0)
  })).sort((a, b) => a.cost - b.cost);
  let best = null;
  let bestScore = Infinity;
  for (const { points, cost } of candidates) {
    // Crossing penalties only add cost. Longer candidates cannot improve an
    // already cheaper route, so avoid scoring their runs against every edge.
    if (cost >= bestScore) break;
    if (!erdPathClear(points, obstacles, route.source, route.target)) continue;
    let score = cost;
    for (let i = 1; i < points.length && score < bestScore; i += 1) score += segmentPenalty(points[i - 1], points[i], occupied);
    if (!best || score < bestScore) {
      best = points;
      bestScore = score;
    }
  }
  if (best) return { points: best, obstructed: false };
  const width = xs.length;
  const startId = ys.indexOf(from.y) * width + xs.indexOf(from.x);
  const endId = ys.indexOf(to.y) * width + xs.indexOf(to.x);
  const point = (id) => ({ x: xs[id % width], y: ys[Math.floor(id / width)] });
  const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  const costs = new Map([[startId * 2, 0]]);
  const previous = new Map();
  const queue = [];
  push(queue, { key: startId * 2, cost: 0, score: distance(from, to) });
  let finish = null;
  // Crowded or overlapping cards must never cause an unbounded route search.
  let explored = 0;
  while (queue.length && explored < 2000) {
    explored += 1;
    const current = pop(queue);
    if (costs.get(current.key) !== current.cost) continue;
    const id = Math.floor(current.key / 2);
    if (id === endId) { finish = current.key; break; }
    const x = id % width;
    const y = Math.floor(id / width);
    const a = point(id);
    const neighbours = [
      ...(x > 0 ? [[id - 1, 0]] : []), ...(x + 1 < width ? [[id + 1, 0]] : []),
      ...(y > 0 ? [[id - width, 1]] : []), ...(y + 1 < ys.length ? [[id + width, 1]] : [])
    ];
    for (const [next, direction] of neighbours) {
      const b = point(next);
      if (segmentBlocked(a, b, obstacles)) continue;
      const key = next * 2 + direction;
      // Corridor candidates already prefer fewer crossings. In the bounded
      // fallback, prioritise reaching the target around cards: crossing costs
      // otherwise exhaust the search on large, well-spaced radial diagrams.
      const cost = current.cost + distance(a, b) + (direction === current.key % 2 ? 0 : BEND_COST);
      if (cost >= (costs.get(key) ?? Infinity)) continue;
      costs.set(key, cost);
      previous.set(key, current.key);
      push(queue, { key, cost, score: cost + 1.25 * distance(b, to) });
    }
  }
  if (finish === null) {
    return { points: basic, obstructed: true };
  }
  const middle = [];
  for (let key = finish; key !== undefined; key = previous.get(key)) middle.push(point(Math.floor(key / 2)));
  const points = compact([start, ...middle.reverse(), end]);
  return { points, obstructed: !erdPathClear(points, obstacles, route.source, route.target) };
}

export function erdPolylinePath(points = []) {
  if (!points.length) return ["", 0, 0];
  const segments = points.slice(1).map((point, index) => ({
    a: points[index], b: point,
    length: Math.abs(point.x - points[index].x) + Math.abs(point.y - points[index].y)
  }));
  const longest = [...segments].sort((a, b) => b.length - a.length)[0];
  return [
    points.map((point, index) => `${index ? "L" : "M"}${point.x} ${point.y}`).join(""),
    longest ? (longest.a.x + longest.b.x) / 2 : points[0].x,
    longest ? (longest.a.y + longest.b.y) / 2 : points[0].y
  ];
}
