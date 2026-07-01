import { createPlacementRegistry } from "@jskit-ai/shell-web/client/placement";
import {
  mdiFileCogOutline,
  mdiHistory,
  mdiTune
} from "@mdi/js";

const registry = createPlacementRegistry();
const { addPlacement } = registry;

export { addPlacement, uniqueDashboardSectionPlacements };

export default function getPlacements() {
  return uniqueDashboardSectionPlacements(registry.build());
}

function uniqueDashboardSectionPlacements(placements = []) {
  const winners = new Map();
  for (const placement of placements) {
    const key = dashboardSectionPlacementKey(placement);
    if (!key) {
      continue;
    }
    const current = winners.get(key);
    if (!current || dashboardSectionPlacementOrder(placement) < dashboardSectionPlacementOrder(current)) {
      winners.set(key, placement);
    }
  }
  return placements.filter((placement) => {
    const key = dashboardSectionPlacementKey(placement);
    return !key || winners.get(key) === placement;
  });
}

function dashboardSectionPlacementKey(placement = {}) {
  if (
    placement?.kind !== "link" ||
    placement?.owner !== "app-dashboard" ||
    placement?.target !== "page.section-nav"
  ) {
    return "";
  }
  const destination = dashboardSectionPlacementDestination(placement);
  return destination ? `${placement.owner}:${placement.target}:${destination}` : "";
}

function dashboardSectionPlacementDestination(placement = {}) {
  const raw = String(
    placement?.props?.scopedSuffix ||
    placement?.props?.unscopedSuffix ||
    placement?.props?.to ||
    ""
  ).trim();
  if (!raw) {
    return "";
  }
  const normalized = raw
    .replace(/^\/+/u, "")
    .replace(/^project\/\[slug\](?=\/|$)/u, "")
    .replace(/^\[slug\](?=\/|$)/u, "")
    .replace(/^\/+/u, "")
    .replace(/\/+$/u, "");
  return normalized ? `/${normalized}` : "/";
}

function dashboardSectionPlacementOrder(placement = {}) {
  const order = Number(placement?.order);
  return Number.isFinite(order) ? order : Number.MAX_SAFE_INTEGER;
}

addPlacement({
  id: "realtime.connection.indicator",
  target: "shell.status",
  kind: "component",
  surfaces: ["*"],
  order: 950,
  componentToken: "realtime.web.connection.indicator"
});

// jskit:ui-generator.page.link:app:/dashboard/env
{
  addPlacement({
    id: "ui-generator.page.app.dashboard.env.link",
    target: "page.section-nav",
    owner: "app-dashboard",
    kind: "link",
    surfaces: ["app"],
    order: 300,
    props: {
      label: "Env",
      icon: mdiFileCogOutline,
      surface: "app",
      scopedSuffix: "/project/[slug]/dashboard/env",
      unscopedSuffix: "/project/[slug]/dashboard/env",
      to: "",
    },
  });
}
// jskit:ui-generator.page.link:app:/dashboard/history
{
  addPlacement({
    id: "ui-generator.page.app.dashboard.history.link",
    target: "page.section-nav",
    owner: "app-dashboard",
    kind: "link",
    surfaces: ["app"],
    order: 600,
    props: {
      label: "Session History",
      icon: mdiHistory,
      surface: "app",
      scopedSuffix: "/project/[slug]/dashboard/history",
      unscopedSuffix: "/project/[slug]/dashboard/history",
      to: "",
    },
  });
}
// jskit:ui-generator.page.link:app:/dashboard/setup
{
  addPlacement({
    id: "ui-generator.page.app.dashboard.setup.link",
    target: "page.section-nav",
    owner: "app-dashboard",
    kind: "link",
    surfaces: ["app"],
    order: 700,
    props: {
      label: "Setup",
      icon: mdiTune,
      surface: "app",
      scopedSuffix: "/project/[slug]/dashboard/setup",
      unscopedSuffix: "/project/[slug]/dashboard/setup",
      to: "",
    },
  });
}
