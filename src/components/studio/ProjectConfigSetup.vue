<template>
  <v-sheet rounded="lg" border class="project-config-setup">
    <div class="project-config-setup__heading">
      <p class="project-config-setup__eyebrow">AI Studio</p>
      <h2 class="project-config-setup__title">Configure project</h2>
      <p class="project-config-setup__message">
        {{ message }}
      </p>
    </div>

    <div class="project-config-setup__sections">
      <section
        v-for="section in sections"
        :key="section.id"
        class="project-config-setup__section"
      >
        <h3 class="project-config-setup__section-title">{{ section.label }}</h3>
        <div class="project-config-setup__fields">
          <template v-for="field in section.fields" :key="field.id">
            <v-switch
              v-if="field.type === 'boolean'"
              v-model="formValues[field.id]"
              color="primary"
              density="compact"
              hide-details="auto"
              :label="field.label"
            />
            <v-select
              v-else-if="field.type === 'select'"
              v-model="formValues[field.id]"
              density="compact"
              hide-details="auto"
              item-title="label"
              item-value="value"
              :items="field.options"
              :label="field.label"
              variant="outlined"
            />
            <v-text-field
              v-else
              v-model="formValues[field.id]"
              density="compact"
              hide-details="auto"
              :label="field.label"
              :type="field.type === 'path' ? 'text' : field.type"
              variant="outlined"
            />
          </template>
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

const props = defineProps({
  saving: {
    type: Boolean,
    default: false
  },
  state: {
    type: Object,
    default: () => ({})
  }
});

const emit = defineEmits(["save"]);
const formValues = reactive({});

const fields = computed(() => {
  return Array.isArray(props.state?.fields) ? props.state.fields : [];
});
const sections = computed(() => {
  return Array.isArray(props.state?.sections) ? props.state.sections : [];
});
const message = computed(() => {
  return props.state?.ready === true
    ? "Project configuration is saved."
    : "Save these values before Studio prepares the target project.";
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
  display: grid;
  gap: 1rem;
  padding: 1rem;
}

.project-config-setup__heading {
  display: grid;
  gap: 0.25rem;
}

.project-config-setup__eyebrow {
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.72rem;
  font-weight: 750;
  letter-spacing: 0.06em;
  line-height: 1.1;
  margin: 0;
  text-transform: uppercase;
}

.project-config-setup__title {
  font-size: 1.18rem;
  font-weight: 760;
  letter-spacing: 0;
  line-height: 1.16;
  margin: 0;
}

.project-config-setup__message {
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.9rem;
  line-height: 1.35;
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
  gap: 0.65rem;
  grid-template-columns: repeat(auto-fit, minmax(min(20rem, 100%), 1fr));
}

.project-config-setup__actions {
  display: flex;
  justify-content: flex-end;
}
</style>
