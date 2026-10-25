<script setup>
import { computed, ref } from "vue";
import { mdiPin, mdiPinOutline } from "@mdi/js";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { VIBE64_SESSIONS_API_SUFFIX, VIBE64_SURFACE_ID, vibe64SessionPath } from "@/lib/vibe64SessionRequestConfig.js";

const props = defineProps({
  session: { type: Object, required: true },
  sessionsApiPath: { type: String, required: true },
  refresh: Function,
  // Session actions lists the pin when the header has no room for it.
  listItem: Boolean
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
const command = useCommand({
  access: "never", apiSuffix: VIBE64_SESSIONS_API_SUFFIX, placementSource: "vibe64.sessions.pin",
  buildRawPayload: () => ({ pinned: !pinned.value }),
  buildCommandOptions: () => ({ method: "PATCH", path }),
  fallbackRunError: "The session pin could not be changed.", suppressSuccessMessage: true,
  ownershipFilter: ROUTE_VISIBILITY_PUBLIC, surfaceId: VIBE64_SURFACE_ID, writeMethod: "PATCH"
});

async function toggle() {
  if (pending.value || anotherPinned.value) return;
  pending.value = true;
  try {
    await command.run();
    await props.refresh?.();
  } catch {
    // useCommand has already shown the failure.
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <v-list-item
    v-if="listItem"
    :prepend-icon="pinned ? mdiPin : mdiPinOutline"
    :title="pinned ? 'Unpin session' : 'Pin session'"
    :subtitle="pinned ? 'Stop using it as the project source' : label"
    :aria-pressed="pinned"
    :aria-busy="pending"
    :disabled="pending || anotherPinned"
    min-height="48"
    @click="toggle"
  />
  <v-btn
    v-else
    class="studio-autopilot__header-action"
    :icon="pinned ? mdiPin : mdiPinOutline"
    :aria-label="label"
    :title="label"
    :aria-pressed="pinned"
    :aria-busy="pending"
    :disabled="pending || anotherPinned"
    variant="text"
    height="var(--session-action-size, 36px)"
    width="var(--session-action-size, 36px)"
    @click="toggle"
  />
</template>
