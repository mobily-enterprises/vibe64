<script setup>
import { provide, shallowRef } from "vue";
import { useRouter } from "vue-router";
import { VIBE64_ASSISTANT_HOST_KEY, VIBE64_COLLEAGUE_VIEW_KEY, VIBE64_COLLEAGUE_PREVIEW_KEY, VIBE64_COLLEAGUE_INTEGRATIONS_KEY, VIBE64_COLLEAGUE_DATABASE_KEY, VIBE64_COLLEAGUE_PLAN_KEY, VIBE64_COLLEAGUE_LAYOUT_KEY, VIBE64_COLLEAGUE_LAUNCHER_KEY, VIBE64_ASSISTANT_VIEWER_KEY, VIBE64_BROWSER_NAVIGATION_KEY, VIBE64_LEARNING_KEY } from "@/lib/vibe64AssistantHost.js";
import { createVibe64Learning } from "@/lib/vibe64Learning.js";
const props = defineProps({ local: Boolean });
// Standalone's existing local display scope is not a hosted authenticated user.
// Hosted AuthGate continues to supply its real viewer to authenticated children.
if (props.local) provide(VIBE64_ASSISTANT_VIEWER_KEY, Object.freeze({ actorKey: "local" }));
provide(VIBE64_ASSISTANT_HOST_KEY, shallowRef(null));
const colleagueView = shallowRef(null);
provide(VIBE64_COLLEAGUE_VIEW_KEY, colleagueView);
provide(VIBE64_COLLEAGUE_PREVIEW_KEY, shallowRef(null));
provide(VIBE64_COLLEAGUE_INTEGRATIONS_KEY, shallowRef(null));
provide(VIBE64_COLLEAGUE_DATABASE_KEY, shallowRef(null));
provide(VIBE64_COLLEAGUE_PLAN_KEY, shallowRef(null));
const layout = shallowRef(null);
provide(VIBE64_COLLEAGUE_LAYOUT_KEY, layout);
const browserNavigation = shallowRef(null);
provide(VIBE64_BROWSER_NAVIGATION_KEY, browserNavigation);
// One Learn/Develop controller for both hosts; the overlay binds its signed-in viewer.
provide(VIBE64_LEARNING_KEY, createVibe64Learning({ browserNavigation, colleagueView, layout, router: useRouter() }));
provide(VIBE64_COLLEAGUE_LAUNCHER_KEY, shallowRef(null));
</script>

<template><slot /></template>
