<script setup>
import ShellLayout from "@/components/ShellLayout.vue";
import Vibe64AccountMenu from "@/components/auth/Vibe64AccountMenu.vue";
import AIAccountsSetup from "@/components/studio/AIAccountsSetup.vue";
import AccountsSetup from "@/components/studio/AccountsSetup.vue";
import { useStudioShellDrawer } from "@/composables/useStudioShellDrawer.js";

defineProps({
  checking: {
    default: false,
    type: Boolean
  },
  error: {
    default: "",
    type: String
  },
  step: {
    default: "",
    type: String
  }
});

const emit = defineEmits(["continue", "retry"]);

useStudioShellDrawer({
  hidden: true
});
</script>

<template>
  <ShellLayout>
    <template #top-left>
      <h1 class="vibe64-prerequisite__brand">Vibe64</h1>
    </template>
    <template #top-right>
      <Vibe64AccountMenu />
    </template>

    <main class="vibe64-prerequisite">
      <v-progress-linear
        v-if="checking"
        color="primary"
        height="4"
        indeterminate
        rounded
      />

      <v-alert
        v-if="error"
        type="error"
        variant="tonal"
        border="start"
      >
        <div class="vibe64-prerequisite__error">
          <span>{{ error }}</span>
          <v-btn
            color="primary"
            :disabled="checking"
            variant="tonal"
            @click="emit('retry')"
          >
            Retry
          </v-btn>
        </div>
      </v-alert>

      <AIAccountsSetup
        v-else-if="step === 'codex'"
        continue-label="Continue"
        lede="Set up the shared Codex account before using this Vibe64 environment."
        needed-label="Codex setup required"
        ready-label="Codex ready"
        title="Codex setup"
        @continue="emit('continue')"
      />

      <AccountsSetup
        v-else-if="step === 'github'"
        auto-continue-when-ready
        continue-label="Continue"
        lede="Connect your GitHub account before using Vibe64. Vibe64 uses this identity for commits, branches, pull requests, and merge actions."
        needed-label="GitHub required"
        :provider-ids="['github']"
        ready-label="GitHub connected"
        title="GitHub setup"
        @continue="emit('continue')"
      />
    </main>
  </ShellLayout>
</template>

<style scoped>
.vibe64-prerequisite {
  align-content: start;
  background: #f6f7f9;
  display: grid;
  gap: 1rem;
  min-height: calc(100dvh - var(--v-layout-top, 0px));
  padding: 1rem clamp(1rem, 3vw, 2rem);
}

.vibe64-prerequisite > :deep(.accounts-setup),
.vibe64-prerequisite > .v-alert,
.vibe64-prerequisite > .v-progress-linear {
  margin-inline: auto;
  max-width: 82rem;
  width: 100%;
}

.vibe64-prerequisite__brand {
  font-size: 1.15rem;
  font-weight: 720;
  line-height: 1.2;
  margin: 0 0 0 1rem;
}

.vibe64-prerequisite__error {
  align-items: center;
  display: flex;
  gap: 1rem;
  justify-content: space-between;
}

@media (max-width: 640px) {
  .vibe64-prerequisite__error {
    align-items: start;
    flex-direction: column;
  }
}
</style>
