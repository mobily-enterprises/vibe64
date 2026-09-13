<script>
const assets = import.meta.glob("../../assets/integrations/*.{svg,png,ico,jpg,webp}", {
  eager: true,
  query: "?url",
  import: "default"
});
const logos = Object.fromEntries(
  Object.entries(assets).map(([path, url]) => [path.split("/").at(-1).replace(/\.[^.]+$/u, ""), url])
);
</script>

<script setup>
import { computed } from "vue";
import { mdiConnection, mdiCreation } from "@mdi/js";

const props = defineProps({ provider: { type: String, required: true } });
const logo = computed(() => logos[props.provider]);
</script>

<template>
  <span class="integration-service-logo mr-3" aria-hidden="true">
    <img v-if="logo" :src="logo" alt="" width="28" height="28" loading="lazy">
    <v-icon v-else :icon="provider === 'ai' ? mdiCreation : mdiConnection" size="28" color="grey-darken-3" />
  </span>
</template>

<style scoped>
.integration-service-logo { display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; flex: 0 0 40px; border-radius: 8px; background: #fff; /* Preserve vendor colors on a neutral backing in either theme. */ }
.integration-service-logo img { display: block; object-fit: contain; }
</style>
