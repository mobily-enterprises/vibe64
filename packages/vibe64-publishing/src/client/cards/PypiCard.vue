<script setup>
// A PyPI target: the index it uploads to and the published file hashes.
import { computed } from "vue";
import TargetCard from "./TargetCard.vue";
import { hostOf } from "../publishFormat.js";

const props = defineProps({ target: { type: Object, required: true } });
defineEmits(["remove", "change-account", "show-release"]);
const where = computed(() => {
  const settings = props.target.settings || {};
  if (settings.instance === "testpypi") return "TestPyPI";
  if (settings.instance === "pypi") return "pypi.org";
  return hostOf(settings.repository || "");
});
</script>

<template>
  <TargetCard v-bind="$attrs" :target="target" @change-account="$emit('change-account', $event)" @remove="$emit('remove')" @show-release="$emit('show-release', $event)">
    <template #facts>
      <div><dt>Index</dt><dd :title="target.settings?.repository || where">{{ where }}</dd></div>
    </template>
  </TargetCard>
</template>
