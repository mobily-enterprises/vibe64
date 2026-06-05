import { computed } from "vue";
import { useRoute } from "vue-router";

import {
  workspaceSlugFromRoute
} from "@/lib/vibe64WorkspaceScope.js";

function useVibe64WorkspaceSlug(route = useRoute()) {
  return computed(() => workspaceSlugFromRoute(route));
}

export {
  useVibe64WorkspaceSlug
};
