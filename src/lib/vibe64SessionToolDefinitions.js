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

const VIBE64_SESSION_TOOL_DEFINITIONS = deepFreeze([
  {
    icon: mdiInformationOutline,
    id: "info",
    label: "Session info",
    order: 100,
    routeSegment: "session",
    title: "View paths and Git context for the active session"
  },
  {
    icon: mdiFileCompare,
    id: "changes",
    label: "Current changes",
    order: 150,
    routeSegment: "changes",
    title: "Review files changed in this session"
  },
  {
    icon: mdiSourceRepository,
    id: "repository",
    label: "Repository",
    order: 175,
    routeSegment: "repository",
    title: "Review saved versions and update this session"
  },
  {
    icon: mdiFileCodeOutline,
    id: "editor",
    label: "Files",
    order: 200,
    routeSegment: "files",
    title: "Browse, edit, and explain session source files"
  },
  {
    icon: mdiDatabaseOutline,
    id: "database",
    label: "Database",
    order: 225,
    routeSegment: "database",
    title: "Query, edit, and map the active session database"
  },
  {
    icon: mdiGraphOutline,
    id: "system",
    label: "Subsystems",
    order: 250,
    routeSegment: "system",
    title: "Explore subsystem responsibilities, operations, data, and Cities"
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
  vibe64SessionToolIdFromRouteSegment,
  vibe64SessionToolRouteSegment
};
