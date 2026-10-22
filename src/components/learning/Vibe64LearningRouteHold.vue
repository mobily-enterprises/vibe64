<script setup>
import { computed, inject, toValue, watch } from "vue";
import { useRoute } from "vue-router";
import { useQueryClient } from "@tanstack/vue-query";
import { VIBE64_ASSISTANT_VIEWER_KEY } from "@/lib/vibe64AssistantHost.js";
import { projectSlugFromRoute, vibe64ProjectQueryScope } from "@/lib/vibe64ProjectScope.js";
import { VIBE64_LEARNING_MODE_PROJECT_CODE, modeRedirect } from "@/lib/vibe64Learning.js";
import { useVibe64Learning } from "@/composables/useVibe64Learning.js";

// Wraps each host's routed pages. A project page renders only once the
// overlay has bound the signed-in viewer and read its mode, and not while
// the mode moves the address elsewhere: the overlay moves it, and the page
// never sends the requests the server would refuse.
//
// L always leaves a project page (Learn allows only the lesson's practice
// project, Develop never shows it), so the page is held from the press, before
// the server switches: nothing it asks for afterwards can meet the new mode's
// refusal. A request still in flight when the page is held is cancelled (its
// data reverts), and a refusal that a switch made elsewhere (Colleague, another
// tab) returned first is dropped, so the project never opens again on an error
// from the mode it was left in.
const learning = useVibe64Learning();
const viewer = inject(VIBE64_ASSISTANT_VIEWER_KEY, null);
const route = useRoute();
const queryClient = useQueryClient();
const held = computed(() => {
  const slug = projectSlugFromRoute(route);
  const actorKey = String(toValue(viewer)?.actorKey || "");
  if (!learning || !actorKey || !slug) return false;
  return learning.state.actorKey !== actorKey || !learning.state.modeRead || learning.state.modeBusy === "set" ||
    Boolean(modeRedirect({ mode: learning.mode, slug, path: route.path }));
});

function leaveProject(slug) {
  const queryKey = ["vibe64", ...vibe64ProjectQueryScope(slug)];
  void queryClient.cancelQueries({ queryKey }).then(() => queryClient.removeQueries({ queryKey,
    predicate: query => query.state.error?.code === VIBE64_LEARNING_MODE_PROJECT_CODE }));
}

watch(() => [held.value, projectSlugFromRoute(route)], ([isHeld], [wasHeld, shownSlug] = []) => {
  if (isHeld && wasHeld === false && shownSlug) leaveProject(shownSlug);
});
</script>

<template><slot v-if="!held" /></template>
