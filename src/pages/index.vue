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
  await router.replace("/app/manage");
});
</script>

<template>
  <span hidden />
</template>
