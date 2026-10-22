// Where the guide caption sits around its ringed control. Pure geometry: the
// overlay measures the ring, the caption and the viewport, and applies the
// result.
//
// The caption goes beside the ring (right, then left), else below, else
// above: the first side where it fits whole in the viewport, never over the
// ring, and clear of every `avoid` rect (the lesson step bar the learner is
// reading). When every fitting side covers an avoid rect, the side covering
// the least of them wins. A ring with no room around it (a pane filling a phone
// screen) gets the caption inside its top edge, without a pointer.
//
// `arrow` is the pointer's offset along the caption edge facing the ring:
// from the caption's top for right/left, from its left for below/above.
const SIDES = Object.freeze(["right", "left", "below", "above"]);
const ARROW_INSET = 20;

function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max));
}

function coveredArea(a, b) {
  const width = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
  const height = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
  return Math.max(0, width) * Math.max(0, height);
}

function besideTop(ring, caption, viewport, margin) {
  return clamp(ring.top + ring.height / 2 - caption.height / 2, margin, viewport.height - margin - caption.height);
}

function stackedLeft(ring, caption, viewport, margin) {
  return clamp(ring.left, margin, viewport.width - margin - caption.width);
}

function candidate(side, ring, caption, viewport, { gap, margin }) {
  switch (side) {
    case "right": return { top: besideTop(ring, caption, viewport, margin), left: ring.left + ring.width + gap };
    case "left": return { top: besideTop(ring, caption, viewport, margin), left: ring.left - gap - caption.width };
    case "below": return { top: ring.top + ring.height + gap, left: stackedLeft(ring, caption, viewport, margin) };
    default: return { top: ring.top - gap - caption.height, left: stackedLeft(ring, caption, viewport, margin) };
  }
}

function fits(box, caption, viewport, margin) {
  return box.left >= margin && box.top >= margin &&
    box.left + caption.width <= viewport.width - margin && box.top + caption.height <= viewport.height - margin;
}

function arrowOffset(side, box, ring, caption) {
  const beside = side === "right" || side === "left";
  const centre = beside ? ring.top + ring.height / 2 - box.top : ring.left + ring.width / 2 - box.left;
  const length = beside ? caption.height : caption.width;
  return clamp(centre, Math.min(ARROW_INSET, length / 2), Math.max(length - ARROW_INSET, length / 2));
}

function placeGuideCaption({ ring, caption, viewport, avoid = [], gap = 14, margin = 8 }) {
  const placements = SIDES
    .map(side => ({ side, ...candidate(side, ring, caption, viewport, { gap, margin }) }))
    .filter(box => fits(box, caption, viewport, margin));
  const covered = box => avoid.reduce((sum, rect) => sum + coveredArea({ ...box, ...caption }, rect), 0);
  const chosen = placements.reduce((best, box) => best && covered(best) <= covered(box) ? best : box, null);
  if (chosen) return { ...chosen, arrow: arrowOffset(chosen.side, chosen, ring, caption) };
  return { side: "inside", top: Math.max(margin, ring.top) + gap, left: stackedLeft(ring, caption, viewport, margin), arrow: 0 };
}

export { placeGuideCaption };
