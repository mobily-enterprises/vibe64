<template>
  <v-sheet class="project-config-setup">
    <div
      v-if="setupSummary"
      class="project-config-setup__summary"
    >
      <v-btn
        v-if="canChangeProjectType"
        class="project-config-setup__summary-change"
        color="primary"
        :prepend-icon="mdiArrowLeft"
        size="large"
        variant="outlined"
        @click="emit('change-project-type')"
      >
        Change app type
      </v-btn>
      <div class="project-config-setup__summary-copy">
        <p class="project-config-setup__summary-kicker">Setup</p>
        <p class="project-config-setup__summary-text">{{ setupSummary }}</p>
      </div>
    </div>

    <div class="project-config-setup__sections">
      <section
        v-for="section in sections"
        :key="section.id"
        class="project-config-setup__section"
      >
        <h3 class="project-config-setup__section-title">{{ section.label }}</h3>
        <div class="project-config-setup__fields">
          <div
            v-for="field in section.fields"
            :key="field.id"
            class="project-config-setup__field"
          >
            <div class="project-config-setup__field-copy">
              <h4>{{ field.label }}</h4>
              <p>{{ fieldDescription(field) }}</p>
              <span class="project-config-setup__field-id">{{ field.id }}</span>
            </div>

            <div class="project-config-setup__field-control">
              <v-switch
                v-if="field.type === 'boolean'"
                v-model="formValues[field.id]"
                color="primary"
                density="compact"
                hide-details="auto"
                :error-messages="fieldErrorMessages(field)"
                :label="booleanChoiceLabel(field)"
              />
              <v-select
                v-else-if="field.type === 'select'"
                v-model="formValues[field.id]"
                density="compact"
                :error-messages="fieldErrorMessages(field)"
                item-title="label"
                item-value="value"
                :items="field.options"
                label="Selected option"
                variant="outlined"
              >
                <template #item="{ props: itemProps, item }">
                  <v-list-item v-bind="itemProps">
                    <template #subtitle>
                      <span v-if="item.raw?.description">{{ item.raw.description }}</span>
                    </template>
                  </v-list-item>
                </template>
              </v-select>
              <v-text-field
                v-else
                v-model="formValues[field.id]"
                density="compact"
                :error-messages="fieldErrorMessages(field)"
                label="Value"
                :type="textFieldInputType(field)"
                variant="outlined"
              />

              <p
                v-if="selectedOptionDescription(field)"
                class="project-config-setup__selected-option"
              >
                {{ selectedOptionDescription(field) }}
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>

    <div class="project-config-setup__actions">
      <v-btn
        color="primary"
        :disabled="saving"
        :loading="saving"
        variant="flat"
        @click="emit('save', { ...formValues })"
      >
        Save config
      </v-btn>
    </div>
  </v-sheet>
</template>

<script setup>
import { computed, reactive, watch } from "vue";
import { mdiArrowLeft } from "@mdi/js";

const props = defineProps({
  canChangeProjectType: {
    type: Boolean,
    default: false
  },
  saving: {
    type: Boolean,
    default: false
  },
  setupSummary: {
    type: String,
    default: ""
  },
  state: {
    type: Object,
    default: () => ({})
  }
});

const emit = defineEmits(["change-project-type", "save"]);
const formValues = reactive({});

const fields = computed(() => {
  return Array.isArray(props.state?.fields) ? props.state.fields : [];
});
const sections = computed(() => {
  return Array.isArray(props.state?.sections) ? props.state.sections : [];
});

function valueForField(field = {}) {
  if (Object.hasOwn(props.state?.values || {}, field.id)) {
    return props.state.values[field.id];
  }
  if (Object.hasOwn(props.state?.defaults || {}, field.id)) {
    return props.state.defaults[field.id];
  }
  return field.type === "boolean" ? false : "";
}

function textFieldInputType(field = {}) {
  return field.type === "string" || field.type === "path" ? "text" : field.type;
}

function fieldDescription(field = {}) {
  return String(field.description || "This setting is provided by the selected project adapter.");
}

function booleanChoiceLabel(field = {}) {
  return formValues[field.id] ? "Enabled" : "Disabled";
}

function selectedOption(field = {}) {
  if (field.type !== "select") {
    return null;
  }
  const selectedValue = String(formValues[field.id] ?? "");
  return (Array.isArray(field.options) ? field.options : [])
    .find((option) => String(option.value || "") === selectedValue) || null;
}

function selectedOptionDescription(field = {}) {
  return String(selectedOption(field)?.description || "");
}

function fieldErrorMessages(field = {}) {
  const invalid = props.state?.fieldValues?.[field.id]?.invalid;
  return invalid?.message ? [invalid.message] : [];
}

function resetFormValues() {
  const knownFieldIds = new Set(fields.value.map((field) => field.id));
  for (const key of Object.keys(formValues)) {
    if (!knownFieldIds.has(key)) {
      delete formValues[key];
    }
  }
  for (const field of fields.value) {
    formValues[field.id] = valueForField(field);
  }
}

watch(
  () => props.state,
  resetFormValues,
  {
    deep: true,
    immediate: true
  }
);
</script>

<style scoped>
.project-config-setup {
  align-content: start;
  display: grid;
  gap: 0.8rem;
  padding: 1rem;
}

.project-config-setup__summary {
  align-items: start;
  background: rgba(var(--v-theme-primary), 0.055);
  border: 1px solid rgba(var(--v-theme-primary), 0.22);
  border-radius: 8px;
  display: grid;
  gap: 0.7rem;
  justify-content: start;
  padding: 0.75rem 0.8rem;
}

.project-config-setup__summary-change {
  flex: 0 0 auto;
}

.project-config-setup__summary-copy {
  min-width: 0;
}

.project-config-setup__summary-kicker {
  color: rgba(var(--v-theme-on-surface), 0.56);
  font-size: 0.78rem;
  font-weight: 760;
  letter-spacing: 0.05em;
  line-height: 1.1;
  margin: 0 0 0.2rem;
  text-transform: uppercase;
}

.project-config-setup__summary-text {
  color: rgb(var(--v-theme-on-surface));
  font-size: clamp(1.15rem, 1.8vw, 1.42rem);
  font-weight: 720;
  line-height: 1.16;
  margin: 0;
}

.project-config-setup__sections {
  display: grid;
  gap: 0.9rem;
}

.project-config-setup__section {
  display: grid;
  gap: 0.55rem;
}

.project-config-setup__section-title {
  font-size: 0.92rem;
  font-weight: 720;
  letter-spacing: 0;
  line-height: 1.2;
  margin: 0;
}

.project-config-setup__fields {
  display: grid;
  gap: 0;
}

.project-config-setup__field {
  border-top: 1px solid rgba(var(--v-theme-outline), 0.18);
  display: grid;
  gap: 0.85rem;
  grid-template-columns: minmax(0, 1fr) minmax(min(20rem, 100%), 0.9fr);
  padding-block: 0.9rem;
}

.project-config-setup__field:first-child {
  border-top: 0;
  padding-top: 0;
}

.project-config-setup__field-copy {
  align-content: start;
  display: grid;
  gap: 0.35rem;
}

.project-config-setup__field-copy h4 {
  font-size: 0.98rem;
  font-weight: 720;
  letter-spacing: 0;
  line-height: 1.25;
  margin: 0;
}

.project-config-setup__field-copy p,
.project-config-setup__selected-option {
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.86rem;
  line-height: 1.4;
  margin: 0;
}

.project-config-setup__field-id {
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 0.72rem;
  line-height: 1.2;
  overflow-wrap: anywhere;
}

.project-config-setup__field-control {
  display: grid;
  gap: 0.35rem;
  min-width: 0;
}

.project-config-setup__actions {
  display: flex;
  justify-content: flex-end;
}

@media (max-width: 720px) {
  .project-config-setup__summary {
    align-items: stretch;
    display: grid;
  }

  .project-config-setup__summary-change {
    justify-self: start;
  }

  .project-config-setup__field {
    grid-template-columns: 1fr;
  }
}
</style>
