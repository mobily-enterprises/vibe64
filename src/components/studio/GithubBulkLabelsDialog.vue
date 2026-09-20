<script setup>
import { computed, ref, watch } from "vue";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { useUiFeedback } from "@jskit-ai/http-web/client/composables/useUiFeedback";
import { useQueryClient } from "@tanstack/vue-query";
import { invalidateGithubIssueQueries } from "@/lib/vibe64GithubProject.js";
import GithubLabelChip from "./GithubLabelChip.vue";

const props = defineProps({
  modelValue: Boolean,
  basePath: { type: String, required: true },
  numbers: { type: Array, required: true },
  labels: { type: Array, required: true }
});
const emit = defineEmits(["update:modelValue", "applied"]);
const labelMode = ref("add");
const selectedLabels = ref([]);
const remaining = ref([]);
const failures = ref([]);
const pending = ref(false);
const progress = ref("");
const feedback = useUiFeedback({ source: "vibe64.issues.bulkLabels" });
const queryClient = useQueryClient();
const resource = useEndpointResource({ path: computed(() => props.basePath), enabled: false });
const canSubmit = computed(() => !pending.value && selectedLabels.value.length > 0 &&
  selectedLabels.value.length <= 100 && remaining.value.length > 0);
watch(() => props.modelValue, (open) => {
  if (!open) return;
  remaining.value = [...props.numbers];
  selectedLabels.value = [];
  labelMode.value = "add";
  failures.value = [];
}, { immediate: true });

async function submit() {
  if (!canSubmit.value) return;
  const requestBasePath = props.basePath;
  const numbers = [...remaining.value];
  const payload = { labels: [...selectedLabels.value], labelMode: labelMode.value };
  failures.value = [];
  pending.value = true;
  for (const [index, number] of numbers.entries()) {
    progress.value = `Updating ${index + 1} of ${numbers.length}…`;
    const issuePath = `${requestBasePath}/${number}`;
    try {
      await resource.save(payload, { path: `${issuePath}/labels`, method: "PUT" });
    } catch (error) {
      feedback.error(error, `Labels could not be updated for #${number}.`);
      failures.value.push({ number, message: feedback.message.value });
      continue;
    }
    remaining.value = remaining.value.filter((value) => value !== number);
    emit("applied", { number, basePath: requestBasePath });
    try {
      await invalidateGithubIssueQueries(queryClient, requestBasePath, issuePath);
    } catch (error) {
      feedback.error(error, `Labels updated for #${number}, but the issue could not refresh.`);
    }
  }
  pending.value = false;
  if (!remaining.value.length) {
    feedback.success(`Labels updated for ${numbers.length} ${numbers.length === 1 ? "issue" : "issues"}.`);
    emit("update:modelValue", false);
  }
}
</script>

<template>
  <v-dialog :model-value="modelValue" max-width="36rem" scrollable :persistent="pending" @update:model-value="emit('update:modelValue', $event)">
    <v-card tag="form" rounded="xl" @submit.prevent="submit">
      <v-card-title class="pa-5 pb-2">Bulk edit labels</v-card-title>
      <v-card-text class="d-flex flex-column ga-4">
        <p class="text-body-medium ma-0">{{ remaining.length }} selected. Other labels will stay unchanged.</p>
        <v-btn-toggle v-model="labelMode" mandatory divided rounded="pill" :disabled="pending" aria-label="Label action">
          <v-btn value="add" height="48">Add labels</v-btn>
          <v-btn value="remove" height="48">Remove labels</v-btn>
        </v-btn-toggle>
        <v-autocomplete
          v-model="selectedLabels" :items="labels" item-title="name" item-value="name" multiple chips closable-chips
          label="Labels to change" variant="outlined" :disabled="pending" :menu-props="{ maxHeight: 320 }"
          :error-messages="selectedLabels.length > 100 ? 'Choose up to 100 labels.' : []" no-data-text="No matching labels"
        >
          <template #chip="{ props: chipProps, item }"><GithubLabelChip v-bind="chipProps" :label="item" /></template>
          <template #item="{ props: itemProps, item }">
            <v-list-item v-bind="itemProps" min-height="48">
              <template #title><GithubLabelChip :label="item" /></template>
            </v-list-item>
          </template>
        </v-autocomplete>
        <div v-if="failures.length" role="status">
          <p class="text-body-medium">Some issues could not be updated. Retry applies only to these issues:</p>
          <p v-for="failure in failures" :key="failure.number" class="text-body-small text-error">#{{ failure.number }}: {{ failure.message }}</p>
        </div>
      </v-card-text>
      <v-card-actions class="pa-5 pt-2 d-flex flex-wrap">
        <v-spacer />
        <v-btn variant="text" height="48" :disabled="pending" @click="emit('update:modelValue', false)">Cancel</v-btn>
        <v-btn type="submit" color="primary" variant="flat" height="48" :disabled="!canSubmit">
          {{ pending ? progress : failures.length ? 'Retry failed issues' : 'Apply labels' }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
