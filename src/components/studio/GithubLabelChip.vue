<script setup>
import { computed } from "vue";

const props = defineProps({ label: { type: Object, required: true } });
const color = computed(() => /^[a-f\d]{6}$/iu.test(props.label.color || "") ? `#${props.label.color}` : undefined);
</script>

<template>
  <v-chip :color="color" :title="label.description || label.name" :aria-label="label.name" variant="flat" size="small">
    <span class="github-label-name">{{ label.name }}</span>
  </v-chip>
</template>

<style scoped>
.github-label-name { overflow: hidden; text-overflow: ellipsis; }
</style>
