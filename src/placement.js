import { createPlacementRegistry } from "@jskit-ai/shell-web/client/placement";
import { githubProjectAvailable } from "./lib/vibe64GithubProject.js";
import {
  mdiAccountKeyOutline,
  mdiCogOutline,
  mdiConnection,
  mdiFileCogOutline,
  mdiHeartPulse,
  mdiHistory,
  mdiPackageVariantClosed,
  mdiSourceMerge,
  mdiGithub
} from "@mdi/js";
import {
  VIBE64_ACTIVE_SESSION_NAV_OWNER,
  VIBE64_ACTIVE_SESSION_NAV_TARGET,
  VIBE64_SESSION_TOOL_DEFINITIONS,
  vibe64SessionToolDashboardSuffix
} from "./lib/vibe64SessionToolDefinitions.js";
import extensionPlacements from "./placementExtensions.js";

const registry = createPlacementRegistry();
const { addPlacement } = registry;

export { addPlacement, uniqueDashboardSectionPlacements };

export default function getPlacements() {
  return uniqueDashboardSectionPlacements(registry.build()).map(dashboardSectionVisibility);
}

// Dashboard section links state their visibility once, in props.visibleWhen,
// for both the desktop outlet and the mobile section list.
function dashboardSectionVisibility(placement) {
  return placement?.owner === "app-dashboard" && placement.target === "page.section-nav" && !placement.when &&
    typeof placement.props?.visibleWhen === "function" ? { ...placement, when: placement.props.visibleWhen } : placement;
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

addPlacement({
  id: "vibe64.active-session.heading",
  target: VIBE64_ACTIVE_SESSION_NAV_TARGET,
  owner: VIBE64_ACTIVE_SESSION_NAV_OWNER,
  kind: "link",
  surfaces: ["app"],
  order: 100,
  props: {
    role: "heading"
  },
  when: activeSessionNavPlacementVisible
});

for (const tool of VIBE64_SESSION_TOOL_DEFINITIONS) {
  const projectTool = tool.navigationScope === "project";
  addPlacement({
    id: `vibe64.${projectTool ? "project" : "active-session"}.${tool.id}`,
    target: projectTool ? "page.section-nav" : VIBE64_ACTIVE_SESSION_NAV_TARGET,
    owner: projectTool ? "app-dashboard" : VIBE64_ACTIVE_SESSION_NAV_OWNER,
    kind: "link",
    surfaces: ["app"],
    order: projectTool ? tool.order : 100 + tool.order,
    props: {
      icon: tool.icon,
      ...(tool.guideId ? { guideId: tool.guideId } : {}),
      label: tool.label,
      scopedSuffix: `/project/[slug]${vibe64SessionToolDashboardSuffix(tool.id)}`,
      title: tool.title,
      toolId: tool.id,
      unscopedSuffix: `/project/[slug]${vibe64SessionToolDashboardSuffix(tool.id)}`
    },
    when: projectTool ? undefined : activeSessionNavPlacementVisible
  });
}

function activeSessionNavPlacementVisible({ activeSessionNav } = {}) {
  return activeSessionNav?.visible === true;
}

function githubProjectVisible({ projectContext = {} } = {}) {
  return githubProjectAvailable(projectContext);
}

function incomingVisible({ projectContext = {} } = {}) {
  return projectContext.repositoryMode === "github";
}

addPlacement({
  id: "vibe64.incoming.link", target: "page.section-nav", owner: "app-dashboard", kind: "link",
  surfaces: ["app"], order: 320,
  props: { label: "Incoming changes", icon: mdiSourceMerge, surface: "app",
    scopedSuffix: "/project/[slug]/dashboard/incoming", unscopedSuffix: "/project/[slug]/dashboard/incoming",
    visibleWhen: incomingVisible },
  when: incomingVisible
});

addPlacement({
  id: "vibe64.issues.link", target: "page.section-nav", owner: "app-dashboard", kind: "link",
  surfaces: ["app"], order: 325,
  props: {
    label: "Issues/PR", icon: mdiGithub, surface: "app",
    scopedSuffix: "/project/[slug]/dashboard/issues", unscopedSuffix: "/project/[slug]/dashboard/issues",
    visibleWhen: githubProjectVisible
  },
  when: githubProjectVisible
});

addPlacement({
  id: "vibe64.project-settings.link",
  target: "page.section-nav",
  owner: "app-dashboard",
  kind: "link",
  surfaces: ["app"],
  order: 250,
  props: {
    label: "Project settings",
    icon: mdiCogOutline,
    surface: "app",
    scopedSuffix: "/project/[slug]/dashboard/settings",
    unscopedSuffix: "/project/[slug]/dashboard/settings",
    to: ""
  }
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
addPlacement({
  id: "vibe64.integrations.link",
  target: "page.section-nav",
  owner: "app-dashboard",
  kind: "link",
  surfaces: ["app"],
  order: 350,
  props: {
    label: "Integrations",
    icon: mdiConnection,
    surface: "app",
    scopedSuffix: "/project/[slug]/dashboard/integrations",
    unscopedSuffix: "/project/[slug]/dashboard/integrations",
    to: ""
  }
});
addPlacement({
  id: "vibe64.preview-identities.link",
  target: "page.section-nav",
  owner: "app-dashboard",
  kind: "link",
  surfaces: ["app"],
  order: 400,
  props: {
    label: "App access",
    icon: mdiAccountKeyOutline,
    surface: "app",
    scopedSuffix: "/project/[slug]/dashboard/access",
    unscopedSuffix: "/project/[slug]/dashboard/access",
    to: ""
  }
});
addPlacement({
  id: "vibe64.publishing.link",
  target: "page.section-nav",
  owner: "app-dashboard",
  kind: "link",
  surfaces: ["app"],
  order: 500,
  props: {
    label: "Publish",
    guideId: "publish",
    icon: mdiPackageVariantClosed,
    surface: "app",
    scopedSuffix: "/project/[slug]/dashboard/publish",
    unscopedSuffix: "/project/[slug]/dashboard/publish",
    to: ""
  }
});
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
addPlacement({
  id: "vibe64.studio-health.link",
  target: "page.section-nav",
  owner: "app-dashboard",
  kind: "link",
  surfaces: ["app"],
  order: 700,
  props: {
    label: "Health",
    icon: mdiHeartPulse,
    surface: "app",
    scopedSuffix: "/project/[slug]/dashboard/health",
    unscopedSuffix: "/project/[slug]/dashboard/health",
    to: ""
  }
});

for (const placement of extensionPlacements) addPlacement(placement);
