<script setup>
import MercBlueMangaIllustratedAvatar from "./MercBlueMangaIllustratedAvatar.vue";
import MercIllustratedAvatar from "./MercIllustratedAvatar.vue";

defineProps({
  avatar: {
    default: "yu",
    type: String
  },
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
    v-if="avatar === 'merc'"
    :mouth-level="mouthLevel"
    :mouth-pose="mouthPose"
    :state="state"
  />
  <MercBlueMangaIllustratedAvatar
    v-else
    :mouth-level="mouthLevel"
    :mouth-pose="mouthPose"
    :state="state"
  />
</template>
