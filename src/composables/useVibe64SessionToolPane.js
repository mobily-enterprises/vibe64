import { computed, ref, unref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { normalizeObject, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  VIBE64_SESSION_TOOL_DEFINITIONS,
  vibe64SessionToolDashboardSuffix,
  vibe64SessionToolIdFromDashboardPath
} from "@/lib/vibe64SessionToolDefinitions.js";
import {
  normalizeProjectRoutePath,
  projectAppPath
} from "@/lib/vibe64ProjectScope.js";
import { normalizeProjectPane } from "@/lib/vibe64SessionPanelModel.js";
import {
  vibe64SessionShortLabel,
  vibe64SessionStatusColor,
  vibe64SessionStatusLabel
} from "@/lib/vibe64SessionViewModel.js";

const DIRECT_SESSION_TOOL_IDS = new Set([
  "info",
  "changes",
  "repository",
  "editor",
  "database",
  "system",
  "ai-terminal"
]);
const STANDALONE_SESSION_TOOL_IDS = new Set([
  "changes",
  "editor",
  "database",
  "system"
]);

function sessionNavLabel(session = {}) {
  const name = vibe64SessionShortLabel(session);
  if (name) {
    return name;
  }
  const sessionId = normalizeText(session.sessionId);
  return sessionId.includes("_")
    ? sessionId.split("_").slice(-2).join("_")
    : sessionId.slice(0, 12);
}

/**
 * What a Dashboard tool reads and calls: this pane's context for its session, or the session panel's empty-state
 * context (the project and its sessions path) while no session is selected. The session panel adds its session
 * toolbar to either before handing it to the Dashboard. The members only a session has are absent while none is
 * open, and a host that deploys releases adds the deployed release's members.
 * @typedef {object} Vibe64DashboardContext
 * @property {Record<string, any>} projectContext The open project's record.
 * @property {import("vue").MaybeRefOrGetter<string>} sessionsApiPath
 * @property {import("@/composables/useVibe64SessionPanel.js").Vibe64SessionToolbarContract} [sessionToolbar] The
 *   session toolbar, which also creates sessions; every context a Dashboard page receives carries it.
 * @property {boolean} [active] False while the Dashboard pane is hidden.
 * @property {Record<string, any>} [activeSessionNav]
 * @property {(text: string) => Promise<unknown>} [copyText]
 * @property {boolean} [embeddedShell]
 * @property {string} [sessionId]
 * @property {Record<string, any> | null} [session]
 * @property {boolean} [sourceOperationsSuspended]
 * @property {string} [statusColor]
 * @property {string} [statusLabel]
 * @property {Record<string, any> | null} [workState]
 * @property {(observedWork?: Record<string, any> | null) => Promise<unknown>} [refreshSessionWork] Present while a
 *   session is open.
 * @property {(...args: any[]) => unknown} [requestSaveWork] Present while a session is open.
 * @property {(options?: object) => Promise<unknown>} [requestUpdateWork] Present while a session is open.
 * @property {() => unknown} [refreshConversation] Present while a session is open.
 * @property {(text: string) => void} [requestAssistantDraft] Present while a session is open.
 * @property {boolean} [assistantDraftAvailable]
 * @property {boolean} [assistantFixAllowed]
 * @property {string} [assistantFixRestrictionMessage]
 * @property {boolean} [owner] Host-supplied: whether the person owns the workspace.
 * @property {string} [productionIntegrationsApiPath] Host-supplied: the deployed release's integrations.
 * @property {string} [applicationPublicUrl] Host-supplied: the deployed application's address.
 */

/** The right pane's session tools: the routed Dashboard tool and editor, database and system open requests. */
function useVibe64SessionToolPane(props, emit, {
  actorKey,
  assistantAccessPending,
  assistantCanUseNative = null,
  assistantDirectAllowed,
  projectSlug,
  requestSaveWork,
  sessionId,
  sessionSourceRoot
}) {
  const route = useRoute();
  const router = useRouter();
  const rightPaneTab = ref("preview");
  const lastDashboardRoutePath = ref("");
  const sourceEditorOpenRequest = ref(null);
  const systemRestoreRequest = ref(null);
  const databaseOpenRequest = ref(null);
  const systemReturnContext = ref(null);
  let sourceEditorOpenSequence = 0;
  let systemRestoreSequence = 0;

  const projectPaneValue = computed(() => normalizeProjectPane(props.projectPane));
  const routeSessionToolId = computed(() => {
    const toolId = vibe64SessionToolIdFromDashboardPath(route.path, projectAppPath(projectSlug.value, "/dashboard"));
    return DIRECT_SESSION_TOOL_IDS.has(toolId) ? toolId : "";
  });
  const sourceToolLoading = computed(() => Boolean(
    projectPaneValue.value === "dashboard" &&
    STANDALONE_SESSION_TOOL_IDS.has(routeSessionToolId.value) &&
    !sessionSourceRoot.value &&
    props.page?.launchBusy
  ));
  const dashboardShellVisible = computed(() => Boolean(
    projectPaneValue.value === "dashboard" &&
    !sourceToolLoading.value &&
    !STANDALONE_SESSION_TOOL_IDS.has(rightPaneTab.value)
  ));
  const dashboardRouteVisible = computed(() => [
    "dashboard",
    "info",
    "repository"
  ].includes(rightPaneTab.value));
  const sessionToolBackPath = computed(() => (
    lastDashboardRoutePath.value || projectAppPath(projectSlug.value, "/dashboard/env")
  ));

  function sessionToolRuntimeState(toolId = "") {
    if (
      toolId === "ai-terminal" &&
      !assistantAccessPending.value &&
      !(assistantCanUseNative === null ? assistantDirectAllowed.value : unref(assistantCanUseNative) === true)
    ) {
      return {
        disabled: true,
        title: "The AI terminal requires access to this conversation’s current connection. Use chat to send through an available mode."
      };
    }
    if (toolId === "editor") {
      return { disabled: !props.session, title: "Browse repository files, Drop Zone and session files" };
    }
    if (["database", "system"].includes(toolId)) {
      return {
        disabled: !sessionSourceRoot.value,
        title: sessionSourceRoot.value
          ? (
              toolId === "database"
                ? "Query and map the active session database"
                : "Explore the current project Cities"
            )
          : "Create the session source first"
      };
    }
    return {};
  }

  const sessionToolControls = computed(() => VIBE64_SESSION_TOOL_DEFINITIONS
    .filter((definition) => definition.navigationScope !== "project" && DIRECT_SESSION_TOOL_IDS.has(definition.id))
    .map((definition) => ({
      ...definition,
      ...sessionToolRuntimeState(definition.id)
    })));

  function sessionToolRoutePath(toolId = "") {
    const suffix = vibe64SessionToolDashboardSuffix(toolId);
    return suffix ? projectAppPath(projectSlug.value, suffix) : "";
  }

  function selectSessionTool(toolId = "", { navigate = true } = {}) {
    if (!DIRECT_SESSION_TOOL_IDS.has(toolId)) {
      return false;
    }
    // Git log moved to the project navigation but still opens as this pane's
    // dashboard page; without it, its route fell back to Env.
    const tool = sessionToolControls.value.find((item) => item.id === toolId) ||
      VIBE64_SESSION_TOOL_DEFINITIONS.find((item) => item.id === toolId && item.navigationScope === "project");
    if (!tool || tool.disabled) {
      return false;
    }
    rightPaneTab.value = toolId;
    if (navigate) {
      const targetPath = sessionToolRoutePath(toolId);
      if (targetPath && normalizeProjectRoutePath(targetPath) !== normalizeProjectRoutePath(route.path)) {
        void router.push(targetPath);
      }
    }
    emit("project-attention");
    return true;
  }

  function backToDashboard() {
    const targetPath = sessionToolBackPath.value;
    if (targetPath && normalizeProjectRoutePath(targetPath) !== normalizeProjectRoutePath(route.path)) {
      void router.push(targetPath);
    }
  }

  function rightPaneTabMounted(tabId = "") {
    return rightPaneTab.value === String(tabId || "");
  }

  const activeSessionNav = computed(() => ({
    label: sessionNavLabel(props.session || {}),
    selectTool: selectSessionTool,
    sessionId: sessionId.value,
    status: String(props.session?.status || ""),
    statusLabel: vibe64SessionStatusLabel(props.session?.status),
    tools: sessionToolControls.value.map((tool) => ({
      ...tool,
      active: rightPaneTab.value === tool.id,
      disabledReason: tool.disabled ? tool.title || "" : "",
      to: sessionToolRoutePath(tool.id)
    })),
    visible: Boolean(props.session)
  }));
  const dashboardSessionContext = computed(() => ({
    active: Boolean(props.active),
    activeSessionNav: activeSessionNav.value,
    copyText: props.page.copyText,
    embeddedShell: true,
    projectContext: props.projectContext || {},
    refreshSessionWork: props.refreshSessionWork,
    refreshConversation: () => props.conversationLog?.reload(),
    requestSaveWork,
    session: props.session || null,
    sessionId: sessionId.value,
    sessionsApiPath: props.sessionsApiPath,
    statusColor: vibe64SessionStatusColor(props.session?.status),
    statusLabel: vibe64SessionStatusLabel(props.session?.status),
    workState: props.workState || null
  }));

  const systemBackAvailable = computed(() => Boolean(
    systemReturnContext.value?.sessionId === sessionId.value
  ));

  // A source link, a starred file or a Usage location; a request without one opens nothing.
  function openSourceEditorFile(request) {
    const target = normalizeObject(request);
    const path = normalizeText(target.path);
    if (!path) {
      return false;
    }
    systemReturnContext.value = target.origin === "system"
      ? {
          ...(target.systemContext && typeof target.systemContext === "object" ? target.systemContext : {}),
          sessionId: sessionId.value
        }
      : null;
    sourceEditorOpenSequence += 1;
    sourceEditorOpenRequest.value = {
      column: Number(target.column || 0) || 0,
      line: Number(target.line || 0) || 0,
      path,
      presentation: target.presentation || "interface",
      symbolId: target.symbolId || "",
      symbol: target.symbol || "",
      sequence: sourceEditorOpenSequence
    };
    return selectSessionTool("editor");
  }

  function openSubsystemTable(target = {}) {
    if (!target.qualifiedName) return false;
    systemReturnContext.value = { ...target.systemContext, sessionId: sessionId.value };
    databaseOpenRequest.value = { qualifiedName: target.qualifiedName, sequence: Date.now() };
    return selectSessionTool("database");
  }

  function backToSystemFromEditor() {
    if (!systemBackAvailable.value) {
      return false;
    }
    systemRestoreSequence += 1;
    systemRestoreRequest.value = {
      ...systemReturnContext.value,
      sequence: systemRestoreSequence
    };
    return selectSessionTool("system");
  }

  watch(() => [
    props.active,
    projectPaneValue.value,
    route.path,
    routeSessionToolId.value,
    sessionSourceRoot.value,
    sourceToolLoading.value,
    assistantAccessPending.value,
    assistantDirectAllowed.value
  ].join("|"), () => {
    if (!props.active || projectPaneValue.value !== "dashboard") {
      return;
    }
    if (sourceToolLoading.value) {
      emit("project-attention");
      return;
    }
    if (routeSessionToolId.value) {
      if (selectSessionTool(routeSessionToolId.value, { navigate: false })) {
        return;
      }
      const fallbackPath = projectAppPath(projectSlug.value, "/dashboard/env");
      lastDashboardRoutePath.value = fallbackPath;
      rightPaneTab.value = "dashboard";
      if (normalizeProjectRoutePath(fallbackPath) !== normalizeProjectRoutePath(route.path)) {
        void router.replace(fallbackPath);
      }
      return;
    }
    lastDashboardRoutePath.value = route.path;
    rightPaneTab.value = "dashboard";
  }, { immediate: true });

  watch([sessionId, projectSlug, actorKey], () => {
    systemReturnContext.value = null;
    systemRestoreRequest.value = null;
    databaseOpenRequest.value = null;
  });

  return {
    backToDashboard,
    backToSystemFromEditor,
    dashboardRouteVisible,
    dashboardSessionContext,
    dashboardShellVisible,
    databaseOpenRequest,
    openSourceEditorFile,
    openSubsystemTable,
    rightPaneTab,
    rightPaneTabMounted,
    selectSessionTool,
    sourceEditorOpenRequest,
    sourceToolLoading,
    systemBackAvailable,
    systemRestoreRequest
  };
}

export { useVibe64SessionToolPane };
