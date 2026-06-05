<script setup>
import { reactive, ref } from "vue";
import {
  mdiLockReset
} from "@mdi/js";
import {
  changePassword
} from "@/lib/vibe64AuthApi.js";

const passwordStatus = ref("");
const error = ref("");
const passwordForm = reactive({
  oldPassword: "",
  password: "",
  passwordConfirmation: ""
});

async function submitPasswordChange() {
  passwordStatus.value = "";
  error.value = "";
  const response = await changePassword(passwordForm);
  if (response.ok === false) {
    error.value = response.error || response.message || "Password change failed.";
    return;
  }
  passwordForm.oldPassword = "";
  passwordForm.password = "";
  passwordForm.passwordConfirmation = "";
  passwordStatus.value = "Password changed.";
}
</script>

<template>
  <section class="vibe64-account-settings">
    <v-alert v-if="error" type="error" variant="tonal" density="compact">
      {{ error }}
    </v-alert>

    <section class="vibe64-account-settings__section">
      <h2>
        <v-icon :icon="mdiLockReset" size="20" />
        Password
      </h2>
      <form class="vibe64-account-settings__form" @submit.prevent="submitPasswordChange">
        <v-text-field
          v-model="passwordForm.oldPassword"
          autocomplete="current-password"
          label="Old password"
          required
          type="password"
          variant="outlined"
        />
        <v-text-field
          v-model="passwordForm.password"
          autocomplete="new-password"
          label="New password"
          required
          type="password"
          variant="outlined"
        />
        <v-text-field
          v-model="passwordForm.passwordConfirmation"
          autocomplete="new-password"
          label="Confirm new password"
          required
          type="password"
          variant="outlined"
        />
        <div class="vibe64-account-settings__actions">
          <v-btn color="primary" type="submit" variant="flat">Change password</v-btn>
          <span v-if="passwordStatus">{{ passwordStatus }}</span>
        </div>
      </form>
    </section>
  </section>
</template>

<style scoped>
.vibe64-account-settings {
  display: grid;
  gap: 1rem;
  margin: 0 auto;
  max-width: 58rem;
  padding: 1rem;
  width: 100%;
}

.vibe64-account-settings__section h2 {
  margin: 0;
}

.vibe64-account-settings__section {
  background: #ffffff;
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 8px;
  display: grid;
  gap: 0.9rem;
  padding: 1rem;
}

.vibe64-account-settings__section h2 {
  align-items: center;
  display: flex;
  font-size: 1rem;
  gap: 0.45rem;
}

.vibe64-account-settings__form {
  display: grid;
  gap: 0.8rem;
  max-width: 26rem;
}

.vibe64-account-settings__actions {
  align-items: center;
  display: flex;
  gap: 0.75rem;
}

.vibe64-account-settings__actions span,
.vibe64-account-settings__status {
  color: rgb(var(--v-theme-success));
  font-size: 0.9rem;
}
</style>
