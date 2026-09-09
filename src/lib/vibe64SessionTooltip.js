import { ref } from "vue";

const VIBE64_SESSION_TOOLTIP_KEY = Symbol("vibe64-session-tooltip");

function createVibe64SessionTooltipState() {
  const suppressedSessionId = ref("");

  function resumeHover() {
    suppressedSessionId.value = "";
  }

  function trackPointer(event) {
    if (!suppressedSessionId.value) return;
    const tab = event.target.closest?.("[data-vibe64-session-id]");
    if (tab?.dataset.vibe64SessionId !== suppressedSessionId.value) resumeHover();
  }

  // Track real pointer movement at the stable panel, not mouseenter/leave on
  // toolbars that are hidden and revealed when the selected session changes.
  return { suppressedSessionId, resumeHover, trackPointer };
}

export { VIBE64_SESSION_TOOLTIP_KEY, createVibe64SessionTooltipState };
