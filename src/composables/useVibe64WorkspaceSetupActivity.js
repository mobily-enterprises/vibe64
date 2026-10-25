import { computed, ref, watch } from "vue";

function text(value = "") {
  return String(value || "").trim();
}

/** The selected session's workspace preparation status, its activity card and Retry. */
function useVibe64WorkspaceSetupActivity(props, {
  actorKey,
  dismissals,
  projectSlug,
  retryBlocked,
  sessionId
}) {
  const workspaceSetupRetryError = ref("");
  const workspaceSetupRetrying = ref(false);
  const workspaceSetup = computed(() => {
    const value = props.session?.workspaceSetup;
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  });
  const workspaceSetupStatus = computed(() => {
    const status = text(workspaceSetup.value?.status);
    if (status === "required" && ["queued", "running", "starting"].includes(
      text(props.workState?.updateOperation?.status)
    )) return "pending";
    return ["ambiguous", "failed", "required", "running", "succeeded"].includes(status)
      ? status
      : "unconfigured";
  });
  const workspaceSetupActivityKey = computed(() => {
    const operationKey = text(
      workspaceSetup.value?.startedAt || workspaceSetup.value?.updatedAt
    );
    return operationKey ? `workspace-setup:${operationKey}` : "";
  });
  const workspaceSetupDismissed = computed(() => Boolean(
    workspaceSetupActivityKey.value &&
    dismissals.state.value.workspaceSetup === workspaceSetupActivityKey.value
  ));
  const workspaceSetupRunning = computed(() => ["pending", "running"].includes(workspaceSetupStatus.value));
  const workspaceSetupActionVisible = computed(() => Boolean(
    sessionId.value && workspaceSetupStatus.value !== "unconfigured"
  ));
  // Preparation brings each connected repository up to its branch, so a
  // consuming session offers it again under that name.
  const connectedRepositoryCount = computed(() => {
    try {
      return JSON.parse(props.session?.metadata?.connected_sources || "null")?.sources?.length || 0;
    } catch {
      return 0;
    }
  });
  const connectedUpdateActionVisible = computed(() => workspaceSetupActionVisible.value && connectedRepositoryCount.value > 0);
  const workspaceSetupNeedsAttention = computed(() => (
    ["failed", "ambiguous", "required"].includes(workspaceSetupStatus.value)
  ));
  const workspaceSetupDiagnostic = computed(() => (
    workspaceSetupRetryError.value || text(workspaceSetup.value?.diagnostic)
  ));
  const workspaceSetupOutput = computed(() => (
    text(workspaceSetup.value?.transcript) || workspaceSetupDiagnostic.value
  ));
  const workspaceSetupTitle = computed(() => ({
    ambiguous: "Workspace setup needs a choice",
    failed: "Workspace preparation failed",
    required: "Workspace preparation required",
    pending: "Waiting for session update…",
    running: "Preparing workspace…",
    succeeded: "Workspace prepared"
  })[workspaceSetupStatus.value] || "");
  const workspaceSetupCurrentLabel = computed(() => {
    if (workspaceSetupStatus.value === "required") return workspaceSetupDiagnostic.value;
    if (workspaceSetupStatus.value === "pending") return "Workspace preparation will start automatically after the update.";
    return workspaceSetupRunning.value ? text(workspaceSetup.value?.currentLabel) : "";
  });
  const workspaceSetupError = computed(() => workspaceSetupRetryError.value ||
    (workspaceSetupNeedsAttention.value && workspaceSetupStatus.value !== "required" ? workspaceSetupDiagnostic.value : ""));
  const workspaceSetupRetryDisabled = computed(() => Boolean(
    workspaceSetupRunning.value ||
    workspaceSetupRetrying.value ||
    retryBlocked.value ||
    !sessionId.value ||
    props.sessionSelectionArchived
  ));

  async function retryWorkspaceSetup() {
    if (workspaceSetupRetryDisabled.value) {
      return false;
    }
    dismissals.clear("workspaceSetup");
    workspaceSetupRetryError.value = "";
    workspaceSetupRetrying.value = true;
    try {
      return await props.retryWorkspaceSetup() !== false;
    } catch (error) {
      workspaceSetupRetryError.value = text(error?.message || error) ||
        "Workspace preparation could not be started.";
      return false;
    } finally {
      workspaceSetupRetrying.value = false;
    }
  }

  function dismissWorkspaceSetupActivity() {
    return dismissals.dismiss("workspaceSetup", workspaceSetupActivityKey.value);
  }

  watch([sessionId, projectSlug, actorKey], () => {
    workspaceSetupRetryError.value = "";
  });

  watch(() => workspaceSetup.value?.updatedAt, () => {
    workspaceSetupRetryError.value = "";
  });

  return {
    connectedUpdateActionVisible,
    dismissWorkspaceSetupActivity,
    retryWorkspaceSetup,
    workspaceSetup,
    workspaceSetupActionVisible,
    workspaceSetupActivityKey,
    workspaceSetupCurrentLabel,
    workspaceSetupDiagnostic,
    workspaceSetupDismissed,
    workspaceSetupError,
    workspaceSetupNeedsAttention,
    workspaceSetupOutput,
    workspaceSetupRetryDisabled,
    workspaceSetupRetrying,
    workspaceSetupRunning,
    workspaceSetupStatus,
    workspaceSetupTitle
  };
}

export { useVibe64WorkspaceSetupActivity };
