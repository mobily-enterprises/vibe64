import { computed, onMounted, reactive, ref } from "vue";
import { useRoute } from "vue-router";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import {
  mdiAccountPlusOutline,
  mdiEmailFastOutline,
  mdiLoginVariant,
  mdiLockReset,
  mdiShieldAccountOutline
} from "@mdi/js";
import {
  VIBE64_SURFACE_ID
} from "@/lib/vibe64RequestConfig.js";
import {
  useVibe64SupabaseAuth
} from "@/composables/useVibe64SupabaseAuth.js";
import {
  emailRedirectTo,
  passwordResetRedirectTo
} from "@/lib/vibe64SupabaseAuth.js";

const vibe64AuthScreenEmits = ["authenticated"];
const vibe64AuthScreenProps = {
  ownerInvitePending: {
    type: Boolean,
    default: false
  },
  setupRequired: {
    type: Boolean,
    default: false
  }
};

function useVibe64AuthScreen(props, emit) {
  const route = useRoute();
  const {
    vibe64SupabaseClient
  } = useVibe64SupabaseAuth();

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
  const establishSessionCommand = useCommand({
    access: "never",
    apiSuffix: "/auth/supabase-session",
    buildRawPayload: (_model, { context }) => ({
      accessToken: String(context?.accessToken || "")
    }),
    fallbackRunError: "Local session could not be started.",
    messages: {
      error: "Local session could not be started."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.auth.supabase-session",
    suppressSuccessMessage: true,
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
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
    const requestedMode = String(route.query.mode || "").trim();
    if (requestedMode === "reset-password") {
      return "reset";
    }
    if (props.setupRequired || props.ownerInvitePending) {
      return "signup";
    }
    if (["login", "recovery", "signup"].includes(requestedMode)) {
      return requestedMode;
    }
    return "login";
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
    const response = await establishSessionCommand.run({
      accessToken
    });
    if (!response) {
      throw new Error("Local session could not be started.");
    }
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

  return {
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
  };
}

export {
  vibe64AuthScreenEmits,
  useVibe64AuthScreen,
  vibe64AuthScreenProps
};
