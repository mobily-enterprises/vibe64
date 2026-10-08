<script setup>
import { provide, shallowRef } from "vue";
import { VIBE64_ASSISTANT_HOST_KEY, VIBE64_COLLEAGUE_VIEW_KEY, VIBE64_COLLEAGUE_PREVIEW_KEY, VIBE64_COLLEAGUE_INTEGRATIONS_KEY, VIBE64_COLLEAGUE_DATABASE_KEY, VIBE64_COLLEAGUE_PLAN_KEY, VIBE64_COLLEAGUE_LAYOUT_KEY, VIBE64_COLLEAGUE_LAUNCHER_KEY, VIBE64_TRAINING_LEARNER_GESTURE_KEY, VIBE64_COLLEAGUE_BODY_KEY, VIBE64_ASSISTANT_VIEWER_KEY } from "@/lib/vibe64AssistantHost.js";
const props = defineProps({ local: Boolean });
// Standalone's existing local display scope is not a hosted authenticated user.
// Hosted AuthGate continues to supply its real viewer to authenticated children.
if (props.local) provide(VIBE64_ASSISTANT_VIEWER_KEY, Object.freeze({ actorKey: "local" }));
provide(VIBE64_ASSISTANT_HOST_KEY, shallowRef(null));
provide(VIBE64_COLLEAGUE_VIEW_KEY, shallowRef(null));
provide(VIBE64_COLLEAGUE_PREVIEW_KEY, shallowRef(null));
provide(VIBE64_COLLEAGUE_INTEGRATIONS_KEY, shallowRef(null));
provide(VIBE64_COLLEAGUE_DATABASE_KEY, shallowRef(null));
provide(VIBE64_COLLEAGUE_PLAN_KEY, shallowRef(null));
provide(VIBE64_COLLEAGUE_LAYOUT_KEY, shallowRef(null));
provide(VIBE64_COLLEAGUE_LAUNCHER_KEY, shallowRef(null));
provide(VIBE64_TRAINING_LEARNER_GESTURE_KEY, shallowRef(null));
provide(VIBE64_COLLEAGUE_BODY_KEY, shallowRef(null));
</script>

<template><slot /></template>
