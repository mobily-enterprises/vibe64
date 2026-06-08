import { computed } from "vue";
import { useRoute } from "vue-router";

import {
  projectSlugFromRoute
} from "@/lib/vibe64ProjectScope.js";

function useVibe64ProjectSlug(route = useRoute()) {
  return computed(() => projectSlugFromRoute(route));
}

export {
  useVibe64ProjectSlug
};
