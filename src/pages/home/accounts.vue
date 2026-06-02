<template>
  <section class="generated-ui-screen generated-ui-screen--studio accounts-page">
    <ProjectSelectionGate>
      <AccountsSetup
        back-label="Back to Studio"
        continue-label="Continue to Studio Setup"
        @back="returnToCaller"
        @continue="continueToStudioSetup"
      />
    </ProjectSelectionGate>
  </section>
</template>

<script setup>
import { useRoute, useRouter } from "vue-router";
import AccountsSetup from "@/components/studio/AccountsSetup.vue";
import ProjectSelectionGate from "@/components/studio/ProjectSelectionGate.vue";

const emit = defineEmits(["page-title-change"]);
const route = useRoute();
const router = useRouter();

emit("page-title-change", "Accounts");

function firstQueryValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeReturnTo(value = "") {
  const target = String(firstQueryValue(value) || "").trim();
  if (!target || target === "/home/accounts" || target.startsWith("/home/accounts?")) {
    return "/home";
  }
  return target.startsWith("/home") ? target : "/home";
}

function returnToCaller() {
  void router.push(normalizeReturnTo(route.query.returnTo));
}

function continueToStudioSetup() {
  void router.push({
    path: "/home/dashboard/setup",
    query: {
      tab: "studio-setup"
    }
  });
}
</script>

<style scoped>
.accounts-page {
  margin-inline: auto;
  max-width: min(72rem, calc(100vw - 2rem));
  min-width: 0;
  width: 100%;
}

@media (max-width: 640px) {
  .accounts-page {
    max-width: min(100%, calc(100vw - 1rem));
  }
}
</style>
