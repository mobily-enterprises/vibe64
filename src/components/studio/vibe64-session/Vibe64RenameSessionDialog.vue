<script setup>
import { computed, ref } from "vue";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { useUiFeedback } from "@jskit-ai/http-web/client/composables/useUiFeedback";
import { vibe64SessionPath } from "@/lib/vibe64SessionRequestConfig.js";

const props = defineProps({
  session: { type: Object, required: true },
  sessionsApiPath: { type: String, required: true }
});
const emit = defineEmits(["close", "renamed"]);
const name = ref(props.session.sessionName || "");
const pending = ref(false);
// Capture the selected session and project for the lifetime of this dialog.
const path = vibe64SessionPath(props.sessionsApiPath, props.session.sessionId, "/name");
const resource = useEndpointResource({ path, queryKey: ["vibe64.renameSession", path], enabled: false });
const feedback = useUiFeedback({ source: "vibe64.sessions.rename" });
const normalizedName = computed(() => name.value.trim());
const canSave = computed(() => Boolean(normalizedName.value) && normalizedName.value !== props.session.sessionName && !pending.value);

async function submit() {
  if (!canSave.value) return;
  pending.value = true;
  try {
    await resource.save({ name: normalizedName.value }, { method: "PATCH" });
    emit("renamed");
    emit("close");
  } catch (error) {
    feedback.error(error, "The session could not be renamed.");
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
