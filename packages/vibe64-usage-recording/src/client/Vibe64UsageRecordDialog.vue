<script setup>
import { computed, reactive, ref, watch } from "vue";
import { useDisplay } from "vuetify";
import { useVibe64UsageRecording } from "./useVibe64UsageRecording.js";

// The "Record what runs" dialog. v-model opens it; started { recording } is
// emitted after a successful start, and select-preview when the person chooses
// "Go to Preview" afterwards. Keep it mounted: its snackbar outlives the dialog.
const props = defineProps({
  modelValue: { type: Boolean, default: false },
  sessionId: { type: String, required: true }
});
const emit = defineEmits(["update:modelValue", "started", "select-preview"]);

const PARAMETER_MAX_LENGTH = 4096;
const { width: viewportWidth } = useDisplay();
const fullscreen = computed(() => viewportWidth.value <= 600);
const { error, readTargets, start } = useVibe64UsageRecording({ sessionId: () => props.sessionId });

const targets = ref([]);
const targetsLoading = ref(false);
const selectedId = ref("");
const values = reactive({});
const submitted = ref(false);
const starting = ref(false);
const notice = reactive({ open: false, text: "", preview: false });

watch(() => props.modelValue, async (open) => {
  if (!open) return;
  submitted.value = false;
  targetsLoading.value = true;
  const result = await readTargets();
  targetsLoading.value = false;
  targets.value = result?.targets || [];
  if (!targets.value.some((target) => target.id === selectedId.value && target.available)) {
    selectedId.value = targets.value.find((target) => target.available)?.id || "";
  }
}, { immediate: true });

const selectedTarget = computed(() => targets.value.find((target) => target.id === selectedId.value) || null);
const valueKey = (target, parameter) => `${target.id}/${parameter.id}`;

function targetLabel(target) {
  return target.kind === "web" ? "Preview (restarts Preview)" : `Run ${target.label}`;
}

function parameterProblem(parameter, value = "") {
  const text = String(value ?? "");
  if (parameter.required && !text.trim()) return `${parameter.label} is required.`;
  if (/[\r\n]/u.test(text)) return `${parameter.label} must be a single line.`;
  if (text.length > PARAMETER_MAX_LENGTH) return `${parameter.label} must be at most 4,096 characters.`;
  return "";
}

// Required fields complain once the person tries to start; other problems as they type.
function fieldError(target, parameter) {
  const value = values[valueKey(target, parameter)] || "";
  return submitted.value || value ? parameterProblem(parameter, value) : "";
}

const selectedProblems = computed(() => (selectedTarget.value?.parameters || [])
  .map((parameter) => parameterProblem(parameter, values[valueKey(selectedTarget.value, parameter)]))
  .filter(Boolean));

function close() {
  emit("update:modelValue", false);
}

async function startRecording() {
  submitted.value = true;
  const target = selectedTarget.value;
  if (!target?.available || selectedProblems.value.length || starting.value) return;
  const entries = (target.parameters || [])
    .map((parameter) => [parameter.id, values[valueKey(target, parameter)] || ""])
    .filter(([, value]) => value);
  starting.value = true;
  const recording = await start({ targetId: target.id, parameters: entries.length ? Object.fromEntries(entries) : undefined });
  starting.value = false;
  if (!recording) return;
  emit("started", { recording });
  close();
  Object.assign(notice, target.kind === "web"
    ? { open: true, text: "Recording — use Preview now", preview: true }
    : { open: true, text: `Recording — ${target.label} is running`, preview: false });
}

function goToPreview() {
  notice.open = false;
  emit("select-preview");
}
</script>

<template>
  <v-dialog
    :fullscreen="fullscreen"
    max-width="560"
    :model-value="modelValue"
    scrollable
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card class="usage-record-dialog" :rounded="fullscreen ? 0 : 'xl'">
      <v-card-title class="usage-record-dialog__title">Record what runs</v-card-title>
      <v-card-text class="usage-record-dialog__body">
        <p>
          Use your app while recording. Vibe64 saves which functions ran for each request — never request contents,
          headers or data.
        </p>
        <v-progress-linear v-if="targetsLoading" indeterminate />
        <v-radio-group v-else v-model="selectedId" class="usage-record-dialog__targets" hide-details>
          <div v-for="target in targets" :key="target.id" class="usage-record-dialog__target">
            <v-radio :disabled="!target.available" :label="targetLabel(target)" :value="target.id" />
            <p v-if="!target.available" class="usage-record-dialog__reason">{{ target.reason }}</p>
            <template v-if="target.available && target.id === selectedId">
              <v-text-field
                v-for="parameter in target.parameters || []"
                :key="parameter.id"
                v-model="values[valueKey(target, parameter)]"
                class="usage-record-dialog__parameter"
                density="comfortable"
                :error-messages="fieldError(target, parameter)"
                :label="parameter.required ? `${parameter.label} (required)` : parameter.label"
                variant="outlined"
              />
            </template>
          </div>
        </v-radio-group>
        <v-alert v-if="error && !targetsLoading" density="compact" type="error" variant="tonal">{{ error }}</v-alert>
        <p class="usage-record-dialog__footnote">Stops automatically after 10 minutes or 2,000 requests.</p>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="close">Cancel</v-btn>
        <v-btn
          color="primary"
          :disabled="!selectedTarget?.available"
          :loading="starting"
          variant="flat"
          @click="startRecording"
        >
          Start recording
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
  <v-snackbar v-model="notice.open" location="bottom center" :timeout="6000">
    {{ notice.text }}
    <template #actions>
      <v-btn v-if="notice.preview" variant="text" @click="goToPreview">Go to Preview</v-btn>
    </template>
  </v-snackbar>
</template>

<style scoped>
.usage-record-dialog__title {
  font: var(--v64-type-headline-sm);
}

.usage-record-dialog__body {
  display: grid;
  gap: var(--v64-space-4);
}

.usage-record-dialog__target {
  display: grid;
  gap: var(--v64-space-1);
}

.usage-record-dialog__reason,
.usage-record-dialog__footnote {
  color: var(--v64-on-surface-variant);
  font: var(--v64-type-body-md);
}

.usage-record-dialog__reason {
  padding-inline-start: 40px;
}

.usage-record-dialog__parameter {
  margin-inline-start: 40px;
}
</style>
