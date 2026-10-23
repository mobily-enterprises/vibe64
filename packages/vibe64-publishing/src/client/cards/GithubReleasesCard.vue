<script setup>
// A GitHub Releases target: the repository and a link to the last release.
import { mdiOpenInNew } from "@mdi/js";
import TargetCard from "./TargetCard.vue";

defineProps({ target: { type: Object, required: true } });
defineEmits(["remove", "change-account", "show-release"]);
</script>

<template>
  <TargetCard v-bind="$attrs" :target="target" @change-account="$emit('change-account', $event)" @remove="$emit('remove')" @show-release="$emit('show-release', $event)">
    <template #facts>
      <div><dt>Repository</dt><dd>{{ target.settings?.repository }}</dd></div>
      <div v-if="target.latest?.proof?.tag"><dt>Release</dt><dd>{{ target.latest.proof.tag }}</dd></div>
    </template>
    <template v-if="target.latest?.proof?.url" #actions>
      <v-btn :append-icon="mdiOpenInNew" :href="target.latest.proof.url" rel="noopener" rounded="pill" size="small" target="_blank" variant="tonal">
        Open release
      </v-btn>
    </template>
  </TargetCard>
</template>
