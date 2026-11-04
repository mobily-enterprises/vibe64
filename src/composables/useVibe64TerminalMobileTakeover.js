import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { hasWindowFunction } from "@/lib/browser.js";

const TAKEOVER_FOCUSABLE_SELECTOR =
  "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

/**
 * A terminal surface's full-screen takeover on narrow screens. While it is
 * active the surface is a modal dialog: the page behind it is inert and does
 * not scroll, Tab stays inside it, and leaving it returns focus to where it
 * was. `props` are the surface's props, `surfaceExpanded` whether its body
 * shows, and `requestToggle()` asks the owner to expand or collapse it.
 * @param {{
 *   props: { collapsible: boolean, mobileTakeover: boolean },
 *   surfaceExpanded: import("vue").ComputedRef<boolean>,
 *   requestToggle: () => void
 * }} options
 */
function useVibe64TerminalMobileTakeover({ props, surfaceExpanded, requestToggle }) {
  const expansionToggle = ref(null);
  const takeoverRoot = ref(null);
  const mobileTakeoverViewport = ref(false);
  const mobileFullscreenDismissed = ref(false);
  const mobileTakeoverActive = computed(() => Boolean(
    props.mobileTakeover && surfaceExpanded.value && mobileTakeoverViewport.value && !mobileFullscreenDismissed.value
  ));

  let mobileTakeoverMediaQuery = null;
  let takeoverPendingRestoreTarget = null;
  let takeoverRestoreTarget = null;
  let takeoverBodyOverflow = "";
  let takeoverInertRecords = [];
  let takeoverApplied = false;

  /** The expand or full-screen button's element; none while neither button shows. */
  function expansionToggleElement() {
    return expansionToggle.value?.$el;
  }

  /** The surface's element, which becomes the dialog during the takeover. */
  function takeoverRootElement() {
    return takeoverRoot.value?.$el;
  }

  function toggleExpanded() {
    const collapsing = surfaceExpanded.value;
    if (
      !collapsing &&
      props.mobileTakeover &&
      mobileTakeoverViewport.value &&
      typeof document !== "undefined"
    ) {
      const toggle = expansionToggleElement();
      takeoverPendingRestoreTarget = document.activeElement !== document.body
        ? document.activeElement
        : toggle;
    }
    requestToggle();
    if (collapsing) {
      void nextTick(() => {
        const target = expansionToggleElement();
        target?.focus({ preventScroll: true });
      });
    }
  }

  function toggleMobileFullscreen() {
    const target = expansionToggleElement();
    takeoverPendingRestoreTarget = target;
    mobileFullscreenDismissed.value = !mobileFullscreenDismissed.value;
    void nextTick(() => target?.focus({ preventScroll: true }));
  }

  function handleTakeoverKeydown(event) {
    if (!mobileTakeoverActive.value) {
      return;
    }
    if (event.key === "Escape" && props.collapsible) {
      event.preventDefault();
      requestToggle();
      return;
    }
    if (event.key !== "Tab") {
      return;
    }
    const root = takeoverRootElement();
    const focusable = Array.from(root?.querySelectorAll(TAKEOVER_FOCUSABLE_SELECTOR) || [])
      .filter((element) => element.getAttribute("aria-hidden") !== "true");
    if (!focusable.length) {
      event.preventDefault();
      root?.focus({ preventScroll: true });
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  }

  function updateMobileTakeoverViewport(event = mobileTakeoverMediaQuery) {
    mobileTakeoverViewport.value = Boolean(event?.matches);
  }

  async function applyMobileTakeover() {
    await nextTick();
    if (!mobileTakeoverActive.value || takeoverApplied || typeof document === "undefined") {
      return;
    }
    const root = takeoverRootElement();
    if (!root) {
      return;
    }
    takeoverApplied = true;
    takeoverRestoreTarget = takeoverPendingRestoreTarget || document.activeElement;
    takeoverPendingRestoreTarget = null;
    takeoverBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    takeoverInertRecords = Array.from(document.body.children)
      .filter((element) => element !== root && !element.contains(root))
      .map((element) => ({
        element,
        inert: element.inert === true
      }));
    for (const record of takeoverInertRecords) {
      record.element.inert = true;
    }
    const target = expansionToggleElement() || root;
    target.focus({ preventScroll: true });
  }

  function releaseMobileTakeover({ restoreFocus = true } = {}) {
    if (!takeoverApplied) {
      return;
    }
    takeoverApplied = false;
    for (const record of takeoverInertRecords) {
      if (record.element?.isConnected) {
        record.element.inert = record.inert;
      }
    }
    takeoverInertRecords = [];
    if (typeof document !== "undefined") {
      document.body.style.overflow = takeoverBodyOverflow;
    }
    const restoreTarget = takeoverRestoreTarget;
    takeoverRestoreTarget = null;
    takeoverPendingRestoreTarget = null;
    if (restoreFocus) {
      void nextTick(() => restoreTarget?.isConnected && restoreTarget.focus({ preventScroll: true }));
    }
  }

  watch(mobileTakeoverActive, (active) => {
    if (active) {
      void applyMobileTakeover();
    } else {
      releaseMobileTakeover();
    }
  }, { flush: "post" });

  onMounted(() => {
    if (!hasWindowFunction("matchMedia")) {
      return;
    }
    mobileTakeoverMediaQuery = window.matchMedia("(max-width: 720px)");
    updateMobileTakeoverViewport();
    mobileTakeoverMediaQuery.addEventListener("change", updateMobileTakeoverViewport);
  });

  onBeforeUnmount(() => {
    releaseMobileTakeover({ restoreFocus: false });
    mobileTakeoverMediaQuery?.removeEventListener("change", updateMobileTakeoverViewport);
    mobileTakeoverMediaQuery = null;
  });

  return {
    expansionToggle,
    handleTakeoverKeydown,
    mobileTakeoverActive,
    mobileTakeoverViewport,
    takeoverRoot,
    toggleExpanded,
    toggleMobileFullscreen
  };
}

export {
  useVibe64TerminalMobileTakeover
};
