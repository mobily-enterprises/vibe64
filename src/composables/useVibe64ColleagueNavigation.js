import { computed, inject, nextTick, onScopeDispose, ref, unref, watch } from "vue";
import { isNavigationFailure, NavigationFailureType, useRoute, useRouter } from "vue-router";
import { applyLearningNavigation, learningPanelFocus, learningPanelMatches } from "@local/vibe64-colleague/shared/learning-focus";
import { VIBE64_COLLEAGUE_PANES } from "@local/vibe64-colleague/shared/navigation-panes";
import { projectAppPath, projectSlugFromRoute } from "@/lib/vibe64ProjectScope.js";
import {
  VIBE64_ASSISTANT_HOST_KEY,
  VIBE64_BROWSER_NAVIGATION_KEY,
  VIBE64_COLLEAGUE_DATABASE_KEY,
  VIBE64_COLLEAGUE_INTEGRATIONS_KEY,
  VIBE64_COLLEAGUE_LAYOUT_KEY,
  VIBE64_COLLEAGUE_PLAN_KEY,
  VIBE64_COLLEAGUE_PREVIEW_KEY,
  VIBE64_COLLEAGUE_VIEW_KEY,
  VIBE64_LEARNING_KEY,
  VIBE64_PAGE_FOCUS_KEY
} from "@/lib/vibe64AssistantHost.js";

const NAVIGATION_TIMEOUT_MS = 15000;
const TARGET_CHANGED = "The browser navigation target changed before it opened.";

// Colleague's page focus and browser navigation, for every host. A host adds
// its own dashboard panes, names the pane of a non-project studio place by its
// route, may require one signed-in actor across a navigation, and may keep the
// selected conversation in the URL (?conversation=, ?chat=main).
function useVibe64ColleagueNavigation({ panes = [], routePanes = {}, actorKey = null, conversationQuery = false } = {}) {
  const route = useRoute();
  const router = useRouter();
  const assistantLayer = inject(VIBE64_ASSISTANT_HOST_KEY, null);
  const colleagueView = inject(VIBE64_COLLEAGUE_VIEW_KEY);
  const colleaguePreview = inject(VIBE64_COLLEAGUE_PREVIEW_KEY, null);
  const colleagueIntegrations = inject(VIBE64_COLLEAGUE_INTEGRATIONS_KEY);
  const colleagueDatabase = inject(VIBE64_COLLEAGUE_DATABASE_KEY);
  const colleaguePlan = inject(VIBE64_COLLEAGUE_PLAN_KEY);
  const colleagueLayout = inject(VIBE64_COLLEAGUE_LAYOUT_KEY);
  const browserNavigation = inject(VIBE64_BROWSER_NAVIGATION_KEY, null);
  // The shared Learning environment (L) controller; absent in hosts without it.
  const learningOwner = inject(VIBE64_LEARNING_KEY, null);
  const learningController = computed(() => unref(learningOwner) || null);
  const allPanes = new Set([...VIBE64_COLLEAGUE_PANES, ...panes]);
  const currentView = computed(() => colleagueView.value?.projectSlug === projectSlugFromRoute(route) ? colleagueView.value : null);
  const restoringSelection = ref(false);
  const selectionError = ref("");
  // Reactive, so a newer navigation releases an older one's wait at once.
  const navigationGeneration = ref(0);

  if (conversationQuery) {
    // The URL's conversation opens in the current session's view.
    watch([() => route.fullPath, currentView, () => currentView.value?.ready, () => currentView.value?.sessionId],
      async (_value, _previous, onCleanup) => {
        let current = true;
        onCleanup(() => { current = false; });
        restoringSelection.value = false;
        selectionError.value = "";
        const view = currentView.value;
        const conversationId = typeof route.query.conversation === "string" ? route.query.conversation : "";
        if (!view?.ready || view.sessionId !== route.query.session || (!conversationId && route.query.chat !== "main")) return;
        if (!view.hostConversationSelected && view.conversationId === conversationId && (conversationId || !view.temporarySelected)) return;
        const revision = view.selectionRevision;
        const hostSelected = view.hostConversationSelected;
        restoringSelection.value = true;
        try {
          await view.openConversation(conversationId, () => current && currentView.value === view);
        } catch (error) {
          if (current && view.selectionRevision === revision && view.hostConversationSelected === hostSelected) {
            selectionError.value = error.message || "The selected conversation could not be opened.";
          }
        } finally {
          if (current) restoringSelection.value = false;
        }
      }, { immediate: true });

    // The view's selected conversation is written back to the URL.
    watch(() => ({
      view: currentView.value,
      sessionId: currentView.value?.sessionId,
      ready: currentView.value?.ready,
      revision: currentView.value?.selectionRevision,
      conversationId: currentView.value?.conversationId,
      temporarySelected: currentView.value?.temporarySelected,
      hostSelected: currentView.value?.hostConversationSelected,
      restoring: restoringSelection.value,
      path: route.path,
      routeSession: route.query.session
    }), (selection, previous) => {
      if (!selection.ready || !selection.sessionId || (selection.routeSession && selection.routeSession !== selection.sessionId)) return;
      const manual = selection.view === previous?.view && selection.revision !== previous.revision;
      if ((selection.restoring || selectionError.value) && !manual && !selection.hostSelected) return;
      const query = { ...route.query, session: selection.sessionId };
      delete query.conversation;
      delete query.chat;
      if (!selection.hostSelected) {
        if (selection.conversationId) query.conversation = selection.conversationId;
        else if (!selection.temporarySelected) query.chat = "main";
      }
      if (query.session !== route.query.session || query.conversation !== route.query.conversation || query.chat !== route.query.chat) {
        void router.replace({ path: route.path, query });
      }
    }, { flush: "post" });
  }

  const focus = computed(() => {
    const routePane = Object.hasOwn(routePanes, route.path) ? routePanes[route.path] : "";
    if (routePane) {
      return { projectSlug: "", sessionId: "", conversationId: "", pane: routePane, route: route.path, ...learningPanelFocus(learningController.value) };
    }
    const projectSlug = projectSlugFromRoute(route);
    const sessionId = projectSlug ? currentView.value?.sessionId || unref(assistantLayer)?.sessionId || String(route.query.session || "") : "";
    const layout = colleagueLayout.value;
    // pane=lesson: the lesson is on screen (its Lesson toggle on, over Preview,
    // Dash or a studio page; also without a project).
    const pane = (projectSlug || layout?.lessonVisible) && layout?.projectSlug === projectSlug && layout.ready
      ? (!layout.projectVisible ? "chat" : layout.lessonVisible ? "lesson"
        : route.path.split("/dashboard/")[1]?.split("/")[0] || "preview") : "";
    const preview = unref(colleaguePreview);
    const integration = colleagueIntegrations.value;
    const database = colleagueDatabase.value;
    const plan = colleaguePlan.value;
    const databaseFocus = {};
    if (pane === "database" && database?.projectSlug === projectSlug && database.sessionId === sessionId) {
      databaseFocus.databaseScreen = database.screen;
      if (database.screen === "workspace") {
        databaseFocus.databaseView = database.view;
        if (database.view === "data" && database.table && database.table.length <= 256) {
          databaseFocus.databaseTable = database.table;
        }
      }
    }
    return {
      projectSlug, sessionId, conversationId: currentView.value?.conversationId || "", pane, route: route.path,
      ...learningPanelFocus(learningController.value),
      ...(pane === "preview" && preview?.projectSlug === projectSlug && preview.sessionId === sessionId
        ? { previewScreen: preview.screen } : {}),
      ...(pane === "integrations" && integration?.projectSlug === projectSlug &&
        (integration.environment === "production" || integration.sessionId === sessionId) && integration.ready
        ? { integrationEnvironment: integration.environment, integrationDirty: integration.dirty,
          ...(integration.exists && integration.integrationId.length <= 200 ? { integrationId: integration.integrationId } : {}) } : {}),
      ...databaseFocus,
      ...(plan?.projectSlug === projectSlug && plan.sessionId === sessionId && plan.open ? { planView: plan.view } : {})
    };
  });

  // The shared lesson step bar's beat player reads this page focus.
  const pageFocus = inject(VIBE64_PAGE_FOCUS_KEY, null);
  if (pageFocus) {
    watch(focus, value => { pageFocus.value = value; }, { immediate: true });
    onScopeDispose(() => { pageFocus.value = null; });
  }

  function waitFor(ready, failure, isCurrent, error = () => "") {
    if (ready()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { unwatch(); reject(new Error(failure)); }, NAVIGATION_TIMEOUT_MS);
      const unwatch = watch([ready, error, isCurrent], ([isReady, message, current]) => {
        if (!isReady && !message && current) return;
        clearTimeout(timer); unwatch();
        if (!current) reject(new Error(TARGET_CHANGED));
        else if (message) reject(new Error(message));
        else resolve();
      });
    });
  }

  async function navigate(command = {}) {
    const generation = ++navigationGeneration.value;
    const expectedActor = unref(actorKey);
    const isCurrent = () => generation === navigationGeneration.value && unref(actorKey) === expectedActor;
    const assertCurrent = () => { if (!isCurrent()) throw new Error(TARGET_CHANGED); };
    // A studio place (navigation.guide): the page at its route.
    if (command.route) {
      const result = await router.push(command.route);
      assertCurrent();
      if ((isNavigationFailure(result) && !isNavigationFailure(result, NavigationFailureType.duplicated)) || route.path !== command.route) {
        throw new Error("The page did not open.");
      }
      return { ...focus.value };
    }
    if (command.learning) {
      await applyLearningNavigation(learningController.value, command.learning);
      assertCurrent();
      if (!command.projectSlug) {
        await waitFor(() => learningPanelMatches(command, focus.value), "Learning did not show the requested lesson.", isCurrent);
        return { ...focus.value };
      }
    }
    if (command.pane && !allPanes.has(command.pane)) throw new Error("This project view is unavailable.");
    const integrationSelection = Boolean(command.integrationId || command.integrationEnvironment);
    const integrationEnvironment = command.integrationEnvironment || "development";
    if (integrationSelection && (command.pane !== "integrations" || !["development", "production"].includes(integrationEnvironment) ||
        (integrationEnvironment === "development" && !command.sessionId))) {
      throw new Error("Choose Integrations and either a development session or the production environment.");
    }
    if (command.databaseTable && (command.databaseView !== "data" || command.pane !== "database" || !command.sessionId)) {
      throw new Error("A table requires its exact session and Database Data view.");
    }
    if (command.databaseView && (command.pane !== "database" || !command.sessionId || !["overview", "erd", "data"].includes(command.databaseView))) {
      throw new Error("A database view requires its exact session and Database pane.");
    }
    if (command.planView && (!command.sessionId || command.pane || command.conversationId || !["default", "current", "history"].includes(command.planView))) {
      throw new Error("A plan viewer requires its exact session's Main chat, without another pane or conversation.");
    }
    if (!command.projectSlug) throw new Error("Choose a project before opening this view.");
    const path = projectAppPath(command.projectSlug, command.pane && command.pane !== "preview" ? `/dashboard/${command.pane}` : "");
    // The requested view replaces the shown one from a clean query: another
    // project's session never travels with it.
    const query = {
      ...(command.sessionId ? { session: command.sessionId,
        ...(conversationQuery ? command.conversationId ? { conversation: command.conversationId } : { chat: "main" } : {}) } : {}),
      ...(integrationSelection ? { integrationEnvironment,
        ...(integrationEnvironment === "development" ? { integrationSession: command.sessionId } : {}),
        ...(command.integrationId ? { integration: command.integrationId } : {}) } : {}),
      // Start table selection in Overview to avoid an unrelated initial Data query.
      ...(command.databaseView ? { databaseView: command.databaseTable ? "overview" : command.databaseView } : {}) };
    const result = await router.push({ path, query });
    assertCurrent();
    if (isNavigationFailure(result) && !isNavigationFailure(result, NavigationFailureType.duplicated)) throw new Error("The project did not open.");
    const integration = computed(() => {
      const panel = colleagueIntegrations.value;
      return panel && route.path === path && panel.projectSlug === command.projectSlug &&
        (integrationEnvironment === "production" || panel.sessionId === command.sessionId) ? panel : null;
    });
    const layout = computed(() => {
      const owner = colleagueLayout.value;
      return route.path === path && owner?.projectSlug === command.projectSlug && owner.ready ? owner : null;
    });
    const database = computed(() => {
      const panel = colleagueDatabase.value;
      return panel && route.path === path && panel.projectSlug === command.projectSlug && panel.sessionId === command.sessionId ? panel : null;
    });
    const plan = computed(() => {
      const viewer = colleaguePlan.value;
      return viewer && route.path === path && viewer.projectSlug === command.projectSlug && viewer.sessionId === command.sessionId ? viewer : null;
    });
    const openChat = !command.pane && Boolean(command.sessionId);
    const stopLayout = watch(layout, (owner) => {
      if (openChat) owner?.showChat();
      else owner?.showProject();
    }, { immediate: true });
    const stopSelection = integrationSelection ? watch(integration, (panel) => panel?.select(command.integrationId || "", integrationEnvironment), { immediate: true }) : () => {};
    try {
      if (command.sessionId && !conversationQuery) {
        // Without a URL selection owner, this navigation opens the conversation itself.
        await waitFor(() => currentView.value?.ready && currentView.value.sessionId === command.sessionId,
          "The requested session did not become ready.", isCurrent);
        await currentView.value.openConversation(command.conversationId || "", isCurrent);
        assertCurrent();
      }
      const matches = () => {
        const owner = layout.value;
        const view = currentView.value;
        const panel = integration.value;
        const displayed = focus.value;
        if (!learningPanelMatches(command, displayed)) return false;
        if (!owner || !(openChat ? owner.chatVisible : owner.projectVisible)) return false;
        if (command.sessionId && (!view?.ready || restoringSelection.value || view.hostConversationSelected ||
            view.sessionId !== command.sessionId || view.conversationId !== (command.conversationId || "") ||
            (!command.conversationId && view.temporarySelected))) return false;
        if (command.databaseView && (database.value?.screen !== "workspace" || (!command.databaseTable && database.value.view !== command.databaseView))) return false;
        if (command.planView && !plan.value?.ready) return false;
        return !integrationSelection || Boolean(panel?.ready && panel.environment === integrationEnvironment &&
          (!command.integrationId || (panel.exists && panel.integrationId === command.integrationId)));
      };
      const navigationError = () => {
        if (command.sessionId && selectionError.value) return selectionError.value;
        if (command.databaseView && database.value?.screen === "unavailable") return "Database could not load in this session.";
        if (command.planView && plan.value?.error) return plan.value.error;
        if (!integrationSelection) return "";
        const panel = integration.value;
        if (panel?.error) return panel.error;
        return command.integrationId && panel?.ready && panel.environment === integrationEnvironment && panel.integrationId === command.integrationId && !panel.exists
          ? "The requested integration is not configured in this environment." : "";
      };
      if (navigationError()) throw new Error(navigationError());
      await waitFor(matches, "The requested session, conversation or view did not become available.", isCurrent, navigationError);
      if (route.path !== path || command.projectSlug && projectSlugFromRoute(route) !== command.projectSlug) {
        throw new Error("Project selection changed before navigation completed.");
      }
      if (!matches()) throw new Error("The requested view changed before navigation completed.");
      if (integrationSelection && (focus.value.integrationEnvironment !== integrationEnvironment ||
          (command.integrationId && focus.value.integrationId !== command.integrationId))) {
        throw new Error("The integration selection changed before navigation completed.");
      }
      if (command.databaseTable) {
        database.value.selectTable(command.databaseTable);
        await nextTick();
        if (!matches() || focus.value.databaseView !== "data" || focus.value.databaseTable !== command.databaseTable) {
          throw new Error("The requested table did not become visible.");
        }
      }
      if (command.planView) {
        const viewer = plan.value;
        await viewer.openPlan(command.planView, () => isCurrent() && plan.value === viewer && route.path === path &&
          currentView.value?.sessionId === command.sessionId && layout.value?.chatVisible);
        if (!matches() || !viewer.open || focus.value.planView !== viewer.view) {
          throw new Error("The requested plan viewer did not become visible.");
        }
      }
      return { ...focus.value };
    } finally {
      stopLayout();
      stopSelection();
    }
  }

  if (browserNavigation) browserNavigation.value = navigate;
  onScopeDispose(() => {
    navigationGeneration.value += 1;
    if (browserNavigation?.value === navigate) browserNavigation.value = null;
  });

  return { focus, navigate, currentView, restoringSelection, selectionError };
}

export { useVibe64ColleagueNavigation };
