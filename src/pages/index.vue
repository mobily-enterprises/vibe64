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
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";

const router = useRouter();
const paths = usePaths();

onMounted(async () => {
  await router.replace(paths.page("/", { surface: "app" }));
});
</script>

<template>
  <span hidden />
</template>
