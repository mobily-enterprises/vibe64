<template>
  <v-dialog v-model="outputOptionsVisible" aria-label="Preview options" max-width="520" :persistent="operationBusy" scrollable>
    <v-card>
      <v-card-title>Preview options</v-card-title>
      <v-card-subtitle>{{ outputOptionsSelection?.label }}</v-card-subtitle>
      <v-card-text>
        <v-text-field
          v-for="parameter in outputOptionsSelection?.parameters || []"
          :key="parameter.id"
          v-model="outputOptionsValues[parameter.id]"
          class="mb-3"
          :disabled="operationBusy"
          :error-messages="outputOptionsErrors[parameter.id]"
          :hint="parameter.description"
          :label="parameter.label"
          :maxlength="4096"
          :persistent-hint="Boolean(parameter.description)"
          :required="parameter.required"
          variant="outlined"
          @keydown.enter.prevent="submitOutputOptions"
        />
        <v-checkbox
          v-model="outputOptionsRemember"
          :disabled="operationBusy"
          hint="Use these values for new sessions in this browser."
          label="Remember for this project"
          persistent-hint
        />
        <v-btn :disabled="operationBusy" variant="text" @click="resetOutputOptions">Use defaults</v-btn>
        <v-alert v-if="outputOptionsError" class="mt-3" type="error" variant="tonal">
          {{ outputOptionsError }}
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn :disabled="operationBusy" variant="text" @click="outputOptionsVisible = false">Cancel</v-btn>
        <v-btn :disabled="operationBusy" color="primary" variant="flat" @click="submitOutputOptions">
          {{ outputOptionsAction }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup>
// The run parameters a target asks for before it starts.
const props = defineProps({
  surface: {
    required: true,
    type: /** @type {import("vue").PropType<ReturnType<typeof import("@/composables/useVibe64OutputControlsSurface.js").useVibe64OutputControlsSurface>>} */ (Object)
  }
});

const {
  operationBusy,
  outputOptionsAction,
  outputOptionsError,
  outputOptionsErrors,
  outputOptionsRemember,
  outputOptionsSelection,
  outputOptionsValues,
  outputOptionsVisible,
  resetOutputOptions,
  submitOutputOptions
} = props.surface;
</script>

<style scoped>
.vibe64-launch-controls__options-card :deep(.v-card-text) {
  display: grid;
  gap: 1rem;
}
</style>
