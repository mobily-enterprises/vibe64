import { computed, onBeforeUnmount, provide, reactive, ref, watch } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import { useEndpointResource } from "@jskit-ai/users-web/client/composables/useEndpointResource";
import {
  VIBE64_APP_AUTH_KEY
} from "@/composables/useVibe64AppAuth.js";
import {
  defineVibe64AsyncComponent
} from "@/lib/vibe64AsyncComponent.js";
import {
  AUTH_STATE_ENDPOINT
} from "@/lib/vibe64AuthApi.js";
import {
  VIBE64_SURFACE_ID
} from "@/lib/vibe64RequestConfig.js";
import {
  ACCOUNTS_ENDPOINT
} from "@/lib/studioGateApi.js";
import {
  useVibe64SupabaseAuth
} from "@/composables/useVibe64SupabaseAuth.js";
import {
  connectBrowserLifecycleSocket
} from "@/lib/browserLifecycle.js";
import {
  vibe64ResourceResponseError
} from "@/lib/vibe64ApiResponses.js";
import {
  prerequisiteAccountStatusReadQuery
} from "@/lib/vibe64AuthGatePrerequisites.js";

const Vibe64AuthScreen = defineVibe64AsyncComponent({
  label: "Authentication screen",
  loader: () => import("@/components/auth/Vibe64AuthScreen.vue"),
  minHeight: "100dvh"
});
const Vibe64PrerequisiteSetup = defineVibe64AsyncComponent({
  label: "Setup screen",
  loader: () => import("@/components/auth/Vibe64PrerequisiteSetup.vue"),
  minHeight: "100dvh"
});

function useVibe64AuthGate() {
  const loading = ref(true);
  const loadError = ref("");
  const state = reactive({
    authenticated: false,
    firstLoginCodexSetupPending: false,
    ownerInvitePending: false,
    runtime: null,
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
  const {
    vibe64SupabaseClient
  } = useVibe64SupabaseAuth();
  const authStateResource = useEndpointResource({
    enabled: false,
    fallbackLoadError: "Auth state could not load.",
    path: AUTH_STATE_ENDPOINT,
    queryKey: ["vibe64", "auth", "state"],
    refreshOnPull: true,
    requestRecoveryLabel: "Authentication state"
  });
  const accountStatusResource = useEndpointResource({
    enabled: false,
    fallbackLoadError: "Account status could not load.",
    path: ACCOUNTS_ENDPOINT,
    queryKey: ["vibe64", "auth", "prerequisite-account-status"],
    readQuery: computed(prerequisiteAccountStatusReadQuery),
    refreshOnPull: true,
    requestRecoveryLabel: "Account status"
  });
  const logoutCommand = useAuthGateCommand({
    apiSuffix: "/auth/logout",
    fallbackRunError: "Logout failed.",
    placementSource: "vibe64.auth.logout"
  });
  const completeCodexSetupCommand = useAuthGateCommand({
    apiSuffix: "/auth/setup/codex-complete",
    fallbackRunError: "Codex setup could not be completed.",
    placementSource: "vibe64.auth.codex-setup-complete"
  });

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

  return {
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
  };

  async function refresh({
    quiet = false
  } = {}) {
    if (!quiet) {
      loading.value = true;
    }
    loadError.value = "";
    try {
      const result = await authStateResource.reload();
      const response = result?.data || authStateResource.data.value || null;
      const responseError = vibe64ResourceResponseError(response, "Auth state could not load.") || authStateResource.loadError.value;
      if (responseError) {
        throw new Error(responseError);
      }
      applyState(response);
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
    await logoutCommand.run();
    await refresh();
  }

  function applyState(nextState = {}) {
    const previousUserEmail = String(state.user?.email || "");
    const nextUserEmail = String(nextState.user?.email || "");
    state.authenticated = nextState.authenticated === true;
    state.firstLoginCodexSetupPending = nextState.firstLoginCodexSetupPending === true;
    state.ownerInvitePending = nextState.ownerInvitePending === true;
    state.runtime = nextState.runtime || null;
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
      const result = await accountStatusResource.reload();
      if (runId !== prerequisiteRun) {
        return;
      }
      const accountsStatus = result?.data || accountStatusResource.data.value || null;
      const accountsStatusError = vibe64ResourceResponseError(accountsStatus, "Account status could not load.") || accountStatusResource.loadError.value;
      if (accountsStatusError) {
        throw new Error(accountsStatusError);
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
        const completeResponse = await completeCodexSetupCommand.run();
        if (runId !== prerequisiteRun) {
          return;
        }
        if (!completeResponse) {
          throw new Error("Codex setup could not be completed.");
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
}

function useAuthGateCommand({
  apiSuffix = "",
  fallbackRunError = "Request failed.",
  placementSource = "vibe64.auth.command"
} = {}) {
  return useCommand({
    access: "never",
    apiSuffix,
    buildCommandPayload: () => undefined,
    fallbackRunError,
    messages: {
      error: fallbackRunError
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource,
    suppressSuccessMessage: true,
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });
}

export {
  useVibe64AuthGate
};
