import { computed, proxyRefs, reactive, ref } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import { useEndpointResource } from "@jskit-ai/users-web/client/composables/useEndpointResource";
import {
  useVibe64AppAuth
} from "@/composables/useVibe64AppAuth.js";
import {
  vibe64ResourceResponseError
} from "@/lib/vibe64ApiResponses.js";
import {
  AUTH_INVITE_CANCEL_ENDPOINT,
  AUTH_INVITE_ENDPOINT,
  AUTH_USER_REVOKE_ENDPOINT,
  AUTH_USERS_ENDPOINT
} from "@/lib/vibe64AuthApi.js";

function useVibe64UsersResource() {
  const resource = useEndpointResource({
    fallbackLoadError: "Users could not load.",
    path: AUTH_USERS_ENDPOINT,
    queryKey: ["vibe64", "auth", "users"],
    refreshOnPull: true,
    requestRecoveryLabel: "Users"
  });
  const loadError = computed(() => vibe64ResourceResponseError(resource.data.value, "Users could not load.") || resource.loadError.value);
  const users = computed(() => Array.isArray(resource.data.value?.users) ? resource.data.value.users : []);

  return proxyRefs({
    data: resource.data,
    isFetching: resource.isFetching,
    isInitialLoading: resource.isInitialLoading,
    isLoading: resource.isLoading,
    isRefetching: resource.isRefetching,
    loadError,
    reload: resource.reload,
    resource,
    users
  });
}

function useVibe64UserManagement() {
  const auth = useVibe64AppAuth();
  const userList = useVibe64UsersResource();
  const inviteStatus = ref("");
  const inviteWarning = ref("");
  const actionError = ref("");
  const actionBusy = ref("");
  const inviteForm = reactive({
    email: ""
  });

  const inviteCommand = useUserManagementCommand({
    endpoint: AUTH_INVITE_ENDPOINT,
    fallbackRunError: "Invite failed.",
    placementSource: "vibe64.users.invite"
  });
  const cancelInviteCommand = useUserManagementCommand({
    endpoint: AUTH_INVITE_CANCEL_ENDPOINT,
    fallbackRunError: "Invite cancel failed.",
    placementSource: "vibe64.users.invite.cancel"
  });
  const revokeUserCommand = useUserManagementCommand({
    endpoint: AUTH_USER_REVOKE_ENDPOINT,
    fallbackRunError: "User removal failed.",
    placementSource: "vibe64.users.revoke"
  });

  const canManageUsers = computed(() => auth?.state?.user?.owner === true || auth?.state?.user?.role === "owner");
  const error = computed(() => String(
    actionError.value ||
    commandError(inviteCommand) ||
    commandError(cancelInviteCommand) ||
    commandError(revokeUserCommand) ||
    userList.loadError ||
    ""
  ));

  function commandError(command = {}) {
    return command.messageType === "error" ? String(command.message || "") : "";
  }

  function clearMessages() {
    inviteStatus.value = "";
    inviteWarning.value = "";
    actionError.value = "";
  }

  async function submitInvite() {
    if (!canManageUsers.value) {
      actionError.value = "Only owners can invite Vibe64 users.";
      return;
    }
    clearMessages();
    actionBusy.value = "invite";
    try {
      const response = await inviteCommand.run({
        email: inviteForm.email
      });
      if (response?.ok === false) {
        actionError.value = response.error || response.message || "Invite failed.";
        return;
      }
      inviteForm.email = "";
      applyInviteResponseMessage(response || {});
      await userList.reload();
    } finally {
      actionBusy.value = "";
    }
  }

  function applyInviteResponseMessage(response = {}) {
    const inviteEmail = response.inviteEmail || {};
    if (response.user?.status === "active") {
      inviteStatus.value = "User is already active.";
    } else if (inviteEmail.ok === true && inviteEmail.attempted === true) {
      inviteStatus.value = "User invited and email sent.";
    } else if (inviteEmail.ok === false) {
      inviteStatus.value = "User invited.";
      inviteWarning.value = `Supabase invite email was not sent: ${inviteEmail.error || "unknown error"}`;
    } else {
      inviteStatus.value = "User invited.";
    }
  }

  async function cancelUserInvite(row = {}) {
    await runUserAction(row, cancelInviteCommand, "Invite canceled.");
  }

  async function removeUser(row = {}) {
    await runUserAction(row, revokeUserCommand, "User removed.");
  }

  async function runUserAction(row = {}, command, successMessage = "") {
    if (!canManageUsers.value) {
      actionError.value = "Only owners can manage Vibe64 users.";
      return;
    }
    clearMessages();
    const email = String(row.email || "").trim();
    if (!email) {
      return;
    }
    actionBusy.value = email;
    try {
      const response = await command.run({
        email
      });
      if (response?.ok === false) {
        actionError.value = response.error || response.message || "User update failed.";
        return;
      }
      inviteStatus.value = successMessage;
      await userList.reload();
    } finally {
      actionBusy.value = "";
    }
  }

  function statusLabel(row = {}) {
    if (row.status === "active") {
      return row.identityLinked ? "Active" : "Active, identity pending";
    }
    if (row.status === "invited") {
      return "Invited";
    }
    return row.status || "Unknown";
  }

  function githubLabel(row = {}) {
    const login = String(row.github?.login || "").trim();
    return login ? `@${login}` : "Not linked";
  }

  return proxyRefs({
    actionBusy,
    cancelUserInvite,
    canManageUsers,
    error,
    githubLabel,
    inviteForm,
    inviteStatus,
    inviteWarning,
    removeUser,
    statusLabel,
    submitInvite,
    userList
  });
}

function useUserManagementCommand({
  endpoint = "",
  fallbackRunError = "User update failed.",
  placementSource = "vibe64.users.command"
} = {}) {
  return useCommand({
    access: "never",
    apiSuffix: "/auth",
    buildRawPayload: (_model, { context }) => ({
      email: String(context?.email || "")
    }),
    buildCommandOptions: () => ({
      method: "POST",
      path: endpoint
    }),
    fallbackRunError,
    messages: {
      error: fallbackRunError
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource,
    suppressSuccessMessage: true,
    writeMethod: "POST"
  });
}

export {
  AUTH_USERS_ENDPOINT,
  useVibe64UserManagement,
  useVibe64UsersResource
};
