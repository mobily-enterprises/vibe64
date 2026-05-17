<route lang="json">
{
  "meta": {
    "jskit": {
      "scope": "global"
    }
  }
}
</route>

<script setup>
import { onMounted } from "vue";
import { useRouter } from "vue-router";

const router = useRouter();

onMounted(async () => {
  await router.replace("/setup");
});
</script>

<template>
  <section class="generated-ui-screen generated-ui-screen--studio studio-redirect">
    <v-progress-linear color="primary" height="6" indeterminate rounded />
  </section>
</template>

<style scoped>
.studio-redirect {
  margin: 2rem auto;
  max-width: 24rem;
}
</style>
