import { shallowRef } from "vue";

// One browser-wide teacher guide. The overlay component draws it; this module
// only resolves the real control and reports truthfully whether it was drawn.
const TRAINING_GUIDE_DURATION_MS = 8000;
const trainingGuide = shallowRef(null);
let overlays = 0;
let sequence = 0;

function registerTrainingGuideOverlay() {
  overlays += 1;
  let registered = true;
  return () => {
    if (!registered) return;
    registered = false;
    overlays -= 1;
    if (overlays === 0) trainingGuide.value = null;
  };
}

function cssString(value) {
  return String(value).replace(/["\\]/gu, "\\$&");
}

// A step is a control (`data-vibe64-guide`) or, when that place is already
// open, the pane showing it (`data-vibe64-guide-pane`): on a phone the header
// tabs and Dashboard menu are hidden while the open pane fills the screen.
function stepSelectors(step) {
  if (step.id === "file") return [`[data-vibe64-guide-path="${cssString(step.path)}"]`];
  const id = cssString(step.id);
  return [`[data-vibe64-guide="${id}"]`, `[data-vibe64-guide-pane="${id}"]`];
}

function visibleStepElement(step, root) {
  for (const selector of stepSelectors(step)) {
    const element = [...root.querySelectorAll(selector)].find(guideElementVisible);
    if (element) return element;
  }
  return null;
}

function guideElementVisible(element) {
  if (!element?.isConnected || element.closest("[inert], [aria-hidden='true']")) return false;
  if (typeof element.checkVisibility === "function" && !element.checkVisibility({ visibilityProperty: true })) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

// The deepest visible step is the next control the learner must click, or
// the open pane itself when the learner is already there. A step's control
// wins over its pane.
function findTrainingGuideStep(steps = [], root = globalThis.document) {
  if (!root) return null;
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const element = visibleStepElement(steps[index], root);
    if (element) return { step: steps[index], element, final: index === steps.length - 1 };
  }
  return null;
}

// On a phone the chat and each pane fill the screen, so when the place is in
// the other pane (or the chat is showing) no step on the path is visible. The
// header's pane switch is then the next real control to click;
// the caption still names the whole path. Prefer the last visible switch: the
// next-pane button follows the chat toggle in the header.
const PANE_SWITCH = "pane-switch";
function findPaneSwitch(root = globalThis.document) {
  if (!root) return null;
  return [...root.querySelectorAll(`[data-vibe64-guide="${PANE_SWITCH}"]`)].filter(guideElementVisible).at(-1) || null;
}

function clearTrainingGuide(id) {
  if (!id || trainingGuide.value?.id === id) trainingGuide.value = null;
}

// Draw one guide. settleMs waits briefly for a navigated view to render its
// final control; the receipt names the step actually ringed, never a guess.
async function showTrainingGuide(guide, { settleMs = 0, durationMs = TRAINING_GUIDE_DURATION_MS } = {}) {
  if (!guide?.highlight) return { shown: false, reason: "highlight-off" };
  if (overlays === 0) return { shown: false, reason: "overlay-unavailable" };
  const deadline = Date.now() + settleMs;
  let found = findTrainingGuideStep(guide.steps);
  while (!found?.final && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 50));
    found = findTrainingGuideStep(guide.steps);
  }
  if (!found) {
    const element = findPaneSwitch();
    if (element) found = { step: { id: PANE_SWITCH }, element };
  }
  if (!found) return { shown: false, reason: "target-hidden" };
  if (overlays === 0) return { shown: false, reason: "overlay-unavailable" };
  sequence += 1;
  trainingGuide.value = Object.freeze({ id: `guide-${sequence}`, element: found.element, step: found.step.id,
    caption: String(guide.caption || ""), expiresAt: Date.now() + durationMs });
  return { shown: true, step: found.step.id };
}

// Run one teacher guide command in the initiating Main browser. Point-only
// changes no view; "show me" uses the ordinary browser navigator first and,
// for a file, the lesson view's own Files opener.
async function runTrainingGuideCommand(command, { navigateBrowser, view } = {}) {
  const { guide, ...navigation } = command;
  let focus = null;
  if (guide.navigate) {
    if (typeof navigateBrowser !== "function") throw new Error("Lesson workspace navigation is unavailable in this installation.");
    focus = await navigateBrowser(navigation);
    if (guide.filePath && (typeof view?.openFile !== "function" || view.openFile(guide.filePath) !== true)) {
      throw new Error("This lesson's Files view could not open that practice project file.");
    }
  }
  const receipt = await showTrainingGuide(guide, { settleMs: guide.navigate ? 1500 : 0 });
  return { ...(focus ? { focus } : {}), guide: receipt };
}

export { TRAINING_GUIDE_DURATION_MS, clearTrainingGuide, findTrainingGuideStep, guideElementVisible,
  registerTrainingGuideOverlay, runTrainingGuideCommand, showTrainingGuide, trainingGuide };
