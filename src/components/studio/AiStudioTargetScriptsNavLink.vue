<script setup>
import { computed } from "vue";
import { useRoute } from "vue-router";
import SurfaceAwareMenuLinkItem from "@/components/menus/SurfaceAwareMenuLinkItem.vue";

const route = useRoute();

const targetScriptsSuffix = computed(() => {
  return route.query.mode === "inspect"
    ? "/target-scripts?mode=inspect"
    : "/target-scripts";
});
</script>

<template>
  <SurfaceAwareMenuLinkItem
    label="Target Scripts"
    icon="mdi-view-list-outline"
    surface="home"
    :scoped-suffix="targetScriptsSuffix"
    :unscoped-suffix="targetScriptsSuffix"
    exact
  />
</template>
