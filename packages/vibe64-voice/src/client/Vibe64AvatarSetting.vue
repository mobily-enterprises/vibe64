<script setup>
import { VIBE64_AVATAR_CHOICES } from "../shared/avatars.js";

defineProps({
  modelValue: { type: String, default: null },
  disabled: Boolean,
  loading: Boolean,
  hint: { type: String, default: "" }
});
defineEmits(["update:modelValue"]);
</script>

<template>
  <v-select
    :model-value="modelValue"
    :items="VIBE64_AVATAR_CHOICES"
    item-title="label" item-value="id" label="Avatar" density="comfortable"
    :disabled="disabled" :loading="loading"
    :hint="hint" :persistent-hint="Boolean(hint)"
    @update:model-value="value => $emit('update:modelValue', value)"
  />
</template>
