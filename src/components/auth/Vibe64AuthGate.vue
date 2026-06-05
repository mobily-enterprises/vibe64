<script setup>
import { computed, onBeforeUnmount, provide, reactive, ref, watch } from "vue";
import Vibe64AuthScreen from "./Vibe64AuthScreen.vue";
import {
  VIBE64_APP_AUTH_KEY
} from "@/composables/useVibe64AppAuth.js";
import {
  logout,
  readAuthState
} from "@/lib/vibe64AuthApi.js";
import {
  connectBrowserLifecycleSocket
} from "@/lib/browserLifecycle.js";

const loading = ref(true);
const loadError = ref("");
const state = reactive({
  authenticated: false,
  setupRequired: false,
  user: null
});
let lifecycleConnection = null;

const authContext = {
  state,
  refresh,
  signOut
};
const authenticated = computed(() => state.authenticated === true && state.user);

provide(VIBE64_APP_AUTH_KEY, authContext);

async function refresh() {
  loading.value = true;
  loadError.value = "";
  try {
    applyState(await readAuthState());
  } catch (error) {
    loadError.value = String(error?.message || error || "Auth state could not load.");
  } finally {
    loading.value = false;
  }
}

async function signOut() {
  await logout();
  applyState(await readAuthState());
}

function applyState(nextState = {}) {
  state.authenticated = nextState.authenticated === true;
  state.setupRequired = nextState.setupRequired === true;
  state.user = nextState.user || null;
}

function applyAuthenticated(response = {}) {
  applyState({
    authenticated: true,
    setupRequired: false,
    user: response.user || null
  });
}

watch(authenticated, (active) => {
  lifecycleConnection?.close?.();
  lifecycleConnection = active ? connectBrowserLifecycleSocket() : null;
}, {
  immediate: true
});

onBeforeUnmount(() => {
  lifecycleConnection?.close?.();
  lifecycleConnection = null;
});

void refresh();
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
    :setup-required="state.setupRequired"
    @authenticated="applyAuthenticated"
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
