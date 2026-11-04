import { computed, getCurrentInstance, inject, provide } from "vue";
import { useRoute } from "vue-router";

import {
  projectSlugFromRoute
} from "@/lib/vibe64ProjectScope.js";

const VIBE64_OPENED_PROJECT_SLUG_KEY = Symbol("vibe64.opened-project-slug");

// The project page mounts one project view per project (keyed by its slug).
// Everything inside it keeps that project while the route already names the
// next one, so a session is never paired with another project's slug.
function provideVibe64OpenedProjectSlug(route = useRoute()) {
  const slug = projectSlugFromRoute(route);
  provide(VIBE64_OPENED_PROJECT_SLUG_KEY, computed(() => slug));
}

/**
 * The opened project's slug, or the route's outside a project view.
 * @returns {import("vue").ComputedRef<string>}
 */
function useVibe64ProjectSlug(route = useRoute()) {
  const fromRoute = () => computed(() => projectSlugFromRoute(route));
  return getCurrentInstance() ? inject(VIBE64_OPENED_PROJECT_SLUG_KEY, fromRoute, true) : fromRoute();
}

export {
  provideVibe64OpenedProjectSlug,
  useVibe64ProjectSlug
};
