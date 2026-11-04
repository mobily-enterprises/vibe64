const CREATED_SESSION_FOCUS_TIMEOUT_MS = 2_000;

async function focusCreatedVibe64SessionTab(sessionId = "") {
  const normalizedSessionId = String(sessionId || "").trim();
  if (!normalizedSessionId || typeof document === "undefined") {
    return false;
  }
  const deadline = Date.now() + CREATED_SESSION_FOCUS_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const dialogVisible = [...document.querySelectorAll(".vibe64-assistant-dialog")]
      .some((element) => element.getClientRects().length > 0);
    const target = [...document.querySelectorAll("[data-vibe64-session-id]")]
      .find((element) => (
        element.getAttribute("data-vibe64-session-id") === normalizedSessionId &&
        element.getClientRects().length > 0
      ));
    if (!dialogVisible && target) {
      target.focus({ preventScroll: true });
      return document.activeElement === target;
    }
    await new Promise((resolve) => {
      const schedule = globalThis.requestAnimationFrame || ((callback) => setTimeout(callback, 16));
      schedule(resolve);
    });
  }
  return false;
}

export {
  focusCreatedVibe64SessionTab
};
