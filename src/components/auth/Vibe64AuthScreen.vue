<script setup>
import { computed, reactive, ref } from "vue";
import {
  mdiAccountPlusOutline,
  mdiLoginVariant,
  mdiShieldAccountOutline
} from "@mdi/js";
import {
  claimInvite,
  login,
  setupOwner
} from "@/lib/vibe64AuthApi.js";

const props = defineProps({
  setupRequired: {
    type: Boolean,
    default: false
  }
});
const emit = defineEmits(["authenticated"]);

const mode = ref(props.setupRequired ? "setup" : "login");
const busy = ref(false);
const error = ref("");
const fixedEmail = ref("");
const form = reactive({
  email: "",
  password: "",
  passwordConfirmation: ""
});

const title = computed(() => {
  if (mode.value === "setup") {
    return "Create owner";
  }
  if (mode.value === "claim") {
    return "Set password";
  }
  return "Log in";
});
const icon = computed(() => {
  if (mode.value === "setup") {
    return mdiShieldAccountOutline;
  }
  return mode.value === "claim" ? mdiAccountPlusOutline : mdiLoginVariant;
});
const emailDisabled = computed(() => mode.value === "claim");
const submitLabel = computed(() => {
  if (mode.value === "setup") {
    return "Create owner";
  }
  if (mode.value === "claim") {
    return "Set password";
  }
  return "Log in";
});
const passwordConfirmationVisible = computed(() => mode.value !== "login");

async function submit() {
  busy.value = true;
  error.value = "";
  try {
    const input = {
      email: mode.value === "claim" ? fixedEmail.value : form.email,
      password: form.password,
      passwordConfirmation: form.passwordConfirmation
    };
    const response = mode.value === "setup"
      ? await setupOwner(input)
      : mode.value === "claim"
        ? await claimInvite(input)
        : await login(input);

    if (response.ok === true) {
      emit("authenticated", response);
      return;
    }
    if (response.claimRequired && response.email) {
      fixedEmail.value = response.email;
      form.email = response.email;
      form.password = "";
      form.passwordConfirmation = "";
      mode.value = "claim";
      return;
    }
    error.value = response.error || response.message || "Authentication failed.";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <main class="vibe64-auth-screen">
    <form class="vibe64-auth-screen__panel" @submit.prevent="submit">
      <v-icon class="vibe64-auth-screen__icon" :icon="icon" size="42" />
      <h1>{{ title }}</h1>
      <v-alert v-if="error" type="error" variant="tonal" density="compact">
        {{ error }}
      </v-alert>
      <v-text-field
        v-model="form.email"
        autocomplete="email"
        :disabled="emailDisabled"
        label="Email"
        required
        type="email"
        variant="outlined"
      />
      <v-text-field
        v-model="form.password"
        autocomplete="current-password"
        label="Password"
        required
        type="password"
        variant="outlined"
      />
      <v-text-field
        v-if="passwordConfirmationVisible"
        v-model="form.passwordConfirmation"
        autocomplete="new-password"
        label="Confirm password"
        required
        type="password"
        variant="outlined"
      />
      <v-btn
        block
        color="primary"
        :loading="busy"
        type="submit"
        variant="flat"
      >
        {{ submitLabel }}
      </v-btn>
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
</style>
