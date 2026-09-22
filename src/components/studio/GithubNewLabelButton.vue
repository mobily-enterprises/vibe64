<script setup>
import { computed, ref, watch } from "vue";
import { useQueryClient } from "@tanstack/vue-query";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { useUiFeedback } from "@jskit-ai/http-web/client/composables/useUiFeedback";
import { mdiCheck, mdiClose, mdiPlus } from "@mdi/js";
import GithubLabelChip from "./GithubLabelChip.vue";

const props = defineProps({
  basePath: { type: String, required: true },
  labels: { type: Array, required: true },
  disabled: Boolean
});
const emit = defineEmits(["created"]);
const defaultColor = "0075ca";
const palette = [
  { name: "Red", color: "d73a4a" }, { name: "Orange", color: "e9963a" },
  { name: "Yellow", color: "f9d65c" }, { name: "Green", color: "4c956c" },
  { name: "Teal", color: "008672" }, { name: "Blue", color: "0075ca" },
  { name: "Purple", color: "8957e5" }, { name: "Pink", color: "db61a2" }
];
const open = ref(false);
const name = ref("");
const color = ref(defaultColor);
const pending = ref(false);
const trimmedName = computed(() => name.value.trim());
const normalizedColor = computed(() => color.value.trim().replace(/^#/u, "").toLowerCase());
const validColor = computed(() => /^[a-f\d]{6}$/u.test(normalizedColor.value));
const nameError = computed(() => {
  if (/\p{Cc}/u.test(name.value) || trimmedName.value.length > 50) return "Use up to 50 characters, on one line.";
  return props.labels.some((label) => label.name.toLowerCase() === trimmedName.value.toLowerCase())
    ? "A label with this name already exists." : "";
});
const preview = computed(() => ({
  name: trimmedName.value || "Your label",
  color: validColor.value ? normalizedColor.value : defaultColor
}));
const canSubmit = computed(() => !props.disabled && !pending.value && Boolean(trimmedName.value) && !nameError.value && validColor.value);
const labelsPath = computed(() => props.basePath.replace(/\/issues$/u, "/issue-labels"));
const resource = useEndpointResource({ path: labelsPath, enabled: false,
  queryKey: computed(() => ["vibe64.newLabel", labelsPath.value]) });
const queryClient = useQueryClient();
const feedback = useUiFeedback({ source: "vibe64.issues.newLabel" });

watch(open, (value) => {
  if (!value) return;
  name.value = "";
  color.value = defaultColor;
});
watch(() => props.basePath, () => { open.value = false; });

async function submit() {
  if (!canSubmit.value) return;
  const requestPath = labelsPath.value;
  pending.value = true;
  let result;
  try {
    result = await resource.save({ name: trimmedName.value, color: normalizedColor.value }, { path: requestPath, method: "POST" });
  } catch (error) {
    feedback.error(error, "Label could not be created. Your choices have been kept.");
    pending.value = false;
    return;
  }
  const queryKey = ["vibe64.issueLabels", requestPath];
  await queryClient.cancelQueries({ queryKey });
  queryClient.setQueryData(queryKey, (catalog) => {
    if (!catalog) return catalog;
    const createdName = result.label.name.toLowerCase();
    const labels = catalog.labels.filter((label) => label.name.toLowerCase() !== createdName);
    labels.push(result.label);
    labels.sort((a, b) => a.name.localeCompare(b.name));
    return { ...catalog, labels };
  });
  feedback.success("Label created.");
  if (requestPath === labelsPath.value) {
    open.value = false;
    emit("created", result.label);
  }
  pending.value = false;
}
</script>

<template>
  <v-btn :prepend-icon="mdiPlus" color="primary" variant="text" height="48" :disabled="disabled || pending" @click="open = true">New label</v-btn>
  <v-dialog v-model="open" max-width="30rem" scrollable :persistent="pending" aria-label="New label">
    <v-card tag="form" rounded="xl" @submit.prevent.stop="submit">
      <div class="d-flex align-center justify-space-between ga-3 pa-5 pb-2">
        <h2 class="text-title-large">New label</h2>
        <v-btn :icon="mdiClose" variant="text" size="48" aria-label="Close new label" :disabled="pending" @click="open = false" />
      </div>
      <v-card-text class="d-flex flex-column ga-4">
        <v-sheet color="surface-light" rounded="lg" class="pa-4 d-flex flex-column align-center ga-2">
          <span class="text-label-small text-medium-emphasis">Preview</span>
          <GithubLabelChip :label="preview" class="new-label__preview" />
        </v-sheet>
        <v-text-field
          v-model="name" label="Label name" placeholder="e.g. Ready for review" variant="outlined"
          maxlength="50" autofocus :disabled="pending" :error-messages="nameError" hide-details="auto"
        />
        <fieldset class="new-label__colours">
          <legend class="text-label-large mb-2">Colour</legend>
          <div class="new-label__palette">
            <v-btn
              v-for="swatch in palette" :key="swatch.color" :color="`#${swatch.color}`" variant="flat" icon size="48"
              :aria-label="swatch.name" :aria-pressed="normalizedColor === swatch.color" :disabled="pending"
              @click="color = swatch.color"
            >
              <v-icon v-if="normalizedColor === swatch.color" :icon="mdiCheck" />
            </v-btn>
          </div>
        </fieldset>
        <div class="d-flex align-start ga-3">
          <input
            type="color" :value="`#${preview.color}`" class="new-label__custom" aria-label="Custom colour" title="Choose a custom colour"
            :disabled="pending" @input="color = $event.target.value.slice(1)"
          >
          <v-text-field
            v-model="color" label="Hex colour" prefix="#" variant="outlined" density="compact" maxlength="7"
            :disabled="pending" :error-messages="validColor ? [] : 'Use six characters: 0–9 or A–F.'" hide-details="auto"
            autocomplete="off" spellcheck="false"
          />
        </div>
        <p class="text-body-small text-medium-emphasis ma-0">Available to all issues in this repository.</p>
      </v-card-text>
      <v-card-actions class="pa-5 pt-2">
        <v-spacer />
        <v-btn variant="text" height="48" :disabled="pending" @click="open = false">Cancel</v-btn>
        <v-btn type="submit" color="primary" variant="flat" rounded="pill" height="48" :disabled="!canSubmit" :aria-busy="pending">
          {{ pending ? 'Creating…' : 'Create label' }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.new-label__colours { border: 0; padding: 0; min-width: 0; }
.new-label__palette { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; justify-items: center; }
.new-label__preview { max-width: 100%; }
.new-label__custom {
  width: 48px;
  height: 48px;
  flex: 0 0 48px;
  padding: 4px;
  border: 1px solid rgb(var(--v-theme-on-surface), 0.38);
  border-radius: 8px;
  background: rgb(var(--v-theme-surface));
  cursor: pointer;
}
</style>
