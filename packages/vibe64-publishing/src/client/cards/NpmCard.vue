<script setup>
// An npm target: which registry, which dist-tag, and the published integrity.
import TargetCard from "./TargetCard.vue";

defineProps({ target: { type: Object, required: true } });
defineEmits(["remove", "change-account"]);
</script>

<template>
  <TargetCard v-bind="$attrs" :target="target" @change-account="$emit('change-account', $event)" @remove="$emit('remove')">
    <template #facts>
      <div><dt>Registry</dt><dd class="publish-target__mono">{{ target.settings?.registry }}</dd></div>
      <div><dt>Tag</dt><dd>{{ target.channel || "latest" }}</dd></div>
      <div v-if="target.settings?.access"><dt>Access</dt><dd>{{ target.settings.access }}</dd></div>
    </template>
  </TargetCard>
</template>
