import { ref } from "vue";

const VIBE64_AI_ONBOARDING_OPEN_EVENT = "vibe64:ai-onboarding:open";

// Set by the mounted host: true while this viewer can set up AI and has none.
const aiOnboardingNeeded = ref(false);

// redo: the person asked to review an existing setup (user menu, AI Accounts).
function requestVibe64AiOnboarding({ start = "choose", redo = false } = {}) {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return false;
  window.dispatchEvent(new CustomEvent(VIBE64_AI_ONBOARDING_OPEN_EVENT, {
    detail: { start: start === "why" ? "why" : "choose", redo: redo === true }
  }));
  return true;
}

function onVibe64AiOnboardingRequested(handler) {
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") return () => null;
  window.addEventListener(VIBE64_AI_ONBOARDING_OPEN_EVENT, handler);
  return () => window.removeEventListener(VIBE64_AI_ONBOARDING_OPEN_EVENT, handler);
}

export { aiOnboardingNeeded, onVibe64AiOnboardingRequested, requestVibe64AiOnboarding };
