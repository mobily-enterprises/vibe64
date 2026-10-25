<script setup>
import { computed, ref } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { VIBE64_SESSIONS_API_SUFFIX, VIBE64_SURFACE_ID, vibe64SessionPath } from "@/lib/vibe64SessionRequestConfig.js";

const props = defineProps({
  session: { type: Object, required: true },
  sessionsApiPath: { type: String, required: true }
});
const emit = defineEmits(["close", "renamed"]);
const name = ref(props.session.sessionName || "");
const pending = ref(false);
// Capture the selected session and project for the lifetime of this dialog.
const path = vibe64SessionPath(props.sessionsApiPath, props.session.sessionId, "/name");
const command = useCommand({
  access: "never", apiSuffix: VIBE64_SESSIONS_API_SUFFIX, placementSource: "vibe64.sessions.rename",
  buildRawPayload: () => ({ name: normalizedName.value }),
  buildCommandOptions: () => ({ method: "PATCH", path }),
  fallbackRunError: "The session could not be renamed.", suppressSuccessMessage: true,
  ownershipFilter: ROUTE_VISIBILITY_PUBLIC, surfaceId: VIBE64_SURFACE_ID, writeMethod: "PATCH"
});
const normalizedName = computed(() => name.value.trim());
const canSave = computed(() => Boolean(normalizedName.value) && normalizedName.value !== props.session.sessionName && !pending.value);

async function submit() {
  if (!canSave.value) return;
  pending.value = true;
  try {
    await command.run();
    emit("renamed");
    emit("close");
  } catch {
    // useCommand has already shown the failure.
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <v-dialog
    aria-label="Rename session"
    :model-value="true"
    max-width="28rem"
    :persistent="pending"
    @update:model-value="!$event && emit('close')"
  >
    <v-card rounded="xl">
      <form @submit.prevent="submit">
        <v-card-title class="pa-6 pb-2">
          <h2 class="text-title-large">Rename session</h2>
        </v-card-title>
        <v-card-text class="px-6">
          <v-text-field
            v-model="name"
            label="Session name"
            variant="outlined"
            maxlength="120"
            autofocus
            :disabled="pending"
            hide-details
          />
        </v-card-text>
        <v-card-actions class="pa-6 pt-2">
          <v-spacer />
          <v-btn height="48" variant="text" :disabled="pending" @click="emit('close')">Cancel</v-btn>
          <v-btn
            type="submit"
            height="48"
            color="primary"
            variant="flat"
            rounded="pill"
            :disabled="!canSave"
            :loading="pending"
          >
            Rename
          </v-btn>
        </v-card-actions>
      </form>
    </v-card>
  </v-dialog>
</template>
