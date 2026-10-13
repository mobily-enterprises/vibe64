<script setup>
import { computed, ref } from "vue";
import { mdiPin, mdiPinOutline } from "@mdi/js";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { useUiFeedback } from "@jskit-ai/http-web/client/composables/useUiFeedback";
import { vibe64SessionPath } from "@/lib/vibe64SessionRequestConfig.js";

const props = defineProps({
  session: { type: Object, required: true },
  sessionsApiPath: { type: String, required: true },
  refresh: Function
});
const pinned = computed(() => props.session.pinnedSessionId === props.session.sessionId);
const anotherPinned = computed(() => Boolean(props.session.pinnedSessionId) && !pinned.value);
const pending = ref(false);
const label = computed(() => {
  if (pending.value) return "Updating session pin…";
  if (anotherPinned.value) return "Unpin the project's pinned session first";
  return pinned.value ? "Unpin session" : "Pin session as project source";
});
const path = vibe64SessionPath(props.sessionsApiPath, props.session.sessionId, "/pin");
const resource = useEndpointResource({ path, queryKey: ["vibe64.sessionPin", path], enabled: false });
const feedback = useUiFeedback({ source: "vibe64.sessions.pin" });

async function toggle() {
  if (pending.value || anotherPinned.value) return;
  pending.value = true;
  try {
    await resource.save({ pinned: !pinned.value }, { method: "PATCH" });
    await props.refresh?.();
  } catch (error) {
    feedback.error(error, "The session pin could not be changed.");
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <v-btn
    :icon="pinned ? mdiPin : mdiPinOutline"
    :color="pinned ? 'primary' : undefined"
    :aria-label="label"
    :title="label"
    :aria-pressed="pinned"
    :aria-busy="pending"
    :disabled="pending || anotherPinned"
    variant="text"
    height="48"
    width="48"
    @click="toggle"
  />
</template>
