<script setup>
import { useRoute } from "vue-router";
import { projectSlugFromRoute } from "@/lib/vibe64ProjectScope.js";
import { computed, inject, ref } from "vue";
import { Vibe64Colleague } from "@local/vibe64-colleague/client";
import { useTrainingWorkspaceObservation } from "@local/vibe64-training/client/workspace-observation";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { resolveStudioRequestUrl } from "@/lib/studioUrls.js";
import { VIBE64_ASSISTANT_VIEWER_KEY, VIBE64_COLLEAGUE_VIEW_KEY, VIBE64_COLLEAGUE_LAYOUT_KEY } from "@/lib/vibe64AssistantHost.js";
const viewer = inject(VIBE64_ASSISTANT_VIEWER_KEY);
const view = inject(VIBE64_COLLEAGUE_VIEW_KEY);
const layout = inject(VIBE64_COLLEAGUE_LAYOUT_KEY);
const actor = computed(() => viewer?.actorKey || "");
const route = useRoute();
const focus = computed(() => {
  const learning = view.value?.learningBinding;
  const projectSlug = learning ? learning.noExercise === false ? learning.sourceProjectSlug : "" : projectSlugFromRoute(route);
  const current = view.value?.projectSlug === projectSlug ? view.value : null;
  return { projectSlug, sessionId: current?.sessionId || "", conversationId: current?.conversationId || "",
    pane: layout.value?.ready && layout.value.projectSlug === projectSlug
      ? layout.value.projectVisible ? learning ? current?.pane || "" : route.path.split("/dashboard/")[1]?.split("/")[0] || "preview" : "chat" : "" };
});
const selection = { projectSlug: computed(() => projectSlugFromRoute(route)), restoring: ref(false), error: ref("") };
const settleWorkspace = useTrainingWorkspaceObservation({ actor, view, layout, focus, selection });
const request = (url, options) => getHttpWebClient().request(resolveStudioRequestUrl(url), options);
// Server-supported Colleague actions remain available. Interactive routed
// navigation requires the composing host's real adapter; none is fabricated.
</script>

<template><Vibe64Colleague :focus="focus" :request="request" :settle-workspace="settleWorkspace" /></template>
