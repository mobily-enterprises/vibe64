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
import { resolveStudioGate } from "@/lib/studioApi.js";

const router = useRouter();

onMounted(async () => {
  try {
    const gate = await resolveStudioGate();
    await router.replace(gate.route || "/bootup");
  } catch {
    await router.replace("/bootup");
  }
});
</script>

<template>
  <section class="generated-ui-screen generated-ui-screen--app studio-redirect">
    <v-progress-linear color="primary" height="6" indeterminate rounded />
  </section>
</template>

<style scoped>
.studio-redirect {
  margin: 2rem auto;
  max-width: 24rem;
}
</style>
