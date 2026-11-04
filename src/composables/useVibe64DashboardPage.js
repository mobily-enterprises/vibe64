import { computed, toValue } from "vue";
import { useRoute } from "vue-router";
import getPlacements from "/src/placement.js";
import {
  projectAppPath,
  projectSlugFromRoute
} from "@/lib/vibe64ProjectScope.js";

/**
 * The Dashboard's section links, each shown when its placement's visibleWhen accepts the dashboard context.
 * @param {{ dashboardContext: import("vue").MaybeRefOrGetter<import("./useVibe64SessionToolPane.js").Vibe64DashboardContext> }} options
 */
function useVibe64DashboardPage({ dashboardContext }) {
  const route = useRoute();
  const projectSlug = computed(() => projectSlugFromRoute(route));
  const projectBasePath = computed(() => projectAppPath(projectSlug.value));
  const dashboardSectionLinks = computed(() => getPlacements()
    .filter((placement) => (
      placement?.kind === "link" &&
      placement?.owner === "app-dashboard" &&
      placement?.target === "page.section-nav" &&
      dashboardPlacementVisible(placement, dashboardContext)
    ))
    .sort((left, right) => Number(left?.order || 0) - Number(right?.order || 0))
    .map((placement) => ({
      disabled: placement?.props?.disabled === true,
      icon: placement?.props?.icon || "",
      id: placement?.id || "",
      label: placement?.props?.label || "",
      to: `${projectBasePath.value}${dashboardSectionSuffix(placement)}`
    })));

  return {
    dashboardSectionLinks
  };
}

/**
 * @param {object} placement
 * @param {import("vue").MaybeRefOrGetter<import("./useVibe64SessionToolPane.js").Vibe64DashboardContext>} dashboardContext
 */
function dashboardPlacementVisible(placement, dashboardContext) {
  const predicate = placement.props?.visibleWhen;
  if (typeof predicate !== "function") return true;
  const context = toValue(dashboardContext);
  return predicate(context && typeof context === "object" ? context : {}) === true;
}

function activeSessionMobileSectionLinks(activeSessionNav = null) {
  if (!activeSessionNav?.visible || !Array.isArray(activeSessionNav.tools)) {
    return [];
  }
  return activeSessionNav.tools
    .map((tool) => ({
      disabled: tool?.disabled === true,
      icon: String(tool?.icon || ""),
      id: `active-session:${String(tool?.id || tool?.to || tool?.label || "")}`,
      label: String(tool?.label || ""),
      to: String(tool?.to || "")
    }))
    .filter((tool) => Boolean(tool.id !== "active-session:" && tool.label && tool.to));
}

function dashboardSectionSuffix(placement) {
  const suffix = String(placement.props?.scopedSuffix || placement.props?.unscopedSuffix || "").trim();
  if (!suffix) {
    return "";
  }
  const projectRelativeSuffix = suffix
    .replace(/^\/+/u, "")
    .replace(/^project\/\[slug\](?=\/|$)/u, "")
    .replace(/^\[slug\](?=\/|$)/u, "")
    .replace(/^\/+/u, "");
  return projectRelativeSuffix ? `/${projectRelativeSuffix}` : "";
}

export {
  activeSessionMobileSectionLinks,
  dashboardPlacementVisible,
  useVibe64DashboardPage
};
