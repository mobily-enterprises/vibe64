<template>
  <v-dialog
    :model-value="modelValue"
    :max-width="maxWidth"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title>{{ title }}</v-card-title>
      <v-card-text>
        {{ body }}
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="emit('cancel')">Cancel</v-btn>
        <v-btn
          :color="confirmColor"
          variant="flat"
          :loading="loading"
          @click="emit('confirm')"
        >
          {{ confirmLabel }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup>
defineProps({
  body: {
    default: "",
    type: String
  },
  confirmColor: {
    default: "error",
    type: String
  },
  confirmLabel: {
    default: "Confirm",
    type: String
  },
  loading: {
    default: false,
    type: Boolean
  },
  maxWidth: {
    default: "30rem",
    type: String
  },
  modelValue: {
    default: false,
    type: Boolean
  },
  title: {
    default: "",
    type: String
  }
});

const emit = defineEmits(["cancel", "confirm", "update:modelValue"]);
</script>
