<script setup>
import { computed, onBeforeUnmount, provide, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
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
import {
  readAccountsStatus
} from "@/lib/studioGateApi.js";

const route = useRoute();
const router = useRouter();
const loading = ref(true);
const loadError = ref("");
const state = reactive({
  authenticated: false,
  setupRequired: false,
  user: null
});
const githubPrerequisite = reactive({
  checking: false
});
const githubPrerequisiteChecked = ref(false);
const githubPrerequisiteSatisfied = ref(false);
let lifecycleConnection = null;
let githubPrerequisiteRun = 0;

const authContext = {
  state,
  refresh,
  signOut
};
const authenticated = computed(() => state.authenticated === true && state.user);
const accountRouteActive = computed(() => normalizedPath(route.path) === "/account");
const configureRouteActive = computed(() => dashboardConfigurePath(normalizedPath(route.path)));
const githubPrerequisiteRouteActive = computed(() => accountRouteActive.value || configureRouteActive.value);

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
  const previousUserEmail = String(state.user?.email || "");
  const nextUserEmail = String(nextState.user?.email || "");
  state.authenticated = nextState.authenticated === true;
  state.setupRequired = nextState.setupRequired === true;
  state.user = nextState.user || null;
  if (!state.authenticated || previousUserEmail !== nextUserEmail) {
    githubPrerequisiteChecked.value = false;
    githubPrerequisiteSatisfied.value = false;
  }
}

function applyAuthenticated(response = {}) {
  applyState({
    authenticated: true,
    setupRequired: false,
    user: response.user || null
  });
}

function normalizedPath(pathValue = "") {
  const path = String(pathValue || "").trim();
  if (!path || path === "/") {
    return path || "/";
  }
  return path.replace(/\/+$/u, "");
}

function dashboardConfigurePath(pathValue = "") {
  return /^\/app\/[^/]+\/dashboard\/configure$/u.test(String(pathValue || ""));
}

function currentReturnPath() {
  const current = String(route.fullPath || route.path || "/app/manage").trim();
  if (!current || current === "/account" || current.startsWith("/account?")) {
    return "/app/manage";
  }
  return current;
}

function firstRouteParam(value) {
  const rawValue = Array.isArray(value) ? value[0] : value;
  return String(rawValue || "").trim();
}

function githubConfigurationPath() {
  const slug = firstRouteParam(route.params.slug);
  return slug ? `/app/${encodeURIComponent(slug)}/dashboard/configure` : "/account";
}

function githubConnected(status = {}) {
  const accounts = Array.isArray(status.accounts) ? status.accounts : [];
  return accounts.some((account) => (
    String(account?.id || "").toLowerCase() === "github" &&
    account?.connected === true
  ));
}

async function ensureGithubPrerequisite() {
  if (!authenticated.value) {
    githubPrerequisite.checking = false;
    return;
  }
  if (githubPrerequisiteRouteActive.value) {
    githubPrerequisite.checking = false;
    githubPrerequisiteChecked.value = false;
    return;
  }
  if (githubPrerequisiteChecked.value && githubPrerequisiteSatisfied.value) {
    return;
  }

  const runId = githubPrerequisiteRun + 1;
  githubPrerequisiteRun = runId;
  githubPrerequisite.checking = true;

  try {
    const status = await readAccountsStatus();
    if (runId !== githubPrerequisiteRun) {
      return;
    }
    githubPrerequisiteChecked.value = true;
    githubPrerequisiteSatisfied.value = githubConnected(status);
    if (!githubPrerequisiteSatisfied.value) {
      await router.replace({
        path: githubConfigurationPath(),
        query: {
          returnTo: currentReturnPath()
        }
      });
    }
  } catch {
    if (runId !== githubPrerequisiteRun) {
      return;
    }
    await router.replace({
      path: githubConfigurationPath(),
      query: {
        returnTo: currentReturnPath()
      }
    });
  } finally {
    if (runId === githubPrerequisiteRun) {
      githubPrerequisite.checking = false;
    }
  }
}

watch(authenticated, (active) => {
  lifecycleConnection?.close?.();
  lifecycleConnection = active ? connectBrowserLifecycleSocket() : null;
}, {
  immediate: true
});

watch(
  [authenticated, () => route.fullPath],
  () => {
    void ensureGithubPrerequisite();
  },
  {
    immediate: true
  }
);

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
