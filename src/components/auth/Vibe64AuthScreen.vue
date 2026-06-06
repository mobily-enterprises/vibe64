<script setup>
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute } from "vue-router";
import {
  mdiAccountPlusOutline,
  mdiEmailFastOutline,
  mdiLoginVariant,
  mdiLockReset,
  mdiShieldAccountOutline
} from "@mdi/js";
import {
  establishSupabaseSession
} from "@/lib/vibe64AuthApi.js";
import {
  emailRedirectTo,
  passwordResetRedirectTo,
  vibe64SupabaseClient
} from "@/lib/vibe64SupabaseAuth.js";

const props = defineProps({
  ownerInvitePending: {
    type: Boolean,
    default: false
  },
  setupRequired: {
    type: Boolean,
    default: false
  }
});
const emit = defineEmits(["authenticated"]);
const route = useRoute();

const mode = ref(initialMode());
const busy = ref(false);
const error = ref("");
const status = ref("");
const awaitingEmailConfirmation = ref(false);
const form = reactive({
  email: "",
  password: "",
  passwordConfirmation: ""
});

const title = computed(() => {
  if (awaitingEmailConfirmation.value) {
    return "Check your email";
  }
  if (mode.value === "signup" && props.ownerInvitePending) {
    return "Accept owner invite";
  }
  if (mode.value === "signup" && props.setupRequired) {
    return "Create owner";
  }
  if (mode.value === "signup") {
    return "Create account";
  }
  if (mode.value === "recovery") {
    return "Reset password";
  }
  if (mode.value === "reset") {
    return "Set new password";
  }
  return "Log in";
});
const icon = computed(() => {
  if (awaitingEmailConfirmation.value) {
    return mdiEmailFastOutline;
  }
  if (mode.value === "signup" && (props.setupRequired || props.ownerInvitePending)) {
    return mdiShieldAccountOutline;
  }
  if (mode.value === "signup") {
    return mdiAccountPlusOutline;
  }
  if (mode.value === "recovery") {
    return mdiEmailFastOutline;
  }
  return mode.value === "reset" ? mdiLockReset : mdiLoginVariant;
});
const passwordVisible = computed(() => ["login", "signup", "reset"].includes(mode.value));
const passwordConfirmationVisible = computed(() => ["signup", "reset"].includes(mode.value));
const submitLabel = computed(() => {
  if (mode.value === "signup" && props.ownerInvitePending) {
    return "Accept invite";
  }
  if (mode.value === "signup" && props.setupRequired) {
    return "Create owner";
  }
  if (mode.value === "signup") {
    return "Create account";
  }
  if (mode.value === "recovery") {
    return "Send reset email";
  }
  if (mode.value === "reset") {
    return "Set password";
  }
  return "Log in";
});

function initialMode() {
  return String(route.query.mode || "") === "reset-password"
    ? "reset"
    : props.setupRequired || props.ownerInvitePending
      ? "signup"
      : "login";
}

async function submit() {
  busy.value = true;
  error.value = "";
  status.value = "";
  try {
    if (mode.value === "signup") {
      await signUp();
      return;
    }
    if (mode.value === "recovery") {
      await sendRecoveryEmail();
      return;
    }
    if (mode.value === "reset") {
      await updatePassword();
      return;
    }
    await signIn();
  } catch (submitError) {
    error.value = String(submitError?.message || submitError || "Authentication failed.");
  } finally {
    busy.value = false;
  }
}

async function signIn() {
  const supabase = await vibe64SupabaseClient();
  const { data, error: signInError } = await supabase.auth.signInWithPassword({
    email: form.email,
    password: form.password
  });
  if (signInError) {
    throw signInError;
  }
  await establishLocalSession(data.session);
}

async function signUp() {
  assertPasswordsMatch();
  const supabase = await vibe64SupabaseClient();
  const { data, error: signUpError } = await supabase.auth.signUp({
    email: form.email,
    password: form.password,
    options: {
      emailRedirectTo: emailRedirectTo()
    }
  });
  if (signUpError) {
    throw signUpError;
  }
  if (data.session) {
    await establishLocalSession(data.session);
    return;
  }
  awaitingEmailConfirmation.value = true;
  form.password = "";
  form.passwordConfirmation = "";
  status.value = "Check your email to finish account setup.";
}

async function sendRecoveryEmail() {
  const supabase = await vibe64SupabaseClient();
  const { error: recoveryError } = await supabase.auth.resetPasswordForEmail(form.email, {
    redirectTo: passwordResetRedirectTo()
  });
  if (recoveryError) {
    throw recoveryError;
  }
  status.value = "Password reset email sent.";
}

async function updatePassword() {
  assertPasswordsMatch();
  const supabase = await vibe64SupabaseClient();
  const { error: updateError } = await supabase.auth.updateUser({
    password: form.password
  });
  if (updateError) {
    throw updateError;
  }
  const { data } = await supabase.auth.getSession();
  await establishLocalSession(data.session);
}

async function establishLocalSession(session) {
  const accessToken = String(session?.access_token || "").trim();
  if (!accessToken) {
    throw new Error("Supabase did not return an active session.");
  }
  const response = await establishSupabaseSession({
    accessToken
  });
  if (response.ok === false) {
    throw new Error(response.error || response.message || "This user is not allowed on this Vibe64 instance.");
  }
  emit("authenticated", response);
}

function assertPasswordsMatch() {
  if (form.password !== form.passwordConfirmation) {
    throw new Error("Passwords do not match.");
  }
}

function switchMode(nextMode) {
  mode.value = nextMode;
  awaitingEmailConfirmation.value = false;
  error.value = "";
  status.value = "";
  form.password = "";
  form.passwordConfirmation = "";
}

onMounted(async () => {
  if (mode.value === "reset") {
    return;
  }
  try {
    const supabase = await vibe64SupabaseClient();
    const { data } = await supabase.auth.getSession();
    if (data.session) {
      await establishLocalSession(data.session);
    }
  } catch {
    // The visible form remains the recovery path.
  }
});
</script>

<template>
  <main class="vibe64-auth-screen">
    <form class="vibe64-auth-screen__panel" @submit.prevent="submit">
      <v-icon class="vibe64-auth-screen__icon" :icon="icon" size="42" />
      <h1>{{ title }}</h1>
      <v-alert v-if="error" type="error" variant="tonal" density="compact">
        {{ error }}
      </v-alert>
      <v-alert v-if="status" type="success" variant="tonal" density="compact">
        {{ status }}
      </v-alert>
      <p
        v-if="!awaitingEmailConfirmation && props.ownerInvitePending"
        class="vibe64-auth-screen__confirmation"
      >
        This Vibe64 instance is waiting for its invited owner. Use the invited
        owner email address to create or log in to a Supabase account.
      </p>
      <p
        v-if="awaitingEmailConfirmation"
        class="vibe64-auth-screen__confirmation"
      >
        We sent a confirmation link to {{ form.email }}. Confirm the address,
        then return here to log in.
      </p>
      <v-text-field
        v-if="!awaitingEmailConfirmation && mode !== 'reset'"
        v-model="form.email"
        autocomplete="email"
        label="Email"
        required
        type="email"
        variant="outlined"
      />
      <v-text-field
        v-if="!awaitingEmailConfirmation && passwordVisible"
        v-model="form.password"
        :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
        :label="mode === 'reset' ? 'New password' : 'Password'"
        required
        type="password"
        variant="outlined"
      />
      <v-text-field
        v-if="!awaitingEmailConfirmation && passwordConfirmationVisible"
        v-model="form.passwordConfirmation"
        autocomplete="new-password"
        :label="mode === 'reset' ? 'Confirm new password' : 'Confirm password'"
        required
        type="password"
        variant="outlined"
      />
      <v-btn
        v-if="!awaitingEmailConfirmation"
        block
        color="primary"
        :loading="busy"
        type="submit"
        variant="flat"
      >
        {{ submitLabel }}
      </v-btn>
      <div class="vibe64-auth-screen__links">
        <v-btn
          v-if="awaitingEmailConfirmation || mode !== 'login'"
          size="small"
          type="button"
          variant="text"
          @click="switchMode('login')"
        >
          Log in
        </v-btn>
        <v-btn
          v-if="!awaitingEmailConfirmation && mode !== 'signup'"
          size="small"
          type="button"
          variant="text"
          @click="switchMode('signup')"
        >
          Create account
        </v-btn>
        <v-btn
          v-if="mode !== 'recovery'"
          size="small"
          type="button"
          variant="text"
          @click="switchMode('recovery')"
        >
          Forgot password
        </v-btn>
      </div>
    </form>
  </main>
</template>

<style scoped>
.vibe64-auth-screen {
  align-items: center;
  background: #f6f7f9;
  display: flex;
  min-height: 100dvh;
  justify-content: center;
  padding: 1rem;
}

.vibe64-auth-screen__panel {
  background: #ffffff;
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 8px;
  box-shadow: 0 16px 40px rgba(15, 23, 42, 0.08);
  display: grid;
  gap: 0.8rem;
  max-width: 24rem;
  padding: 1.4rem;
  width: min(100%, 24rem);
}

.vibe64-auth-screen__icon {
  color: rgb(var(--v-theme-primary));
}

.vibe64-auth-screen h1 {
  font-size: 1.35rem;
  font-weight: 720;
  line-height: 1.2;
  margin: 0 0 0.2rem;
}

.vibe64-auth-screen__confirmation {
  color: rgba(15, 23, 42, 0.72);
  font-size: 0.94rem;
  line-height: 1.5;
  margin: 0;
}

.vibe64-auth-screen__links {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  justify-content: center;
}
</style>
