<script setup>
import { useVibe64AuthGate } from "@/composables/useVibe64AuthGate.js";

const {
  applyAuthenticated,
  authenticated,
  continuePrerequisiteSetup,
  loadError,
  loading,
  prerequisite,
  prerequisitesSatisfied,
  state,
  Vibe64AuthScreen,
  Vibe64PrerequisiteSetup
} = useVibe64AuthGate();
</script>

<template>
  <div v-if="loading" class="vibe64-auth-gate__loading">
    <v-progress-circular indeterminate color="primary" />
  </div>
  <main v-else-if="loadError" class="vibe64-auth-gate__loading">
    <v-alert type="error" variant="tonal">
      {{ loadError }}
    </v-alert>
  </main>
  <Vibe64AuthScreen
    v-else-if="!authenticated"
    :owner-invite-pending="state.ownerInvitePending"
    :setup-required="state.setupRequired"
    @authenticated="applyAuthenticated"
  />
  <main
    v-else-if="!prerequisite.checked && !prerequisite.error"
    class="vibe64-auth-gate__loading"
  >
    <v-progress-circular indeterminate color="primary" />
  </main>
  <Vibe64PrerequisiteSetup
    v-else-if="!prerequisitesSatisfied"
    :checking="prerequisite.checking"
    :error="prerequisite.error"
    :step="prerequisite.step"
    @continue="continuePrerequisiteSetup"
    @retry="continuePrerequisiteSetup"
  />
  <slot v-else />
</template>

<style scoped>
.vibe64-auth-gate__loading {
  align-items: center;
  background: #f6f7f9;
  display: flex;
  justify-content: center;
  min-height: 100dvh;
  padding: 1rem;
}
</style>
