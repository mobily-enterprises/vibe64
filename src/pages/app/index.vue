<route lang="json">
{
  "meta": {
    "jskit": {
      "surface": "app"
    }
  }
}
</route>

<script setup>
import { onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";

const route = useRoute();
const router = useRouter();

onMounted(async () => {
  await router.replace({
    path: "/app/manage/projects",
    query: route.query
  });
});
</script>

<template>
  <span hidden />
</template>
