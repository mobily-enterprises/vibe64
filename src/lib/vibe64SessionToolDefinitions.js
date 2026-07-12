import {
  mdiCogOutline,
  mdiFileCompare,
  mdiFileCodeOutline,
  mdiGraphOutline,
  mdiInformationOutline,
  mdiPlayBoxMultipleOutline,
  mdiRobotOutline
} from "@mdi/js";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";

const VIBE64_ACTIVE_SESSION_NAV_TARGET = "page.active-session-nav";
const VIBE64_ACTIVE_SESSION_NAV_OWNER = "vibe64-session";

const VIBE64_SESSION_TOOL_DEFINITIONS = deepFreeze([
  {
    icon: mdiPlayBoxMultipleOutline,
    id: "run",
    label: "Run",
    order: 100,
    routeSegment: "run",
    title: "Run project scripts"
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
    icon: mdiGraphOutline,
    id: "system",
    label: "System",
    order: 250,
    routeSegment: "system",
    title: "Explore the active session as a live visual system"
  },
  {
    icon: mdiCogOutline,
    id: "config",
    label: "Config",
    order: 300,
    routeSegment: "config",
    title: "Edit this session source project config"
  },
  {
    icon: mdiInformationOutline,
    id: "session-details",
    label: "Session",
    order: 400,
    routeSegment: "session",
    title: "Show active session details"
  },
  {
    icon: mdiFileCompare,
    id: "diff",
    label: "Diff",
    order: 500,
    routeSegment: "diff",
    title: "Review changes in the session clone"
  },
  {
    icon: mdiRobotOutline,
    id: "ai-terminal",
    label: "AI Terminal",
    order: 700,
    routeSegment: "ai-terminal",
    title: "Open the active session Codex terminal"
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
