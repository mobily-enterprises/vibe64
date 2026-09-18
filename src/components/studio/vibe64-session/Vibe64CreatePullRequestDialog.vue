<script setup>
import { computed, ref, watch } from "vue";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { useUiFeedback } from "@jskit-ai/http-web/client/composables/useUiFeedback";
import { mdiClose, mdiSourcePull } from "@mdi/js";
import { vibe64SessionDisplayTitle, vibe64SessionPullRequest } from "@/lib/vibe64SessionViewModel.js";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";
import { githubProjectRepositoryName } from "@/lib/vibe64GithubProject.js";

const props = defineProps({ modelValue: Boolean, dashboardContext: { type: Object, default: () => ({}) } });
const emit = defineEmits(["update:modelValue", "created"]);
const title = ref("");
const body = ref("");
const draft = ref(true);
const pending = ref(false);
const feedback = useUiFeedback({ source: "vibe64.pullRequests.create" });
const session = computed(() => props.dashboardContext.session || {});
const source = computed(() => vibe64SessionPullRequest(session.value));
const repository = computed(() => githubProjectRepositoryName(props.dashboardContext.projectContext));
const branch = computed(() => source.value?.headBranch || `vibe64/pr-${props.dashboardContext.sessionId}`);
const base = computed(() => source.value?.baseBranch || props.dashboardContext.projectContext?.repository?.defaultBranch || "");
const path = computed(() => `${readRefOrGetterValue(props.dashboardContext.sessionsApiPath)}/${props.dashboardContext.sessionId}/pull-request`);
const resource = useEndpointResource({ path, queryKey: computed(() => ["vibe64.createPullRequest", path.value]), enabled: false });
watch(() => props.dashboardContext.sessionId, () => {
  title.value = source.value?.title || vibe64SessionDisplayTitle(session.value);
  body.value = source.value?.body || "";
  draft.value = true;
}, { immediate: true });
async function submit() {
  if (pending.value || !title.value.trim()) return;
  pending.value = true;
  try {
    const result = await resource.save({ title: title.value.trim(), body: body.value, draft: draft.value }, { method: "POST" });
    feedback.success("Pull request created. Save now updates its source branch.");
    emit("created", result.pullRequest);
    emit("update:modelValue", false);
    void props.dashboardContext.refreshSessionWork?.();
  } catch (error) {
    feedback.error(error, "The pull request could not be confirmed. Retry to check GitHub and continue publishing.");
  } finally { pending.value = false; }
}
</script>

<template>
  <v-dialog :model-value="modelValue" max-width="38rem" scrollable :persistent="pending" @update:model-value="emit('update:modelValue', $event)">
    <v-card rounded="xl">
      <div class="d-flex align-center justify-space-between ga-2 pa-5 pb-2">
        <div class="d-flex align-center ga-3"><v-icon :icon="mdiSourcePull" color="primary" /><h2 class="text-title-large">Create pull request</h2></div>
        <v-btn :icon="mdiClose" size="48" variant="text" aria-label="Close pull request dialog" :disabled="pending" @click="emit('update:modelValue', false)" />
      </div>
      <v-card-text class="d-flex flex-column ga-4">
        <div class="text-body-medium">Publish work from <strong>{{ vibe64SessionDisplayTitle(session) }}</strong>.</div>
        <v-sheet color="surface-light" rounded="lg" class="pa-4 pr-destination">
          <div class="text-label-large">{{ repository }}</div>
          <div class="text-body-medium mt-1">{{ branch }} → {{ base }}</div>
          <p class="text-body-small text-medium-emphasis mt-2 mb-0">Your changes go to a new branch. Future saves update that branch.</p>
        </v-sheet>
        <v-text-field v-model="title" label="Title" variant="outlined" maxlength="256" :disabled="pending" hide-details />
        <v-textarea
          v-model="body" label="Description" placeholder="What changed, and how did you check it?" variant="outlined"
          rows="5" auto-grow maxlength="65536" :disabled="pending" hide-details
        />
        <v-switch v-model="draft" color="primary" label="Create as draft" :disabled="pending" hide-details />
        <p v-if="pending" role="status" class="text-body-medium ma-0">Publishing session work and creating your pull request…</p>
      </v-card-text>
      <v-card-actions class="pa-5 pt-2">
        <v-spacer />
        <v-btn variant="text" height="48" :disabled="pending" @click="emit('update:modelValue', false)">Cancel</v-btn>
        <v-btn
          color="primary" variant="flat" rounded="pill" height="48" :disabled="pending || !title.trim() || dashboardContext.sourceOperationsSuspended"
          :aria-busy="pending" @click="submit"
        >
          {{ pending ? 'Publishing…' : draft ? 'Create draft PR' : 'Create pull request' }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
<style scoped>
.pr-destination { overflow-wrap: anywhere; }
</style>
