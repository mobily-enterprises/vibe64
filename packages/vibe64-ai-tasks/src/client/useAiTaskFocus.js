import { nextTick, onScopeDispose, ref } from "vue";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/**
 * Where keyboard focus goes in the window: the title on opening, never the composer, so a phone
 * keyboard stays down; arrow keys between the views; back to the opener, or the tray, on leaving.
 * @param {object} options
 * @param {import("vue").Ref<HTMLElement | null>} options.title
 * @param {string[]} options.views
 * @param {() => string} options.selectedView
 * @param {(view: string) => void} options.setView
 * @param {() => HTMLElement | null} options.returnFocusTarget
 */
function useAiTaskFocus({ title, views, selectedView, setView, returnFocusTarget }) {
  const tabElements = new Map();
  const motionQuery = globalThis.matchMedia(REDUCED_MOTION);
  const reducedMotion = ref(motionQuery.matches);
  const noteMotion = (event) => { reducedMotion.value = event.matches; };
  motionQuery.addEventListener("change", noteMotion);
  onScopeDispose(() => motionQuery.removeEventListener("change", noteMotion));

  function focusTitle() {
    title.value?.focus({ preventScroll: true });
  }

  function returnFocus() {
    returnFocusTarget()?.focus({ preventScroll: true });
  }

  function setTab(view, element) {
    if (element) tabElements.set(view, element);
    else tabElements.delete(view);
  }

  /** @param {KeyboardEvent} event */
  async function moveBetweenViews(event) {
    const index = views.indexOf(selectedView());
    const next = {
      ArrowLeft: views[(index + views.length - 1) % views.length],
      ArrowRight: views[(index + 1) % views.length],
      End: views.at(-1),
      Home: views[0]
    }[event.key];
    if (!next) return;
    event.preventDefault();
    setView(next);
    await nextTick();
    tabElements.get(next)?.focus();
  }

  return {
    focusTitle,
    moveBetweenViews,
    reducedMotion,
    returnFocus,
    setTab
  };
}

export { useAiTaskFocus };
