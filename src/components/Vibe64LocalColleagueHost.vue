<script setup>
import { useRoute, useRouter } from "vue-router";
import { computed, inject, nextTick, onBeforeUnmount, ref, unref, watchEffect } from "vue";
import { Vibe64Colleague } from "@local/vibe64-colleague/client";
import { applyLearningNavigation, learningPanelFocus, learningPanelMatches } from "@local/vibe64-colleague/shared/learning-focus";
import { Vibe64ColleagueAvatar } from "@local/vibe64-voice/client";
import { useVibe64LocalAvatarPreferences } from "@/composables/useVibe64LocalAvatarPreferences.js";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { projectAppPath, projectSlugFromRoute } from "@/lib/vibe64ProjectScope.js";
import { resolveStudioRequestUrl } from "@/lib/studioUrls.js";
import {
  VIBE64_BROWSER_NAVIGATION_KEY,
  VIBE64_COLLEAGUE_DATABASE_KEY,
  VIBE64_COLLEAGUE_INTEGRATIONS_KEY,
  VIBE64_COLLEAGUE_LAYOUT_KEY,
  VIBE64_COLLEAGUE_PLAN_KEY,
  VIBE64_COLLEAGUE_VIEW_KEY,
  VIBE64_LEARNING_KEY,
  VIBE64_PAGE_FOCUS_KEY
} from "@/lib/vibe64AssistantHost.js";

const view = inject(VIBE64_COLLEAGUE_VIEW_KEY);
const layout = inject(VIBE64_COLLEAGUE_LAYOUT_KEY);
const database = inject(VIBE64_COLLEAGUE_DATABASE_KEY);
const integrations = inject(VIBE64_COLLEAGUE_INTEGRATIONS_KEY);
const plan = inject(VIBE64_COLLEAGUE_PLAN_KEY);
const browserNavigation = inject(VIBE64_BROWSER_NAVIGATION_KEY, null);
// The shared Learning environment (L) controller; absent in hosts without it.
const learningOwner = inject(VIBE64_LEARNING_KEY, null);
const learningController = computed(() => unref(learningOwner) || null);
const route = useRoute();
const router = useRouter();
const { avatars } = useVibe64LocalAvatarPreferences();
const voiceVisual = ref(null);

const focus = computed(() => {
  const projectSlug = projectSlugFromRoute(route);
  const current = view.value?.projectSlug === projectSlug ? view.value : null;
  const pane = layout.value?.ready && layout.value.projectSlug === projectSlug
    ? !layout.value.projectVisible ? "chat" : layout.value.lessonVisible ? "lesson"
      : route.path.split("/dashboard/")[1]?.split("/")[0] || "preview"
    : "";
  const result = { projectSlug, sessionId: current?.sessionId || "", conversationId: current?.conversationId || "", pane,
    route: route.path, ...learningPanelFocus(learningController.value) };
  const displayedDatabase = pane === "database" && database.value?.projectSlug === projectSlug &&
    database.value.sessionId === result.sessionId ? database.value : null;
  if (displayedDatabase) {
    result.databaseScreen = displayedDatabase.screen;
    if (displayedDatabase.screen === "workspace") {
      result.databaseView = displayedDatabase.view;
      if (displayedDatabase.table) result.databaseTable = displayedDatabase.table;
    }
  }
  const displayedIntegrations = pane === "integrations" && integrations.value?.projectSlug === projectSlug &&
    (!integrations.value.sessionId || integrations.value.sessionId === result.sessionId) ? integrations.value : null;
  if (displayedIntegrations?.ready) {
    result.integrationEnvironment = displayedIntegrations.environment;
    result.integrationDirty = displayedIntegrations.dirty;
    if (displayedIntegrations.integrationId) result.integrationId = displayedIntegrations.integrationId;
  }
  const displayedPlan = plan.value?.projectSlug === projectSlug && plan.value.sessionId === result.sessionId ? plan.value : null;
  if (displayedPlan?.open) result.planView = displayedPlan.view;
  return result;
});

// The lesson step bar's beat player reads this page focus.
const pageFocus = inject(VIBE64_PAGE_FOCUS_KEY, null);
if (pageFocus) {
  watchEffect(() => { pageFocus.value = focus.value; });
  onBeforeUnmount(() => { pageFocus.value = null; });
}

const request = (url, options) => getHttpWebClient().request(resolveStudioRequestUrl(url), options);

const paneSuffix = Object.freeze({
  access: "/dashboard/access",
  changes: "/dashboard/changes",
  database: "/dashboard/database",
  env: "/dashboard/env",
  files: "/dashboard/files",
  history: "/dashboard/history",
  integrations: "/dashboard/integrations",
  repository: "/dashboard/repository",
  "repository-settings": "/dashboard/repository",
  session: "/dashboard/session",
  settings: "/dashboard/settings",
  system: "/dashboard/system",
  "ai-terminal": "/dashboard/ai-terminal"
});
let navigationGeneration = 0;

function waitForNavigation(predicate, isCurrent, failure) {
  return new Promise((resolve, reject) => {
    let stop;
    const timer = setTimeout(() => finish(new Error(failure)), 15000);
    function finish(error) {
      clearTimeout(timer);
      if (stop) stop();
      else queueMicrotask(() => stop?.());
      if (error) reject(error);
      else resolve();
    }
    stop = watchEffect(() => {
      if (!isCurrent()) finish(new Error("The browser navigation target changed before it opened."));
      else if (predicate()) finish();
    }, { flush: "post" });
  });
}

function focusMatches(command, value) {
  if (!learningPanelMatches(command, value)) return false;
  if (command.projectSlug && value.projectSlug !== command.projectSlug) return false;
  if (command.sessionId && value.sessionId !== command.sessionId) return false;
  if (command.conversationId !== undefined && value.conversationId !== command.conversationId) return false;
  const expectedPane = command.pane || (!command.sessionId ? "preview" : "");
  if (expectedPane && command.projectSlug && value.pane !== expectedPane) return false;
  if (command.databaseView && (value.databaseScreen !== "workspace" || value.databaseView !== command.databaseView)) return false;
  if (command.databaseTable && value.databaseTable !== command.databaseTable) return false;
  if (command.integrationEnvironment && value.integrationEnvironment !== command.integrationEnvironment) return false;
  if (command.integrationId && value.integrationId !== command.integrationId) return false;
  if (command.planView && value.planView !== (command.planView === "default" ? plan.value?.view : command.planView)) return false;
  return true;
}

async function navigate(command = {}) {
  const generation = ++navigationGeneration;
  const isCurrent = () => generation === navigationGeneration;
  // A studio place (navigation.guide): the page at its route.
  if (command.route) {
    await router.push({ path: command.route });
    await waitForNavigation(() => route.path === command.route, isCurrent, "The page did not open.");
    return { ...focus.value };
  }
  if (command.learning) {
    await applyLearningNavigation(learningController.value, command.learning);
    if (!isCurrent()) throw new Error("The browser navigation target changed before it opened.");
    if (!command.projectSlug) {
      await waitForNavigation(() => learningPanelMatches(command, focus.value), isCurrent,
        "Learning did not show the requested lesson.");
      return { ...focus.value };
    }
  }
  if (!command.projectSlug) throw new Error("Choose a project before opening this view.");

  const suffix = command.pane && command.pane !== "preview" ? paneSuffix[command.pane] : "";
  if (command.pane && command.pane !== "preview" && !suffix) throw new Error("This project view is unavailable.");
  // The requested view replaces the shown one, uncovered: the lesson's
  // flag (?lesson=1) and an empty project's ?pane go.
  const { pane: _pane, lesson: _lesson, ...query } = route.query;
  if (command.sessionId) query.session = command.sessionId;
  if (command.databaseView) query.databaseView = command.databaseView;
  if (command.pane === "integrations") {
    query.integrationEnvironment = command.integrationEnvironment || "development";
    query.integrationSession = command.sessionId || undefined;
    query.integration = command.integrationId || undefined;
  }
  await router.push({ path: projectAppPath(command.projectSlug, suffix), query });
  if (!isCurrent()) throw new Error("The browser navigation target changed before it opened.");
  await nextTick();

  const expectedSession = command.sessionId || "";
  if (expectedSession) {
    await waitForNavigation(() => view.value?.projectSlug === command.projectSlug &&
      view.value?.sessionId === expectedSession && view.value?.ready, isCurrent,
    "The requested session did not become ready.");
  }
  if (expectedSession) {
    await view.value?.openConversation(command.conversationId || "", isCurrent);
  }
  if (command.pane || !command.sessionId) layout.value?.showProject?.();
  else layout.value?.showChat?.();

  if (command.databaseView) {
    await waitForNavigation(() => database.value?.projectSlug === command.projectSlug &&
      database.value?.sessionId === expectedSession && database.value.screen !== "loading", isCurrent,
    "The requested Database view did not become available.");
    if (database.value.screen !== "workspace") throw new Error("Database is unavailable in this session.");
    if (command.databaseTable) database.value.selectTable(command.databaseTable);
  }
  if (command.pane === "integrations") {
    await waitForNavigation(() => integrations.value?.projectSlug === command.projectSlug &&
      (command.integrationEnvironment === "production" || integrations.value?.sessionId === expectedSession) &&
      (integrations.value?.ready || integrations.value?.error), isCurrent,
    "Integrations did not become available.");
    if (integrations.value.error) throw new Error(integrations.value.error);
    integrations.value.select(command.integrationId || "", command.integrationEnvironment || "development");
  }
  if (command.planView) {
    await waitForNavigation(() => plan.value?.projectSlug === command.projectSlug &&
      plan.value?.sessionId === expectedSession, isCurrent, "The requested plan viewer did not become available.");
    await plan.value.openPlan(command.planView, isCurrent);
  }

  await waitForNavigation(() => focusMatches(command, focus.value), isCurrent,
    "The browser did not settle on the requested view.");
  return { ...focus.value };
}

if (browserNavigation) browserNavigation.value = navigate;
onBeforeUnmount(() => {
  navigationGeneration += 1;
  if (browserNavigation?.value === navigate) browserNavigation.value = null;
});
</script>

<template>
  <Vibe64Colleague
    :focus="focus"
    :navigate="navigate"
    :request="request"
    @voice-visual="voiceVisual = $event"
  >
    <template #avatar="{ state }">
      <Vibe64ColleagueAvatar v-bind="voiceVisual || { state }" :avatar="avatars.colleague" />
    </template>
  </Vibe64Colleague>
</template>
