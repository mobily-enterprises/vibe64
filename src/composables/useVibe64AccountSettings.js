import { computed, reactive, ref } from "vue";
import {
  useVibe64AppAuth
} from "@/composables/useVibe64AppAuth.js";
import {
  useVibe64SupabaseAuth
} from "@/composables/useVibe64SupabaseAuth.js";
import {
  supabaseAccountControlsEnabled
} from "@/lib/vibe64AccountSettingsCapabilities.js";
import {
  passwordResetRedirectTo
} from "@/lib/vibe64SupabaseAuth.js";

function useVibe64AccountSettings() {
  const passwordStatus = ref("");
  const error = ref("");
  const auth = useVibe64AppAuth();
  const {
    vibe64SupabaseClient
  } = useVibe64SupabaseAuth();
  const user = computed(() => auth?.state?.user || null);
  const supabaseControlsEnabled = computed(() => supabaseAccountControlsEnabled(auth?.state?.runtime || null));
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

  return {
    error,
    passwordForm,
    passwordStatus,
    sendPasswordResetEmail,
    supabaseControlsEnabled,
    submitPasswordChange
  };
}

export {
  useVibe64AccountSettings
};
