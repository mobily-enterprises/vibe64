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

    <section
      v-if="runtimeChoices.length || runtimePackages.length"
      class="project-config-setup__runtime"
    >
      <div class="project-config-setup__runtime-heading">
        <p class="project-config-setup__runtime-kicker">Runtime</p>
        <p class="project-config-setup__runtime-title">{{ runtimeStatusLabel }}</p>
      </div>
      <div
        v-if="runtimeChoices.length"
        class="project-config-setup__runtime-choices"
      >
        <div
          v-for="choice in runtimeChoices"
          :key="choice.id"
          class="project-config-setup__runtime-choice"
        >
          <div class="project-config-setup__runtime-choice-copy">
            <h4>{{ choice.label }}</h4>
            <p v-if="runtimeChoiceDescription(choice)">{{ runtimeChoiceDescription(choice) }}</p>
          </div>

          <div class="project-config-setup__runtime-choice-control">
            <v-select
              v-if="choice.configFieldId"
              v-model="formValues[choice.configFieldId]"
              density="compact"
              :error-messages="runtimeChoiceErrorMessages(choice)"
              :item-props="runtimeChoiceItemProps"
              item-title="label"
              item-value="value"
              :items="runtimeChoiceItems(choice)"
              label="Selected runtime"
              variant="outlined"
            >
              <template #item="{ props: itemProps, item }">
                <v-list-item v-bind="itemProps">
                  <template #subtitle>
                    <span>{{ runtimeChoiceOptionSubtitle(item.raw) }}</span>
                  </template>
                </v-list-item>
              </template>
            </v-select>
            <v-select
              v-else
              density="compact"
              disabled
              item-title="label"
              item-value="value"
              :items="runtimeChoiceItems(choice)"
              label="Selected runtime"
              :model-value="choice.selectedValue"
              variant="outlined"
            />
            <p
              v-if="runtimeChoiceSelectedDetail(choice)"
              class="project-config-setup__selected-option"
            >
              {{ runtimeChoiceSelectedDetail(choice) }}
            </p>
          </div>
        </div>
      </div>
      <div
        v-else
        class="project-config-setup__runtime-packages"
      >
        <v-chip
          v-for="runtimePackage in runtimePackages"
          :key="runtimePackage.id"
          class="project-config-setup__runtime-chip"
          density="comfortable"
          size="small"
          variant="tonal"
        >
          {{ runtimePackageLabel(runtimePackage) }}
        </v-chip>
      </div>
    </section>

    <div class="project-config-setup__sections">
      <section
        v-for="section in visibleSections"
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
                :autocomplete="textFieldAutocomplete(field)"
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
const fieldById = computed(() => {
  return new Map(fields.value.map((field) => [field.id, field]));
});
const sections = computed(() => {
  return Array.isArray(props.state?.sections) ? props.state.sections : [];
});
const runtimeLock = computed(() => {
  const lock = props.state?.runtimeLock;
  return lock && typeof lock === "object" && !Array.isArray(lock) ? lock : null;
});
const runtimeChoices = computed(() => {
  return Array.isArray(props.state?.runtimeChoices) ? props.state.runtimeChoices : [];
});
const runtimeConfigFieldIds = computed(() => {
  return new Set(runtimeChoices.value
    .map((choice) => String(choice.configFieldId || "").trim())
    .filter(Boolean));
});
const runtimePackages = computed(() => {
  const selected = runtimeLock.value?.selected || {};
  return [
    ...(Array.isArray(selected.tools) ? selected.tools : []),
    ...(Array.isArray(selected.services) ? selected.services : [])
  ];
});
const runtimeStatusLabel = computed(() => {
  const packageCount = runtimePackages.value.length;
  if (packageCount === 0 && runtimeChoices.value.length > 0) {
    return "Adapter runtime choices";
  }
  return `${packageCount} ${packageCount === 1 ? "package" : "packages"} locked`;
});
const visibleSections = computed(() => {
  return sections.value
    .map((section) => ({
      ...section,
      fields: (Array.isArray(section.fields) ? section.fields : []).filter(fieldVisible)
    }))
    .filter((section) => section.fields.length > 0);
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
  if (field.sensitive === true) {
    return "password";
  }
  return field.type === "string" || field.type === "path" ? "text" : field.type;
}

function textFieldAutocomplete(field = {}) {
  return field.sensitive === true ? "off" : "on";
}

function conditionMatches(condition = null) {
  if (!condition) {
    return true;
  }
  if (Array.isArray(condition.all)) {
    return condition.all.every((entry) => conditionMatches(entry));
  }
  const value = String(formValues[condition.field] ?? "");
  if (Object.hasOwn(condition, "equals")) {
    return value === String(condition.equals ?? "");
  }
  return false;
}

function fieldVisible(field = {}) {
  return conditionMatches(field.visibleWhen) && !runtimeConfigFieldIds.value.has(field.id);
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

function runtimePackageLabel(runtimePackage = {}) {
  return [
    runtimePackage.label || runtimePackage.id,
    runtimePackage.version,
    runtimePackage.provider === "nix" ? "Nix" : runtimePackage.provider
  ].filter(Boolean).join(" / ");
}

function runtimeChoiceDescription(choice = {}) {
  return String(choice.description || "");
}

function runtimeChoiceItems(choice = {}) {
  return (Array.isArray(choice.options) ? choice.options : []).map((option) => ({
    ...option,
    label: runtimeChoiceOptionTitle(option)
  }));
}

function runtimeChoiceItemProps(option = {}) {
  const raw = option.raw || option;
  return {
    disabled: raw.runtimeUnavailable === true
  };
}

function runtimeChoiceOptionTitle(option = {}) {
  const parts = [
    option.label || option.value,
    option.package?.version ? option.package.version : ""
  ].filter(Boolean);
  return parts.join(" ");
}

function runtimeChoiceOptionSubtitle(option = {}) {
  if (option.runtimeUnavailable === true) {
    return String(option.runtimeUnavailableReason || "Unavailable");
  }
  if (option.package) {
    return runtimePackageLabel(option.package);
  }
  return String(option.description || "");
}

function runtimeChoiceSelectedOption(choice = {}) {
  const selectedValue = choice.configFieldId
    ? String(formValues[choice.configFieldId] ?? "")
    : String(choice.selectedValue ?? "");
  return (Array.isArray(choice.options) ? choice.options : [])
    .find((option) => String(option.value || "") === selectedValue) || null;
}

function runtimeChoiceSelectedDetail(choice = {}) {
  return runtimeChoiceOptionSubtitle(runtimeChoiceSelectedOption(choice) || {});
}

function runtimeChoiceErrorMessages(choice = {}) {
  const field = fieldById.value.get(choice.configFieldId);
  return field ? fieldErrorMessages(field) : [];
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

.project-config-setup__runtime {
  align-items: center;
  border-block: 1px solid rgba(var(--v-theme-outline), 0.18);
  display: grid;
  gap: 0.75rem;
  grid-template-columns: minmax(0, 0.7fr) minmax(0, 1.3fr);
  padding-block: 0.75rem;
}

.project-config-setup__runtime-heading {
  min-width: 0;
}

.project-config-setup__runtime-kicker {
  color: rgba(var(--v-theme-on-surface), 0.56);
  font-size: 0.76rem;
  font-weight: 760;
  line-height: 1.1;
  margin: 0 0 0.18rem;
  text-transform: uppercase;
}

.project-config-setup__runtime-title {
  color: rgb(var(--v-theme-on-surface));
  font-size: 0.96rem;
  font-weight: 720;
  line-height: 1.2;
  margin: 0;
}

.project-config-setup__runtime-packages {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  justify-content: flex-end;
  min-width: 0;
}

.project-config-setup__runtime-chip {
  max-width: 100%;
}

.project-config-setup__runtime-choices {
  display: grid;
  gap: 0.65rem;
  min-width: 0;
}

.project-config-setup__runtime-choice {
  display: grid;
  gap: 0.85rem;
  grid-template-columns: minmax(0, 1fr) minmax(min(20rem, 100%), 0.9fr);
}

.project-config-setup__runtime-choice-copy,
.project-config-setup__runtime-choice-control {
  display: grid;
  gap: 0.35rem;
  min-width: 0;
}

.project-config-setup__runtime-choice-copy h4 {
  font-size: 0.95rem;
  font-weight: 720;
  letter-spacing: 0;
  line-height: 1.25;
  margin: 0;
}

.project-config-setup__runtime-choice-copy p {
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.84rem;
  line-height: 1.4;
  margin: 0;
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

  .project-config-setup__runtime {
    grid-template-columns: 1fr;
  }

  .project-config-setup__runtime-packages {
    justify-content: flex-start;
  }

  .project-config-setup__runtime-choice {
    grid-template-columns: 1fr;
  }

  .project-config-setup__field {
    grid-template-columns: 1fr;
  }
}
</style>
