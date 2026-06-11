<script setup>
import {
  vibe64AuthScreenEmits,
  useVibe64AuthScreen,
  vibe64AuthScreenProps
} from "@/composables/useVibe64AuthScreen.js";

const props = defineProps(vibe64AuthScreenProps);
const emit = defineEmits(vibe64AuthScreenEmits);

const {
  awaitingEmailConfirmation,
  busy,
  error,
  form,
  icon,
  mode,
  passwordConfirmationVisible,
  passwordVisible,
  status,
  submit,
  submitLabel,
  switchMode,
  title
} = useVibe64AuthScreen(props, emit);
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
