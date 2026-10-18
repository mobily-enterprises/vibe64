<script setup>
import MercIllustratedAvatar from "./MercIllustratedAvatar.vue";

defineProps({
  mouthLevel: {
    default: 0,
    type: Number
  },
  mouthPose: {
    default: "closed",
    type: String
  },
  state: {
    default: "idle",
    type: String
  }
});
</script>

<template>
  <MercIllustratedAvatar
    appearance="blond-girl"
    :mouth-level="mouthLevel"
    :mouth-pose="mouthPose"
    :state="state"
  />
</template>
