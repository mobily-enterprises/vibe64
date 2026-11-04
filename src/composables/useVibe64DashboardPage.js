import { computed, toValue } from "vue";
import { useRoute } from "vue-router";
import getPlacements from "/src/placement.js";
import {
  projectAppPath,
  projectSlugFromRoute
} from "@/lib/vibe64ProjectScope.js";

/**
 * What the project shell hands each Dashboard page: the project's context, the session toolbar and, while a session
 * is open, that session's work and actions. The members only a session has are absent while none is open. Vibe64
 * Online adds the deployed release's members.
 * @typedef {object} Vibe64DashboardContext
 * @property {object} projectContext The open project's record.
 * @property {string} sessionsApiPath
 * @property {{ createSession: (selection: object, options?: object) => Promise<unknown> }} sessionToolbar The session
 *   toolbar, which also creates sessions.
 * @property {boolean} [active] False while the Dashboard pane is hidden.
 * @property {string} [sessionId]
 * @property {object | null} [session]
 * @property {object} [activeSessionNav]
 * @property {boolean} [sourceOperationsSuspended]
 * @property {(observedWork?: object) => Promise<unknown>} [refreshSessionWork] Present while a session is open.
 * @property {() => Promise<unknown>} [requestSaveWork] Present while a session is open.
 * @property {(options?: object) => Promise<unknown>} [requestUpdateWork] Present while a session is open.
 * @property {() => unknown} [refreshConversation] Present while a session is open.
 * @property {(text: string) => void} [requestAssistantDraft] Present while a session is open.
 * @property {boolean} [assistantDraftAvailable]
 * @property {boolean} [assistantFixAllowed]
 * @property {string} [assistantFixRestrictionMessage]
 * @property {boolean} [owner] Vibe64 Online: whether the person owns the workspace.
 * @property {string} [productionIntegrationsApiPath] Vibe64 Online: the deployed release's integrations.
 * @property {string} [applicationPublicUrl] Vibe64 Online: the deployed application's address.
 */

/**
 * The Dashboard's section links, each shown when its placement's visibleWhen accepts the dashboard context.
 * @param {{ dashboardContext: import("vue").MaybeRefOrGetter<Vibe64DashboardContext> }} options
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
 * @param {import("vue").MaybeRefOrGetter<Vibe64DashboardContext>} dashboardContext
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
