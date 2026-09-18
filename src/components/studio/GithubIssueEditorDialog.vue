<script setup>
import { computed, ref, watch } from "vue";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { useUiFeedback } from "@jskit-ai/http-web/client/composables/useUiFeedback";
import { mdiClose, mdiLabelOutline, mdiPlus } from "@mdi/js";
import GithubLabelChip from "./GithubLabelChip.vue";

const props = defineProps({
  modelValue: Boolean,
  basePath: { type: String, required: true },
  issue: { type: Object, default: null }
});
const emit = defineEmits(["update:modelValue", "saved"]);
const editing = computed(() => Boolean(props.issue));
const title = ref("");
const body = ref("");
const selectedLabels = ref([]);
const pending = ref(false);
const feedback = useUiFeedback({ source: "vibe64.issues.editor" });
const labelsPath = computed(() => props.basePath.replace(/\/issues$/u, "/issue-labels"));
const catalog = useEndpointResource({
  path: labelsPath,
  queryKey: computed(() => ["vibe64.issueLabels", labelsPath.value]),
  enabled: computed(() => props.modelValue),
  queryOptions: { retry: false },
  fallbackLoadError: "Labels could not load."
});
const labels = computed(() => catalog.data.value?.labels || []);
const canSetLabels = computed(() => {
  const permission = editing.value ? "canEditLabels" : "canCreateWithLabels";
  return catalog.data.value?.[permission] === true;
});
const path = computed(() => editing.value ? `${props.basePath}/${props.issue.number}/labels` : props.basePath);
const resource = useEndpointResource({
  path,
  queryKey: computed(() => ["vibe64.issueEditor", path.value]),
  enabled: false
});
const canSubmit = computed(() => {
  if (pending.value || selectedLabels.value.length > 100) return false;
  return editing.value ? canSetLabels.value : Boolean(title.value.trim());
});

watch(() => props.modelValue, (open) => {
  if (!open) return;
  title.value = "";
  body.value = "";
  selectedLabels.value = props.issue?.labels?.nodes?.map((label) => label.name) || [];
}, { immediate: true });

async function submit() {
  if (!canSubmit.value) return;
  const wasEditing = editing.value;
  const requestBasePath = props.basePath;
  pending.value = true;
  try {
    const payload = wasEditing ? { labels: selectedLabels.value } : {
      title: title.value.trim(), body: body.value, labels: selectedLabels.value
    };
    const result = await resource.save(payload, { method: wasEditing ? "PUT" : "POST" });
    feedback.success(wasEditing ? "Labels updated." : "Issue created.");
    emit("saved", { number: result.issue.number, basePath: requestBasePath });
    emit("update:modelValue", false);
  } catch (error) {
    feedback.error(error, wasEditing
      ? "Labels could not be updated. Your selection has been kept."
      : "Issue creation could not be confirmed. Refresh the issue list before trying again.");
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <v-dialog :model-value="modelValue" max-width="42rem" scrollable :persistent="pending" @update:model-value="emit('update:modelValue', $event)">
    <v-card tag="form" rounded="xl" @submit.prevent="submit">
      <div class="d-flex align-center justify-space-between ga-3 pa-5 pb-2">
        <div class="d-flex align-center ga-3">
          <v-icon :icon="editing ? mdiLabelOutline : mdiPlus" color="primary" />
          <h2 class="text-title-large">{{ editing ? 'Edit labels' : 'New issue' }}</h2>
        </div>
        <v-btn :icon="mdiClose" variant="text" size="48" aria-label="Close issue dialog" :disabled="pending" @click="emit('update:modelValue', false)" />
      </div>
      <v-card-text class="d-flex flex-column ga-4">
        <p v-if="editing" class="text-body-medium ma-0">#{{ issue.number }} · {{ issue.title }}</p>
        <template v-else>
          <v-text-field v-model="title" label="Title" variant="outlined" maxlength="256" :disabled="pending" hide-details autofocus />
          <v-textarea
            v-model="body" label="Description" placeholder="What needs to happen?" variant="outlined" rows="5"
            auto-grow maxlength="65536" hint="Markdown supported" persistent-hint :disabled="pending"
          />
        </template>
        <v-skeleton-loader v-if="catalog.isInitialLoading.value" type="list-item-two-line,button" min-height="152" aria-label="Loading labels" aria-busy="true" />
        <v-alert v-else-if="catalog.loadError.value" type="error" variant="tonal" rounded="lg">
          {{ catalog.loadError.value }}
          <template #append><v-btn variant="text" height="48" @click="catalog.reload()">Retry</v-btn></template>
        </v-alert>
        <template v-else>
          <v-autocomplete
            v-model="selectedLabels" :items="labels" item-title="name" item-value="name" multiple chips closable-chips
            label="Labels" variant="outlined" :disabled="pending || !canSetLabels" :menu-props="{ maxHeight: 320 }"
            :error-messages="selectedLabels.length > 100 ? 'Choose up to 100 labels.' : []"
            :hint="canSetLabels ? 'Search and select repository labels.' : editing ? 'Your GitHub account cannot edit labels.' : 'GitHub requires write access to set labels on a new issue.'"
            persistent-hint no-data-text="No matching labels"
          >
            <template #chip="{ props: chipProps, item }"><GithubLabelChip v-bind="chipProps" :label="item" /></template>
            <template #item="{ props: itemProps, item }">
              <v-list-item v-bind="itemProps" min-height="48">
                <template #title><GithubLabelChip :label="item" /></template>
                <template #subtitle>{{ item.description }}</template>
              </v-list-item>
            </template>
          </v-autocomplete>
          <div class="d-flex justify-end"><v-btn variant="text" height="48" :disabled="pending || catalog.isFetching.value" @click="catalog.reload()">Refresh labels</v-btn></div>
        </template>
      </v-card-text>
      <v-card-actions class="pa-5 pt-2">
        <v-spacer />
        <v-btn variant="text" height="48" :disabled="pending" @click="emit('update:modelValue', false)">Cancel</v-btn>
        <v-btn type="submit" color="primary" variant="flat" rounded="pill" height="48" :disabled="!canSubmit" :aria-busy="pending">
          {{ pending ? editing ? 'Saving…' : 'Creating…' : editing ? 'Save labels' : 'Create issue' }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
