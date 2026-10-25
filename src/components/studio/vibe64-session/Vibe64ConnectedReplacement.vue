<script setup>
import { computed, ref, watch } from "vue";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { scopedDevelopmentApiUrl } from "@/lib/studioUrls.js";
import { vibe64ApiError } from "@/lib/vibe64ApiResponses.js";
import { projectAppPath } from "@/lib/vibe64ProjectScope.js";
import { VIBE64_SESSIONS_API_SUFFIX, vibe64SessionPath } from "@/lib/vibe64SessionRequestConfig.js";

const props = defineProps({
  projectSlug: { type: String, required: true },
  sessionId: { type: String, required: true },
  failure: { type: Object, default: null },
  disabled: { type: Boolean, default: false }
});
const emit = defineEmits(["replaced"]);
const pending = ref(false);
const review = ref(null);
const error = ref("");
const replacement = ref(null);
const available = computed(() => ["vibe64_contribution_discarded", "vibe64_connected_integration_discarded"]
  .includes(props.failure?.code) && Boolean(props.failure?.details?.repository));
const endpoint = computed(() => scopedDevelopmentApiUrl(
  vibe64SessionPath(`/api${VIBE64_SESSIONS_API_SUFFIX}`, props.sessionId, "/connected/replacement"), props.projectSlug));
watch(() => [props.projectSlug, props.sessionId], () => {
  review.value = null;
  error.value = "";
  replacement.value = null;
});
watch(() => props.failure?.details?.repository, () => {
  review.value = null;
  error.value = "";
});

async function inspect() {
  if (pending.value || props.disabled || !available.value) return;
  const path = endpoint.value;
  const repository = props.failure.details.repository;
  pending.value = true;
  error.value = "";
  try {
    const result = await getHttpWebClient().request(`${path}?repository=${encodeURIComponent(repository)}`, { method: "GET" });
    if (result?.ok !== true) throw vibe64ApiError(result, "The discarded contribution could not be reviewed.");
    if (path === endpoint.value && repository === props.failure?.details?.repository) {
      review.value = result.contributions?.[0]?.review || null;
    }
  } catch (cause) {
    if (path === endpoint.value) error.value = cause.message;
  } finally { pending.value = false; }
}

async function replace() {
  if (pending.value || props.disabled || !review.value) return;
  const path = endpoint.value;
  const reviewed = { ...review.value };
  pending.value = true;
  error.value = "";
  try {
    const result = await getHttpWebClient().request(path, { method: "POST",
      body: { repository: reviewed.repository, review: reviewed } });
    if (result?.ok !== true) throw vibe64ApiError(result, "Replacement preparation failed. Retry this same review.");
    if (path === endpoint.value) {
      replacement.value = result.prepared?.find(item => item.repository === reviewed.repository) || null;
      review.value = null;
      emit("replaced");
    }
  } catch (cause) {
    // Keep the review: allocation may have succeeded before acknowledgement.
    // The server retries its reserved identity rather than creating another.
    if (path === endpoint.value) error.value = cause.message;
  } finally { pending.value = false; }
}
</script>

<template>
  <div v-if="available || replacement" class="d-flex flex-column ga-2" style="overflow-wrap: anywhere">
    <template v-if="replacement">
      <p class="ma-0" role="status">Replacement prepared. Revise its source, then run Prepare workspace in this project before testing. Save connected first pushes it for review; Main Save still waits for acceptance.</p>
      <v-btn variant="tonal" min-height="48" :href="`${projectAppPath(replacement.projectSlug, '/')}?session=${encodeURIComponent(replacement.sessionId)}`">
        Open replacement session
      </v-btn>
    </template>
    <v-btn v-else variant="tonal" min-height="48" height="auto" :disabled="disabled || pending" @click="inspect">
      <span class="text-wrap">Review replacement contribution</span>
    </v-btn>
    <p v-if="error && !review" class="ma-0 text-error" role="alert">{{ error }}</p>
    <v-dialog :model-value="Boolean(review)" :persistent="pending" max-width="560" scrollable
      @update:model-value="!$event && !pending && (review = null)">
      <v-card v-if="review">
        <v-card-title class="text-wrap">Create replacement contribution?</v-card-title>
        <v-card-text style="overflow-wrap: anywhere">
          <p>{{ review.repository }} → {{ review.targetBranch }}</p>
          <p>Start a new contribution from discarded commit <code>{{ review.discardedHead }}</code>.</p>
          <p>The old branch and checkout remain intact. Unsaved edits stay in the old checkout; copy any edits you need into the replacement.</p>
          <p>This prepares source only. Nothing is pushed, and Main Save still requires the contribution to be accepted.</p>
          <p v-if="error" class="text-error" role="alert">{{ error }}</p>
        </v-card-text>
        <v-card-actions class="flex-wrap ga-2">
          <v-btn variant="text" min-height="48" :disabled="pending" @click="review = null">Cancel</v-btn>
          <v-btn color="primary" variant="flat" min-height="48" :disabled="disabled || pending" @click="replace">
            <span class="text-wrap">{{ pending ? 'Preparing…' : 'Create replacement contribution' }}</span>
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>
