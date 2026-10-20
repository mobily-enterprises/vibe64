<script setup>
import { computed, inject, toValue } from "vue";
import { useRoute } from "vue-router";
import { VIBE64_ASSISTANT_VIEWER_KEY } from "@/lib/vibe64AssistantHost.js";
import { projectSlugFromRoute } from "@/lib/vibe64ProjectScope.js";
import { useVibe64Learning } from "@/composables/useVibe64Learning.js";

// Wraps each host's routed pages. A project page renders only once the
// Learning overlay has bound the signed-in viewer and read its learning mode,
// and not while learning mode redirects it: the overlay redirects, and the
// page never sends the requests the server would refuse.
const learning = useVibe64Learning();
const viewer = inject(VIBE64_ASSISTANT_VIEWER_KEY, null);
const route = useRoute();
const held = computed(() => {
  const slug = projectSlugFromRoute(route);
  const actorKey = String(toValue(viewer)?.actorKey || "");
  if (!learning || !actorKey || !slug) return false;
  return learning.state.actorKey !== actorKey || learning.holdsProject(slug);
});
</script>

<template><slot v-if="!held" /></template>
