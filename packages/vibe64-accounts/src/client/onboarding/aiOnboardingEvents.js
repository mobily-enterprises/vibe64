import { ref } from "vue";
import { hasWindowFunction } from "../browser.js";

const VIBE64_AI_ONBOARDING_OPEN_EVENT = "vibe64:ai-onboarding:open";

// Set by the mounted host: true while it can open the flow for this viewer.
// readable-check: allow module-state - shared resource: the page's one onboarding host tells every opener on the page (user menu, Learning, AI Accounts) whether it can open
const aiOnboardingAvailable = ref(false);
// Set by the mounted host: true while this viewer can set up AI and has none.
// readable-check: allow module-state - shared resource: the page's one onboarding host tells every nudge, pill and lesson on the page that AI is missing
const aiOnboardingNeeded = ref(false);
// Set by a dialog that must not be covered (for example AI Accounts while busy).
// readable-check: allow module-state - shared resource: a busy dialog holds back every opener on the page from covering it
const aiOnboardingBlocked = ref(false);

// redo: the person asked to review an existing setup (user menu, AI Accounts).
// returnFocus: where focus goes when the flow closes, for an opener that will be
// gone by then. A listener that removes the opener may set detail.returnFocus.
// Returns false when nothing will open.
function requestVibe64AiOnboarding({ start = "choose", redo = false, returnFocus = null } = {}) {
  if (aiOnboardingBlocked.value || !hasWindowFunction("dispatchEvent")) return false;
  window.dispatchEvent(new CustomEvent(VIBE64_AI_ONBOARDING_OPEN_EVENT, {
    detail: { start: start === "why" ? "why" : "choose", redo: redo === true, ...(returnFocus ? { returnFocus } : {}) }
  }));
  return true;
}

function onVibe64AiOnboardingRequested(handler) {
  if (!hasWindowFunction("addEventListener")) return () => null;
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
