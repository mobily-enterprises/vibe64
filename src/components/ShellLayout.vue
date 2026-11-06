<script setup>
import ShellPageTitle from "@jskit-ai/shell-web/client/components/ShellPageTitle";
import StudioAppShellLayout from "./StudioAppShellLayout.vue";

// A page outside the project workspace in the Studio bar: the L button, the Up arrow on inner pages and the page's
// title, its own top-left and top-right content, then the AI task tray and the Colleague launcher. There is no
// navigation drawer; the page's title is its route's meta.jskit.title (or useShellPageTitle), else `title`.
defineOptions({ inheritAttrs: false });
defineProps({
  // The title of pages that declare none and set none. A message key or plain text.
  title: {
    type: String,
    default: ""
  }
});
</script>

<template>
  <StudioAppShellLayout v-bind="$attrs">
    <template #top-left>
      <ShellPageTitle class="vibe64-shell-layout__title" :title="title" />
      <slot name="top-left" />
    </template>
    <template #top-right>
      <slot name="top-right" />
    </template>
    <slot />
  </StudioAppShellLayout>
</template>

<style scoped>
.vibe64-shell-layout__title {
  flex: 0 1 auto;
  min-width: 0;
  padding-inline-start: 1rem;
}
</style>
