<template>
  <v-dialog
    :model-value="modelValue"
    max-width="640"
    scrollable
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card class="vibe64-add-service">
      <v-card-title class="text-title-large">{{ title }}</v-card-title>

      <v-card-text v-if="noSessions" class="vibe64-add-service__body">
        <p class="text-body-medium">Open a session first: Add a service changes that session's genesis/stack.md.</p>
      </v-card-text>

      <v-card-text v-else class="vibe64-add-service__body">
        <SelectField
          v-model="chosenSessionId"
          density="comfortable"
          hide-details
          item-title="label"
          item-value="sessionId"
          :items="sessions"
          :loading="false"
          label="Adds it in session"
          variant="outlined"
        />

        <v-skeleton-loader v-if="loading && rows.length === 0" type="list-item-two-line@4" />

        <v-alert
          v-else-if="loadError"
          density="compact"
          type="warning"
          variant="tonal"
        >
          {{ loadError }}
        </v-alert>

        <v-radio-group
          v-else
          v-model="selectedKind"
          aria-label="Service to add"
          :disabled="adding"
          hide-details
        >
          <div
            v-for="row in rows"
            :key="row.kind"
            class="vibe64-add-service__row"
          >
            <v-radio
              :aria-describedby="row.reason ? `add-service-reason-${row.kind}` : undefined"
              :disabled="row.disabled"
              :label="row.label"
              :value="row.kind"
            />
            <dl class="vibe64-add-service__facts text-body-small">
              <dt>The app gets</dt>
              <dd>{{ row.appGets }}</dd>
              <dt>Preview</dt>
              <dd>
                <slot name="preview" :choice="row">{{ row.previewGets }}</slot>
              </dd>
              <template v-if="$slots.price">
                <dt>Production</dt>
                <dd><slot name="price" :choice="row" /></dd>
              </template>
            </dl>
            <p
              v-if="row.reason"
              :id="`add-service-reason-${row.kind}`"
              class="vibe64-add-service__reason text-body-small"
            >
              {{ row.reason }}
            </p>
            <p v-else-if="row.note || row.caveat" class="vibe64-add-service__note text-body-small">
              <slot name="note" :choice="row">{{ [row.note, row.caveat].filter(Boolean).join(". ") }}</slot>
            </p>
            <div
              v-if="row.kind === 'service' && selectedKind === 'service'"
              class="vibe64-add-service__service"
            >
              <v-text-field
                v-model="serviceName"
                density="comfortable"
                :error-messages="serviceNameError ? [serviceNameError] : []"
                hint="For example: worker"
                label="Service name"
                persistent-hint
                variant="outlined"
              />
              <SelectField
                v-model="reachedBy"
                density="comfortable"
                hide-details
                :items="reachedByItems"
                :loading="loading"
                label="Reached by"
                variant="outlined"
              />
            </div>
          </div>
        </v-radio-group>

        <p v-if="resultMessage" class="text-body-medium" role="status">{{ resultMessage }}</p>
        <v-alert
          v-if="addError"
          density="compact"
          type="error"
          variant="tonal"
        >
          {{ addError }}
        </v-alert>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="emit('update:modelValue', false)">Close</v-btn>
        <v-btn
          v-if="noSessions"
          color="primary"
          variant="flat"
          @click="openSession"
        >
          Open a session
        </v-btn>
        <v-btn
          v-else
          color="primary"
          :disabled="!canAdd && !adding"
          variant="flat"
          @click="submit"
        >
          {{ addLabel }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup>
// Add a service: the person picks a session and a kind; Add writes the
// session's genesis/stack.md through Genesis, then starts the add-service AI
// task there. A host fills the price slot (and may replace what Preview gets).
import { computed, ref, watch } from "vue";
import SelectField from "@jskit-ai/http-web/client/components/SelectField";
import { KIND_LABELS, serviceNameRefusal, stackServiceRows, useVibe64StackServices } from "@/composables/useVibe64StackServices.js";

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  projectSlug: { type: String, required: true },
  projectName: { type: String, default: "" },
  // The person's open sessions, `{ sessionId, label }`, and the one to start with (the one they last used).
  sessions: { type: Array, default: () => [] },
  sessionId: { type: String, default: "" },
  // A host's own reasons a kind can't be added there, by kind.
  refusals: { type: Object, default: () => ({}) },
  // Tests and hosts replace the project-scoped request; a host with the session's AI task window open passes
  // startTask(sessionId, { kind, input }) to start the task there. Slots, each given the row as `choice`: `price`
  // (the Production line, shown only when filled), `preview` (what Preview gets) and `note`.
  request: { type: Function, default: null },
  startTask: { type: Function, default: null }
});
const emit = defineEmits(["update:modelValue", "added", "open-session"]);

const stack = useVibe64StackServices({ projectSlug: () => props.projectSlug, request: props.request || undefined });
const { answer, loading, loadError } = stack;
const chosenSessionId = ref(props.sessionId || props.sessions[0]?.sessionId || "");
const selectedKind = ref("");
const serviceName = ref("");
const reachedBy = ref("");
const adding = ref(false);
const addError = ref("");
const resultMessage = ref("");

const noSessions = computed(() => props.sessions.length === 0);
const title = computed(() => (props.projectName ? `Add a service to ${props.projectName}` : "Add a service"));
const rows = computed(() => stackServiceRows(answer.value, props.refusals));
const selectedRow = computed(() => rows.value.find((row) => row.kind === selectedKind.value) || null);
const services = computed(() => rows.value.find((row) => row.kind === "service")?.services || []);
const reachedByItems = computed(() => [
  ...services.value.map(({ id }) => ({ title: id, value: id })),
  { title: "Nothing: it works on its own", value: "" }
]);
const serviceNameError = computed(() => serviceNameRefusal(serviceName.value, services.value));
const canAdd = computed(() => Boolean(selectedRow.value) && !selectedRow.value.disabled && !adding.value &&
  (selectedKind.value !== "service" || (Boolean(serviceName.value) && !serviceNameError.value)));
const addLabel = computed(() => {
  const label = selectedRow.value?.label;
  if (adding.value) return `Adding ${label}…`;
  return label ? `Add ${label}` : "Add";
});

function sessionLabel(sessionId) {
  return props.sessions.find((session) => session.sessionId === sessionId)?.label || sessionId;
}

async function load() {
  if (!props.modelValue || !chosenSessionId.value) return;
  const read = await stack.load(chosenSessionId.value);
  // The service that reaches a new one is the public one, until the person chooses.
  const choice = read?.choices?.find((entry) => entry.kind === "service");
  if (!reachedBy.value) reachedBy.value = choice?.services?.find(({ exposure }) => exposure === "public")?.id || "";
}

watch(() => [props.modelValue, chosenSessionId.value], () => {
  resultMessage.value = "";
  addError.value = "";
  void load();
}, { immediate: true });

function openSession() {
  emit("open-session");
}

function addedMessage(answered, sessionId) {
  const where = sessionLabel(sessionId);
  if (answered.added) {
    return `Added \`${answered.added.id}\` (${answered.added.kind}) to genesis/stack.md in ${where}. Next: the AI connects your app to it.`;
  }
  const what = selectedKind.value === "service" ? serviceName.value : KIND_LABELS[selectedKind.value];
  return `The AI declares ${what} in genesis/stack.md in ${where}, then connects your app to it.`;
}

async function submit() {
  if (!canAdd.value) return;
  const sessionId = chosenSessionId.value;
  const body = selectedKind.value === "service"
    ? { kind: "service", serviceId: serviceName.value, reachedBy: reachedBy.value }
    : { kind: selectedKind.value };
  adding.value = true;
  addError.value = "";
  resultMessage.value = "";
  try {
    const answered = await stack.add(sessionId, body);
    resultMessage.value = addedMessage(answered, sessionId);
    let task = null;
    try {
      task = await (props.startTask || stack.startTask)(sessionId, answered.aiTask);
    } catch (error) {
      addError.value = `The AI task could not start: ${error?.message || "it was refused"}. Start it again from the session.`;
    }
    emit("added", { sessionId, added: answered.added, needsAi: answered.needsAi, task });
    // The rows now show what the Stack has.
    if (chosenSessionId.value === sessionId) await stack.load(sessionId);
  } catch (error) {
    addError.value = error?.message || "The service could not be added.";
  } finally {
    adding.value = false;
  }
}
</script>

<style scoped>
.vibe64-add-service__body {
  display: grid;
  gap: 1rem;
}

.vibe64-add-service__row {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  padding: 0.5rem 0;
}

.vibe64-add-service__facts {
  display: grid;
  gap: 0.125rem 0.75rem;
  grid-template-columns: max-content 1fr;
  margin: 0 0 0 2.5rem;
}

.vibe64-add-service__facts dt {
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}

.vibe64-add-service__facts dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.vibe64-add-service__reason,
.vibe64-add-service__note {
  margin: 0.25rem 0 0 2.5rem;
}

.vibe64-add-service__service {
  display: grid;
  gap: 0.75rem;
  margin: 0.75rem 0 0 2.5rem;
}
</style>
