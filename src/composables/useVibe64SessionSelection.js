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

// The project page owns the selection and passes the person's last opened
// session as rememberedId; other readers follow this tab's stored selection.
function useVibe64SessionSelection({
  projectSlug = useVibe64ProjectSlug(),
  rememberedId,
  route = useRoute()
} = {}) {
  return useStoredSelection({
    preferredId: computed(() => selectedSessionIdFromRoute(route)),
    rememberedId,
    storageKey: computed(() => selectedSessionStorageKey(unref(projectSlug)))
  });
}

export {
  selectedSessionIdFromRoute,
  useVibe64SessionSelection
};
