import { ref } from "vue";

const VIBE64_AI_ONBOARDING_OPEN_EVENT = "vibe64:ai-onboarding:open";

// Set by the mounted host: true while it can open the flow for this viewer.
const aiOnboardingAvailable = ref(false);
// Set by the mounted host: true while this viewer can set up AI and has none.
const aiOnboardingNeeded = ref(false);
// Set by a dialog that must not be covered (for example AI Accounts while busy).
const aiOnboardingBlocked = ref(false);

// returnFocus: where focus goes when the flow closes, for an opener that will be
// gone by then. A listener that removes the opener may set detail.returnFocus.
// Returns false when nothing will open.
function requestVibe64AiOnboarding({ start = "choose", returnFocus = null } = {}) {
  if (aiOnboardingBlocked.value || typeof window === "undefined" || typeof window.dispatchEvent !== "function") return false;
  window.dispatchEvent(new CustomEvent(VIBE64_AI_ONBOARDING_OPEN_EVENT, {
    detail: { start: start === "why" ? "why" : "choose", ...(returnFocus ? { returnFocus } : {}) }
  }));
  return true;
}

function onVibe64AiOnboardingRequested(handler) {
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") return () => null;
  window.addEventListener(VIBE64_AI_ONBOARDING_OPEN_EVENT, handler);
  return () => window.removeEventListener(VIBE64_AI_ONBOARDING_OPEN_EVENT, handler);
}

export {
  aiOnboardingAvailable,
  aiOnboardingBlocked,
  aiOnboardingNeeded,
  onVibe64AiOnboardingRequested,
  requestVibe64AiOnboarding
};
