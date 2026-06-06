<script setup>
import { computed, reactive, ref } from "vue";
import {
  mdiLockReset
} from "@mdi/js";
import AccountsSetup from "@/components/studio/AccountsSetup.vue";
import {
  useVibe64AppAuth
} from "@/composables/useVibe64AppAuth.js";
import {
  passwordResetRedirectTo,
  vibe64SupabaseClient
} from "@/lib/vibe64SupabaseAuth.js";

const passwordStatus = ref("");
const error = ref("");
const auth = useVibe64AppAuth();
const user = computed(() => auth?.state?.user || null);
const passwordForm = reactive({
  oldPassword: "",
  password: "",
  passwordConfirmation: ""
});

async function submitPasswordChange() {
  passwordStatus.value = "";
  error.value = "";
  if (passwordForm.password !== passwordForm.passwordConfirmation) {
    error.value = "Passwords do not match.";
    return;
  }
  try {
    const supabase = await vibe64SupabaseClient();
    const { error: updateError } = await supabase.auth.updateUser({
      currentPassword: passwordForm.oldPassword,
      password: passwordForm.password
    });
    if (updateError) {
      throw updateError;
    }
    passwordForm.oldPassword = "";
    passwordForm.password = "";
    passwordForm.passwordConfirmation = "";
    passwordStatus.value = "Password changed.";
  } catch (updateError) {
    error.value = String(updateError?.message || updateError || "Password change failed.");
  }
}

async function sendPasswordResetEmail() {
  passwordStatus.value = "";
  error.value = "";
  try {
    const email = String(user.value?.email || "").trim();
    if (!email) {
      throw new Error("Current user email is unavailable.");
    }
    const supabase = await vibe64SupabaseClient();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: passwordResetRedirectTo()
    });
    if (resetError) {
      throw resetError;
    }
    passwordStatus.value = "Password reset email sent.";
  } catch (resetError) {
    error.value = String(resetError?.message || resetError || "Password reset failed.");
  }
}
</script>

<template>
  <section class="vibe64-account-settings">
    <v-alert v-if="error" type="error" variant="tonal" density="compact">
      {{ error }}
    </v-alert>

    <AccountsSetup
      class="vibe64-account-settings__github"
      lede="Sign in with GitHub or create a GitHub account. Vibe64 uses this identity for issues, pull requests, commits, and merge actions across your workspaces."
      needed-label="GitHub required"
      :provider-ids="['github']"
      ready-label="GitHub connected"
      :show-continue="false"
      title="GitHub"
    />

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
          <v-btn type="button" variant="text" @click="sendPasswordResetEmail">Send reset email</v-btn>
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
  max-width: 68rem;
  padding: 1rem;
  width: 100%;
}

.vibe64-account-settings__github {
  width: 100%;
}

.vibe64-account-settings__github :deep(.accounts-setup__title) {
  font-size: 1.15rem;
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
