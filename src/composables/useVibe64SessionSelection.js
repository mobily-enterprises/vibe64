import { computed, unref } from "vue";
import { useRoute } from "vue-router";
import {
  useStoredSelection
} from "@/composables/useStoredSelection.js";
import {
  useVibe64ProjectSlug
} from "@/composables/useVibe64ProjectScope.js";
import {
  selectedSessionStorageKey
} from "@/lib/vibe64SessionRequestConfig.js";

function selectedSessionIdFromRoute(route = {}) {
  const rawValue = route?.query?.session;
  const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
  return String(value || "").trim();
}

function useVibe64SessionSelection({
  projectSlug = useVibe64ProjectSlug(),
  route = useRoute()
} = {}) {
  return useStoredSelection({
    preferredId: computed(() => selectedSessionIdFromRoute(route)),
    storageKey: computed(() => selectedSessionStorageKey(unref(projectSlug)))
  });
}

export {
  selectedSessionIdFromRoute,
  useVibe64SessionSelection
};
