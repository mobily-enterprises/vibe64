import { computed, unref } from "vue";
import { useRoute } from "vue-router";
import {
  useStoredSelection
} from "@/composables/useStoredSelection.js";
import {
  useVibe64ProjectSlug
} from "@/composables/useVibe64ProjectScope.js";
import {
  selectedSessionStorageKey,
  SELECTED_SESSION_STORAGE_KEY
} from "@/lib/vibe64SessionRequestConfig.js";

function selectedSessionIdFromRoute(route = {}) {
  const rawValue = route?.query?.session;
  const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
  return String(value || "").trim();
}

function useVibe64SessionSelection({
  projectSlug = useVibe64ProjectSlug(),
  route = useRoute(),
  learnerId = "",
  learningAttemptId = "",
  purpose = ""
} = {}) {
  const pickerLearning = computed(() => unref(purpose) === "learning");
  const learningLearner = computed(() => String(unref(learnerId) || "").trim());
  const learningScope = computed(() => {
    if (unref(purpose) === "working") return null;
    const learner = String(unref(learnerId) || "").trim();
    const attempt = String(unref(learningAttemptId) || "").trim();
    if (!learner && !attempt) {
      return null;
    }
    if (!learner || !attempt) {
      throw new Error("Learning selection requires an exact learner and attempt.");
    }
    return { learner, attempt };
  });
  return useStoredSelection({
    enabled: computed(() => !pickerLearning.value || Boolean(learningLearner.value)),
    preferredId: computed(() => {
      if (pickerLearning.value) {
        if (!learningLearner.value) return "";
        return selectedSessionIdFromRoute({ query: { session: route?.query?.learningSession } });
      }
      const scope = learningScope.value;
      if (!scope) {
        return selectedSessionIdFromRoute(route);
      }
      const rawAttempt = route?.query?.learningAttempt;
      const attempt = Array.isArray(rawAttempt) ? rawAttempt[0] : rawAttempt;
      if (attempt !== scope.attempt) {
        return "";
      }
      return selectedSessionIdFromRoute({ query: { session: route?.query?.learningSession } });
    }),
    storageKey: computed(() => {
      if (pickerLearning.value) {
        return learningLearner.value ? `${SELECTED_SESSION_STORAGE_KEY}:learning:${encodeURIComponent(learningLearner.value)}` : "";
      }
      const scope = learningScope.value;
      return scope
        ? `${SELECTED_SESSION_STORAGE_KEY}:learning:${encodeURIComponent(scope.learner)}:attempt:${encodeURIComponent(scope.attempt)}`
        : selectedSessionStorageKey(unref(projectSlug));
    })
  });
}

export {
  selectedSessionIdFromRoute,
  useVibe64SessionSelection
};
