<script setup>
import { useRoute, useRouter } from "vue-router";
import { computed, inject, nextTick, onBeforeUnmount, ref, watchEffect } from "vue";
import { Vibe64Colleague } from "@local/vibe64-colleague/client";
import { executeTrainingPresentationOperation, trainingPresentationReceipt } from "@local/vibe64-training/client/presentation-operation";
import { useTrainingWorkspaceObservation } from "@local/vibe64-training/client/workspace-observation";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { projectAppPath, projectSlugFromRoute } from "@/lib/vibe64ProjectScope.js";
import { resolveStudioRequestUrl } from "@/lib/studioUrls.js";
import { requestVibe64AccountConnectionsDialog } from "@/lib/vibe64AccountConnectionsDialog.js";
import {
  VIBE64_ASSISTANT_VIEWER_KEY,
  VIBE64_BROWSER_NAVIGATION_KEY,
  VIBE64_COLLEAGUE_DATABASE_KEY,
  VIBE64_COLLEAGUE_INTEGRATIONS_KEY,
  VIBE64_COLLEAGUE_LAYOUT_KEY,
  VIBE64_COLLEAGUE_PLAN_KEY,
  VIBE64_COLLEAGUE_PREVIEW_KEY,
  VIBE64_COLLEAGUE_VIEW_KEY,
  VIBE64_LEARNING_NAVIGATION_KEY
} from "@/lib/vibe64AssistantHost.js";

const viewer = inject(VIBE64_ASSISTANT_VIEWER_KEY);
const view = inject(VIBE64_COLLEAGUE_VIEW_KEY);
const layout = inject(VIBE64_COLLEAGUE_LAYOUT_KEY);
const preview = inject(VIBE64_COLLEAGUE_PREVIEW_KEY);
const database = inject(VIBE64_COLLEAGUE_DATABASE_KEY);
const integrations = inject(VIBE64_COLLEAGUE_INTEGRATIONS_KEY);
const plan = inject(VIBE64_COLLEAGUE_PLAN_KEY);
const browserNavigation = inject(VIBE64_BROWSER_NAVIGATION_KEY, null);
const learningNavigation = inject(VIBE64_LEARNING_NAVIGATION_KEY, null);
const actor = computed(() => viewer?.actorKey || "");
const route = useRoute();
const router = useRouter();

const focus = computed(() => {
  const learningMode = route.query.mode === "learning";
  const learning = learningMode ? view.value?.learningBinding : null;
  const projectSlug = learning?.noExercise === false ? learning.sourceProjectSlug : projectSlugFromRoute(route);
  const current = view.value?.projectSlug === projectSlug ? view.value : null;
  const pane = layout.value?.ready && layout.value.projectSlug === projectSlug
    ? layout.value.projectVisible
      ? learningMode ? current?.pane || (route.query.learningView === "learning" ? "lessons" : "")
        : route.path.split("/dashboard/")[1]?.split("/")[0] || "preview"
      : "chat"
    : "";
  const result = { projectSlug, sessionId: current?.sessionId || "", conversationId: current?.conversationId || "",
    pane, learningMode };
  if (learningMode) {
    result.learningView = current?.learningView || (route.query.learningView === "learning" ? "learning" : "workspace");
    result.learningContent = learning ? "active" : "picker";
    if (learning?.learningAttemptId) result.learningAttemptId = learning.learningAttemptId;
  }
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

const selection = { projectSlug: computed(() => projectSlugFromRoute(route)), restoring: ref(false), error: ref("") };
const settleWorkspace = useTrainingWorkspaceObservation({ actor, view, layout, focus, selection });
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
  if (command.learningMode !== undefined) {
    if (value.learningMode !== command.learningMode) return false;
    if (command.learningMode && (value.learningView !== command.learningView ||
        command.learningContent && value.learningContent !== command.learningContent ||
        command.learningAttemptId && value.learningAttemptId !== command.learningAttemptId)) return false;
    if (!command.learningMode && (value.learningView || value.learningContent || value.learningAttemptId)) return false;
  }
  if (command.projectSlug && command.learningContent !== "picker" && value.projectSlug !== command.projectSlug) return false;
  if (command.sessionId && value.sessionId !== command.sessionId) return false;
  if (command.conversationId !== undefined && value.conversationId !== command.conversationId) return false;
  const expectedPane = command.presentation
    ? command.pane || "preview"
    : command.learningView === "learning" ? "lessons" : command.pane ||
      (!command.sessionId ? "preview" : "");
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
  if (command.managementView) {
    if (command.managementView !== "accounts" || !requestVibe64AccountConnectionsDialog({ section: "ai" })) {
      throw new Error("This management view is unavailable in standalone Vibe64.");
    }
    return { route: route.fullPath };
  }
  if (!command.projectSlug) throw new Error("Choose a project before opening this view.");

  const suffix = command.pane && command.pane !== "preview" ? paneSuffix[command.pane] : "";
  if (command.pane && command.pane !== "preview" && !suffix) throw new Error("This project view is unavailable.");
  const query = { ...route.query };
  if (command.sessionId && command.learningMode !== true) query.session = command.sessionId;
  if (command.databaseView) query.databaseView = command.databaseView;
  if (command.pane === "integrations") {
    query.integrationEnvironment = command.integrationEnvironment || "development";
    query.integrationSession = command.sessionId || undefined;
    query.integration = command.integrationId || undefined;
  }
  await router.push({ path: projectAppPath(command.projectSlug, suffix), query });
  if (!isCurrent()) throw new Error("The browser navigation target changed before it opened.");
  await learningNavigation?.value?.(command, isCurrent);
  await nextTick();

  const expectedSession = command.sessionId || "";
  if (expectedSession) {
    await waitForNavigation(() => view.value?.projectSlug === command.projectSlug &&
      view.value?.sessionId === expectedSession && view.value?.ready, isCurrent,
    "The requested session did not become ready.");
  }
  if (expectedSession && command.learningMode !== true) {
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

  let presentation;
  if (command.presentation) {
    await waitForNavigation(() => preview.value?.projectSlug === command.projectSlug &&
      preview.value?.sessionId === expectedSession && preview.value?.presentation, isCurrent,
    "The requested lesson presentation did not become available.");
    const handle = preview.value;
    const player = handle.presentation;
    const result = await executeTrainingPresentationOperation(player, command.presentation);
    if (!isCurrent() || preview.value !== handle || preview.value?.presentation !== player) {
      throw new Error("The lesson presentation changed while its operation was running.");
    }
    presentation = trainingPresentationReceipt(result);
  }
  await waitForNavigation(() => focusMatches(command, focus.value), isCurrent,
    "The browser did not settle on the requested view.");
  // Same contract as the hosted navigator: a presentation operation returns its
  // focus with the player receipt; ordinary navigation returns the focus itself.
  return presentation ? { focus: { ...focus.value }, presentation } : { ...focus.value };
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
    :settle-workspace="settleWorkspace"
  />
</template>
