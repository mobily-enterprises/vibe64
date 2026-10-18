<script setup>
import MercBlueMangaIllustratedAvatar from "./MercBlueMangaIllustratedAvatar.vue";
import MercBlondBoyAvatar from "./MercBlondBoyAvatar.vue";

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
  <MercBlondBoyAvatar
    v-if="avatar === 'merc'"
    :mouth-level="mouthLevel"
    :mouth-pose="mouthPose"
    :state="state"
  />
  <MercBlueMangaIllustratedAvatar
    v-else
    appearance="blond-girl"
    :mouth-level="mouthLevel"
    :mouth-pose="mouthPose"
    :state="state"
  />
</template>
