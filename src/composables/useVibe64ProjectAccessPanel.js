import { computed, ref } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import {
  mdiAccountAlertOutline,
  mdiAccountCheckOutline,
  mdiClose,
  mdiGithub,
  mdiRefresh
} from "@mdi/js";
import {
  VIBE64_SURFACE_ID
} from "@/lib/vibe64RequestConfig.js";
import {
  readRefOrGetterValue
} from "@/lib/vueRefOrGetterValue.js";
import {
  useVibe64ProjectAccessResource,
  vibe64ProjectAccessInvitePath
} from "@/composables/useVibe64ProjectManagement.js";

function useVibe64ProjectAccessPanel(project) {
  const actionBusy = ref("");
  const actionError = ref("");
  const currentProject = computed(() => readRefOrGetterValue(project) || {});
  const projectSlug = computed(() => String(currentProject.value?.slug || "").trim());
  const projectAccess = useVibe64ProjectAccessResource(projectSlug);
  const inviteAccessCommand = useCommand({
    access: "never",
    apiSuffix: "/vibe64/projects",
    buildCommandOptions: (_payload, { context }) => ({
      method: "POST",
      path: vibe64ProjectAccessInvitePath(context.slug)
    }),
    buildRawPayload: (_model, { context }) => ({
      email: context.email || "",
      permission: "push"
    }),
    fallbackRunError: "GitHub invite failed.",
    messages: {
      error: "GitHub invite failed.",
      success: "GitHub invite sent."
    },
    onRunSuccess: () => projectAccess.reload(),
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.project-access.invite",
    suppressSuccessMessage: true,
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });

  const repositoryName = computed(() => (
    projectAccess.status?.repository?.fullName ||
    currentProject.value?.githubRepository?.fullName ||
    ""
  ));
  const error = computed(() => String(
    actionError.value ||
    projectAccess.loadError ||
    (inviteAccessCommand.messageType === "error" ? inviteAccessCommand.message : "") ||
    ""
  ));

  async function inviteUser(row = {}) {
    const email = String(row.email || "").trim();
    if (!email) {
      return;
    }
    actionBusy.value = email;
    actionError.value = "";
    try {
      const response = await inviteAccessCommand.run({
        email,
        slug: projectSlug.value
      });
      if (response.ok === false) {
        throw new Error(response.errors?.[0]?.message || response.error || "GitHub invite failed.");
      }
    } catch (inviteError) {
      actionError.value = String(inviteError?.message || inviteError || "GitHub invite failed.");
    } finally {
      actionBusy.value = "";
    }
  }

  return {
    accessColor,
    accessLabel,
    actionBusy,
    canInvite,
    error,
    inviteUser,
    mdiAccountAlertOutline,
    mdiAccountCheckOutline,
    mdiClose,
    mdiGithub,
    mdiRefresh,
    projectAccess,
    repositoryName
  };

  function canInvite(row = {}) {
    return projectAccess.canManageAccess &&
      row.status === "active" &&
      row.github?.login &&
      row.access?.canPush !== true;
  }
}

function accessLabel(row = {}) {
  const access = row.access || {};
  if (access.status === "github-not-connected") {
    return "Connect GitHub";
  }
  if (access.status === "inactive") {
    return "Inactive";
  }
  if (access.status === "no-access") {
    return "No access";
  }
  if (access.permission) {
    return access.permission.toLowerCase();
  }
  return "Unknown";
}

function accessColor(row = {}) {
  const access = row.access || {};
  if (access.canPush) {
    return "success";
  }
  if (access.canRead) {
    return "info";
  }
  if (access.status === "no-access") {
    return "warning";
  }
  return "default";
}

export {
  useVibe64ProjectAccessPanel
};
