<script setup>
import { computed, inject, toValue } from "vue";
import { useRoute } from "vue-router";
import { VIBE64_ASSISTANT_VIEWER_KEY } from "@/lib/vibe64AssistantHost.js";
import { projectSlugFromRoute } from "@/lib/vibe64ProjectScope.js";
import { modeRedirect } from "@/lib/vibe64Learning.js";
import { useVibe64Learning } from "@/composables/useVibe64Learning.js";

// Wraps each host's routed pages. A project page renders only once the
// overlay has bound the signed-in viewer and read its mode, and not while
// the mode moves the address elsewhere: the overlay moves it, and the page
// never sends the requests the server would refuse.
const learning = useVibe64Learning();
const viewer = inject(VIBE64_ASSISTANT_VIEWER_KEY, null);
const route = useRoute();
const held = computed(() => {
  const slug = projectSlugFromRoute(route);
  const actorKey = String(toValue(viewer)?.actorKey || "");
  if (!learning || !actorKey || !slug) return false;
  return learning.state.actorKey !== actorKey || !learning.state.modeRead ||
    Boolean(modeRedirect({ mode: learning.mode, slug, path: route.path }));
});
</script>

<template><slot v-if="!held" /></template>
