import { computed } from "vue";
import { useRoute } from "vue-router";
import getPlacements from "/src/placement.js";

function useVibe64DashboardPage() {
  const route = useRoute();
  const projectSlug = computed(() => firstRouteParam(route.params.slug));
  const projectBasePath = computed(() => projectSlug.value ? `/app/${encodeURIComponent(projectSlug.value)}` : "/app");
  const dashboardSectionLinks = computed(() => getPlacements()
    .filter((placement) => (
      placement?.kind === "link" &&
      placement?.owner === "app-dashboard" &&
      placement?.target === "page.section-nav"
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

function firstRouteParam(value) {
  const rawValue = Array.isArray(value) ? value[0] : value;
  return String(rawValue || "").trim();
}

function dashboardSectionSuffix(placement = {}) {
  const suffix = String(placement?.props?.scopedSuffix || placement?.props?.unscopedSuffix || "").trim();
  if (!suffix) {
    return "";
  }
  const projectRelativeSuffix = suffix
    .replace(/^\/+/u, "")
    .replace(/^\[slug\](?=\/|$)/u, "")
    .replace(/^\/+/u, "");
  return projectRelativeSuffix ? `/${projectRelativeSuffix}` : "";
}

export {
  useVibe64DashboardPage
};
