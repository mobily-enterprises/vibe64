<script setup>
import MercBlueMangaIllustratedAvatar from "./MercBlueMangaIllustratedAvatar.vue";

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
  <MercBlueMangaIllustratedAvatar
    appearance="blond-girl"
    :mouth-level="mouthLevel"
    :mouth-pose="mouthPose"
    :state="state"
  />
</template>
