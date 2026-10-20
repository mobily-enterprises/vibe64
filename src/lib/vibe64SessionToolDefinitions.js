import {
  mdiDatabaseOutline,
  mdiFileCompare,
  mdiFileCodeOutline,
  mdiGraphOutline,
  mdiInformationOutline,
  mdiRobotOutline,
  mdiSourceRepository
} from "@mdi/js";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";

const VIBE64_ACTIVE_SESSION_NAV_TARGET = "page.active-session-nav";
const VIBE64_ACTIVE_SESSION_NAV_OWNER = "vibe64-session";

// guideId is the stable `data-vibe64-guide` id a lesson teacher's overlay can point at.
const VIBE64_SESSION_TOOL_DEFINITIONS = deepFreeze([
  {
    icon: mdiInformationOutline,
    id: "info",
    guideId: "session-info",
    label: "Session info",
    order: 100,
    routeSegment: "session",
    title: "View paths and Git context for the active session"
  },
  {
    icon: mdiFileCompare,
    id: "changes",
    guideId: "changes",
    label: "Current changes",
    order: 150,
    routeSegment: "changes",
    title: "Review files changed in this session"
  },
  {
    icon: mdiSourceRepository,
    id: "repository",
    guideId: "git-log",
    label: "Git log",
    navigationScope: "project",
    order: 290,
    routeSegment: "repository",
    title: "Review the project's saved Git history"
  },
  {
    icon: mdiFileCodeOutline,
    id: "editor",
    guideId: "files",
    label: "Files",
    order: 200,
    routeSegment: "files",
    title: "Browse, edit, and explain session source files"
  },
  {
    icon: mdiDatabaseOutline,
    id: "database",
    guideId: "database",
    label: "Database",
    order: 225,
    routeSegment: "database",
    title: "Query, edit, and map the active session database"
  },
  {
    icon: mdiGraphOutline,
    id: "system",
    guideId: "architecture",
    label: "Architecture",
    order: 250,
    routeSegment: "system",
    title: "Explore subsystem responsibilities, operations, and data"
  },
  {
    icon: mdiRobotOutline,
    id: "ai-terminal",
    label: "AI Terminal",
    order: 700,
    routeSegment: "ai-terminal",
    title: "Open the active session AI terminal"
  }
]);

function normalizeSessionToolRouteSegment(value = "") {
  return String(value || "").trim().replace(/^\/+|\/+$/gu, "");
}

function vibe64SessionToolDefinition(toolId = "") {
  const normalizedId = String(toolId || "").trim();
  return VIBE64_SESSION_TOOL_DEFINITIONS.find((tool) => tool.id === normalizedId) || null;
}

function vibe64SessionToolRouteSegment(toolId = "") {
  const tool = vibe64SessionToolDefinition(toolId);
  return normalizeSessionToolRouteSegment(tool?.routeSegment || tool?.id || "");
}

function vibe64SessionToolIdFromRouteSegment(routeSegment = "") {
  const normalizedSegment = normalizeSessionToolRouteSegment(routeSegment);
  return VIBE64_SESSION_TOOL_DEFINITIONS.find((tool) => (
    normalizeSessionToolRouteSegment(tool.routeSegment || tool.id) === normalizedSegment
  ))?.id || "";
}

// The guide id of the place a session tool's pane shows, or undefined so an
// unguided pane renders no anchor.
function vibe64SessionToolGuideId(toolId = "") {
  return vibe64SessionToolDefinition(toolId)?.guideId || undefined;
}

function vibe64SessionToolDashboardSuffix(toolId = "") {
  const routeSegment = vibe64SessionToolRouteSegment(toolId);
  return routeSegment ? `/dashboard/${routeSegment}` : "";
}

export {
  VIBE64_ACTIVE_SESSION_NAV_OWNER,
  VIBE64_ACTIVE_SESSION_NAV_TARGET,
  VIBE64_SESSION_TOOL_DEFINITIONS,
  vibe64SessionToolDashboardSuffix,
  vibe64SessionToolDefinition,
  vibe64SessionToolGuideId,
  vibe64SessionToolIdFromRouteSegment,
  vibe64SessionToolRouteSegment
};
