<script setup>
import { computed, onBeforeUnmount, provide, reactive, ref, watch } from "vue";
import {
  VIBE64_APP_AUTH_KEY
} from "@/composables/useVibe64AppAuth.js";
import {
  defineVibe64AsyncComponent
} from "@/lib/vibe64AsyncComponent.js";
import {
  markFirstLoginCodexSetupComplete,
  logout,
  readAuthState
} from "@/lib/vibe64AuthApi.js";
import {
  readAccountsStatus
} from "@/lib/studioGateApi.js";
import {
  vibe64SupabaseClient
} from "@/lib/vibe64SupabaseAuth.js";
import {
  connectBrowserLifecycleSocket
} from "@/lib/browserLifecycle.js";

const Vibe64AuthScreen = defineVibe64AsyncComponent({
  label: "Authentication screen",
  loader: () => import("./Vibe64AuthScreen.vue"),
  minHeight: "100dvh"
});
const Vibe64PrerequisiteSetup = defineVibe64AsyncComponent({
  label: "Setup screen",
  loader: () => import("./Vibe64PrerequisiteSetup.vue"),
  minHeight: "100dvh"
});

const loading = ref(true);
const loadError = ref("");
const state = reactive({
  authenticated: false,
  firstLoginCodexSetupPending: false,
  ownerInvitePending: false,
  setupRequired: false,
  user: null
});
const prerequisite = reactive({
  checked: false,
  checking: false,
  error: "",
  step: ""
});
let lifecycleConnection = null;
let prerequisiteRun = 0;

const authContext = {
  state,
  refresh,
  signOut
};
const authenticated = computed(() => state.authenticated === true && state.user);
const prerequisitesSatisfied = computed(() => (
  prerequisite.checked === true &&
  !prerequisite.step &&
  !prerequisite.error
));

provide(VIBE64_APP_AUTH_KEY, authContext);

async function refresh({
  quiet = false
} = {}) {
  if (!quiet) {
    loading.value = true;
  }
  loadError.value = "";
  try {
    applyState(await readAuthState());
  } catch (error) {
    loadError.value = String(error?.message || error || "Auth state could not load.");
  } finally {
    if (!quiet) {
      loading.value = false;
    }
  }
}

async function signOut() {
  try {
    const supabase = await vibe64SupabaseClient();
    await supabase.auth.signOut();
  } catch {
    // Local logout still clears the Vibe64 session.
  }
  await logout();
  applyState(await readAuthState());
}

function applyState(nextState = {}) {
  const previousUserEmail = String(state.user?.email || "");
  const nextUserEmail = String(nextState.user?.email || "");
  state.authenticated = nextState.authenticated === true;
  state.firstLoginCodexSetupPending = nextState.firstLoginCodexSetupPending === true;
  state.ownerInvitePending = nextState.ownerInvitePending === true;
  state.setupRequired = nextState.setupRequired === true;
  state.user = nextState.user || null;
  if (!state.authenticated || previousUserEmail !== nextUserEmail) {
    resetPrerequisiteState();
  }
}

async function applyAuthenticated() {
  await refresh();
}

function currentUserIsOwner() {
  return state.user?.owner === true || state.user?.role === "owner";
}

function resetPrerequisiteState() {
  prerequisiteRun += 1;
  prerequisite.checked = false;
  prerequisite.checking = false;
  prerequisite.error = "";
  prerequisite.step = "";
}

function accountConnected(status = {}, accountId = "") {
  const accounts = Array.isArray(status?.accounts) ? status.accounts : [];
  return accounts.some((account) => account?.id === accountId && account.connected === true);
}

async function ensurePrerequisites() {
  if (!authenticated.value) {
    resetPrerequisiteState();
    return;
  }

  const runId = prerequisiteRun + 1;
  prerequisiteRun = runId;
  prerequisite.checking = true;
  prerequisite.error = "";

  try {
    const accountsStatus = await readAccountsStatus();
    if (runId !== prerequisiteRun) {
      return;
    }
    if (accountsStatus?.ok === false) {
      throw new Error(accountsStatus.error || "Account status could not load.");
    }

    if (
      state.firstLoginCodexSetupPending === true &&
      currentUserIsOwner()
    ) {
      if (!accountConnected(accountsStatus, "codex")) {
        prerequisite.step = "codex";
        prerequisite.checked = true;
        return;
      }
      const completeResponse = await markFirstLoginCodexSetupComplete();
      if (runId !== prerequisiteRun) {
        return;
      }
      if (completeResponse.ok === false) {
        throw new Error(completeResponse.error || "Codex setup could not be completed.");
      }
      await refresh({
        quiet: true
      });
      if (runId !== prerequisiteRun) {
        return;
      }
    }

    if (!accountConnected(accountsStatus, "github")) {
      prerequisite.step = "github";
      prerequisite.checked = true;
      return;
    }

    prerequisite.step = "";
    prerequisite.checked = true;
  } catch (error) {
    if (runId !== prerequisiteRun) {
      return;
    }
    prerequisite.error = String(error?.message || error || "Setup status could not load.");
    prerequisite.step = "";
    prerequisite.checked = true;
  } finally {
    if (runId === prerequisiteRun) {
      prerequisite.checking = false;
    }
  }
}

async function continuePrerequisiteSetup() {
  const completedStep = prerequisite.step;
  prerequisite.checked = false;
  prerequisite.checking = true;
  prerequisite.error = "";
  try {
    await ensurePrerequisites();
  } catch (error) {
    prerequisite.error = String(error?.message || error || "Setup status could not load.");
    prerequisite.step = completedStep;
    prerequisite.checked = true;
    prerequisite.checking = false;
  }
}

watch(() => authenticated.value && prerequisitesSatisfied.value, (active) => {
  lifecycleConnection?.close?.();
  lifecycleConnection = active ? connectBrowserLifecycleSocket() : null;
}, {
  immediate: true
});

watch(
  authenticated,
  () => {
    void ensurePrerequisites();
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
