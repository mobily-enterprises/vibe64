<script setup>
import { onMounted, onUnmounted } from "vue";
import { RouterView, useRouter } from "vue-router";
import ShellErrorHost from "@jskit-ai/shell-web/client/components/ShellErrorHost";

const router = useRouter();

function navigateAppLink(event) {
  if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
    return;
  }
  const anchor = event.target?.closest?.("a[href]");
  if (!anchor || anchor.hasAttribute("download") || anchor.relList.contains("external")) {
    return;
  }
  const target = anchor.getAttribute("target");
  if (target && target.toLowerCase() !== "_self") {
    return;
  }
  const href = anchor.getAttribute("href");
  if (!href || href.startsWith("#")) {
    return;
  }

  let url;
  try {
    url = new URL(anchor.href);
  } catch {
    return;
  }
  if (
    url.origin !== window.location.origin ||
    !["http:", "https:"].includes(url.protocol) ||
    url.username || url.password
  ) {
    return;
  }
  const path = `${url.pathname}${url.search}${url.hash}`;
  const route = router.resolve(path);
  // The shell's catch-all also matches API, download and unknown paths.
  if (!route.matched.length || route.name === "not-found") {
    return;
  }

  event.preventDefault();
  void router.push(path);
}

// Bubble after component-owned actions (including source links and RouterLink).
// Listen on the document so links in teleported dialogs use the same routing.
onMounted(() => document.addEventListener("click", navigateAppLink));
onUnmounted(() => document.removeEventListener("click", navigateAppLink));
</script>

<template>
  <v-app>
    <RouterView />
    <ShellErrorHost />
  </v-app>
</template>

<style>
.v-application .v-btn.v-btn--variant-outlined.text-primary:not(.v-btn--disabled) {
  background: rgba(var(--v-theme-primary), 0.1) !important;
  border-color: rgba(var(--v-theme-primary), 0.32) !important;
  color: rgb(var(--v-theme-primary)) !important;
}

.v-application .v-btn.v-btn--variant-outlined.text-primary:not(.v-btn--disabled):hover {
  background: rgba(var(--v-theme-primary), 0.14) !important;
}

.v-application .v-field--variant-outlined .v-field__outline {
  --v-field-border-opacity: 1;
  color: rgba(var(--v-theme-on-surface), 0.42);
}

.v-application .v-field--variant-outlined.v-field--focused {
  box-shadow: 0 0 0 2px rgba(var(--v-theme-primary), 0.28);
}

.v-application .v-field--variant-outlined.v-field--focused .v-field__outline {
  color: rgb(var(--v-theme-primary));
}
</style>
