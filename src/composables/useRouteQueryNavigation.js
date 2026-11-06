import { useRoute, useRouter } from "vue-router";

/** Moves a list or item view (issues, pull requests) by changing some of the route's query. */
function useRouteQueryNavigation() {
  const route = useRoute();
  const router = useRouter();

  /** @param {Record<string, unknown>} changes Each query parameter to set; undefined removes it. */
  function navigate(changes) {
    return router.push({ query: { ...route.query, ...changes } });
  }

  return { navigate };
}

export { useRouteQueryNavigation };
