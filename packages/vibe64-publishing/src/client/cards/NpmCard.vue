<script setup>
// An npm target: which registry and which dist-tag people get.
import TargetCard from "./TargetCard.vue";
import { hostOf } from "../publishFormat.js";

defineProps({ target: { type: Object, required: true } });
defineEmits(["remove", "change-account", "show-release"]);
</script>

<template>
  <TargetCard v-bind="$attrs" :target="target" @change-account="$emit('change-account', $event)" @remove="$emit('remove')" @show-release="$emit('show-release', $event)">
    <template #facts>
      <div><dt>Registry</dt><dd :title="target.settings?.registry">{{ hostOf(target.settings?.registry) }}</dd></div>
      <div><dt>Tag</dt><dd>{{ target.channel || "latest" }}</dd></div>
      <div v-if="target.settings?.access"><dt>Access</dt><dd>{{ target.settings.access }}</dd></div>
    </template>
  </TargetCard>
</template>
