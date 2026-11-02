<script setup>
// The two steps of a Codex device sign-in, with the current one marked.
defineProps({
  settingsStep: Boolean,
  authorizeStep: Boolean
});
</script>

<template>
  <ol
    aria-label="Connect Codex"
    class="accounts-setup__steps pa-0 mt-0 mb-2"
  >
    <li
      :aria-current="settingsStep ? 'step' : undefined"
      class="d-flex align-center ga-2 text-label-large"
    >
      <v-avatar
        color="primary"
        size="28"
        :variant="settingsStep ? 'flat' : 'tonal'"
      >
        1
      </v-avatar>
      Prepare
    </li>
    <li class="accounts-setup__step-divider" aria-hidden="true"><v-divider /></li>
    <li
      :aria-current="authorizeStep ? 'step' : undefined"
      class="d-flex align-center ga-2 text-label-large"
    >
      <v-avatar
        :color="authorizeStep ? 'primary' : undefined"
        size="28"
        :variant="authorizeStep ? 'flat' : 'tonal'"
      >
        2
      </v-avatar>
      Connect
    </li>
  </ol>
</template>

<style scoped>
.accounts-setup__steps {
  align-items: center;
  display: flex;
  gap: 1rem;
  list-style: none;
}

.accounts-setup__steps li {
  flex-shrink: 0;
}

.accounts-setup__steps .accounts-setup__step-divider {
  flex: 1;
}

.accounts-setup__steps [aria-current="step"] {
  color: rgb(var(--v-theme-primary));
}
</style>
