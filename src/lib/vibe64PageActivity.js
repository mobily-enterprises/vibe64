import { inject } from "vue";
import { learningVocabulary } from "@local/vibe64-training/shared/learning-vocabulary";
import { VIBE64_PAGE_ACTIVITY_KEY } from "@/lib/vibe64AssistantHost.js";

// This tab's page activity: the things the person just did that the learning
// vocabulary names (its activity and place events), reported by the views that do them and heard by the
// lesson step bar's beat player. In memory only; nothing is sent or saved.
// detail: { projectSlug, sessionId?, path? }.
function createPageActivity() {
  const listeners = new Set();
  return Object.freeze({
    report(name, detail = {}) {
      if (!learningVocabulary.events().has(name)) throw new TypeError(`Unknown page activity: ${name}`);
      const event = Object.freeze({ name, projectSlug: String(detail.projectSlug || ""),
        sessionId: String(detail.sessionId || ""), path: String(detail.path || "") });
      for (const listener of [...listeners]) listener(event);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  });
}

// For a view: report one activity to the shell's channel, if there is one.
function usePageActivity() {
  const activity = inject(VIBE64_PAGE_ACTIVITY_KEY, null);
  return (name, detail) => activity?.report(name, detail);
}

export { createPageActivity, usePageActivity };
