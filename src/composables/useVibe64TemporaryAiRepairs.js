import { computed, nextTick, ref, watch } from "vue";
import { vibe64RequestAccepted } from "@/lib/vibe64ApiResponses.js";

function text(value = "") {
  return String(value || "").trim();
}

function workspaceSetupFixPrompt(workspaceSetup = {}) {
  const diagnostic = text(workspaceSetup?.diagnostic) ||
    "Workspace preparation did not complete.";
  const transcript = text(workspaceSetup?.transcript);
  const recentTranscript = transcript.length > 12_000
    ? `[Earlier preparation output omitted.]\n${transcript.slice(-12_000)}`
    : transcript;
  return [
    "Workspace preparation needs attention.",
    `Diagnostic:\n${diagnostic}`,
    recentTranscript ? `Recent preparation output:\n${recentTranscript}` : "",
    "Diagnose and repair the current workspace while preserving its existing work.",
    "When your turn finishes, Vibe64 will automatically rerun its deterministic workspace preparation. Do not merely tell the user to retry.",
    "If the repair needs information only the user can provide, ask for it in this temporary conversation."
  ].filter(Boolean).join("\n\n");
}

function previewIdentityFixPrompt({
  error = "",
  identity = {}
} = {}) {
  const name = text(identity?.name) || "configured identity";
  const type = text(identity?.type) || "selector";
  const value = text(identity?.value) || "unknown";
  const diagnostic = text(error) || "The application rejected the identity.";
  return [
    `The managed preview could not sign in as \`${name}\` (${type}: \`${value}\`):`,
    diagnostic,
    "Please diagnose and fix this in the current application. Ensure its app-owned, idempotent development seed creates this user profile and any workspace membership the app requires in every fresh database, then run the normal database preparation command and verify the identity exchange. Keep preview authentication material host-managed; do not add, reveal, or hardcode Vibe64 secrets."
  ].join("\n\n");
}

const REPOSITORY_TEMPORARY_AI_GIT_BOUNDARY = [
  "Vibe64—not Temporary AI—owns every repository operation. The failed operation has already been rolled back.",
  "You may inspect Git read-only and edit ordinary working-tree files in this session. Do not change HEAD, branches, refs, the index, stashes, remotes, commits, checkpoints, or repository configuration.",
  "Do not run git add, commit, checkout, switch, restore, reset, clean, stash, merge, rebase, cherry-pick, revert, pull, push, fetch, or update-ref. Do not create a recovery ref or stash; Vibe64 already owns durable recovery.",
  "Record the initial HEAD and index with read-only commands, leave both byte-for-byte unchanged, and do not push. Resolve only by editing the conflicting working-tree files; Vibe64 owns applying and verifying the repository operation.",
  "Preserve the intended behavior of both the latest saved work and this session. Do not hand-edit generated Genesis maps; Vibe64 regenerates its derived artifacts. A clean index after rollback is not proof that the conflict is resolved."
].join("\n");

const UPDATE_REPAIR_MESSAGES = {
  completion: "File repairs prepared. Vibe64 must check Update before this repair is finished.",
  nextStep: "Vibe64 will check Update after the repair.",
  handoff: [
    "Review every listed conflict against both the saved and session versions, preserving their intended changes. Leave an already-correct file unchanged. Confirm the content is resolved before reporting completion; valid syntax alone is insufficient.",
    "Your task is to prepare the file repair, not to run or complete the rebase yourself. Return kind=complete with a factual report as soon as the edits and focused checks are ready for Vibe64 to try Update. Vibe64 then runs Update automatically and returns remaining conflicts to this same conversation.",
    "Return kind=continue only when you need an actual user decision, and ask that specific question. Do not wait for the user to click Rebase or tell them to open another repair chat.",
    "Describe progress in terms of the user's features and remaining work. Keep HEAD/index/ref bookkeeping in the technical checks, not routine progress or the final reply. Passing application tests is not proof that Update succeeded."
  ].join("\n")
};

// The outcomes Vibe64 reports on an Update repair once it has checked Update itself.
const UPDATE_REPAIR_SUCCEEDED_MESSAGE = "Session updated. Your changes were preserved. Nothing was pushed.";

function updateRepairAttentionMessage(error = "") {
  return `Update still needs attention: ${error || "The operation failed."}`;
}

const TEMPORARY_AI_RECOVERY_NOTICE = "This is a separate temporary chat. Temporary AI can edit this session to make the repair. Follow progress here and reply below if it needs a decision.";

function repositoryTemporaryAiDedupeKey({
  code = "",
  diagnostic = "",
  sessionId = ""
} = {}) {
  return [
    "repository-recovery",
    text(sessionId),
    text(code),
    text(diagnostic)
  ].join("|");
}

/**
 * Repairs the selected session hands to Temporary AI (workspace preparation,
 * preview identity, Save/Update and repository problems, the subsystem map)
 * and Vibe64's own verification of each repair's outcome.
 */
function useVibe64TemporaryAiRepairs(props, {
  actorKey,
  assistantFixAllowed,
  projectSlug,
  repositoryOperationActive,
  requestTemporaryAi = null,
  saveWork,
  sessionId,
  temporaryAiWorkspace = null,
  workspaceSetupActivity
}) {
  const workspaceSetupFixSending = ref(false);
  const workspaceSetupFixTaskId = ref("");
  // The finished workspace repair whose success Vibe64 reports once preparation succeeds.
  const workspaceRecoveryTaskId = ref("");
  const repositoryRecoverySending = ref(false);
  const checkedUpdateRepairRuns = new Map();
  const systemReloadVersion = ref(0);
  const subsystemMapTaskKey = computed(() => `subsystem-map:${sessionId.value}`);
  const {
    saveWorkActivityIsUpdate,
    saveWorkCanResolveWithTemporaryAi,
    saveWorkConflictFailure,
    saveWorkError,
    saveWorkFailure,
    saveWorkOperationActive,
    saveWorkSending
  } = saveWork;
  const {
    retryWorkspaceSetup,
    workspaceSetup,
    workspaceSetupDiagnostic,
    workspaceSetupNeedsAttention,
    workspaceSetupStatus
  } = workspaceSetupActivity;

  const temporaryAiAvailable = computed(() => Boolean(
    typeof requestTemporaryAi === "function" &&
    assistantFixAllowed.value &&
    props.active &&
    sessionId.value &&
    !props.sessionSelectionArchived &&
    !repositoryOperationActive.value
  ));
  const workspaceSetupAskDisabled = computed(() => Boolean(
    !workspaceSetupNeedsAttention.value ||
    workspaceSetupFixSending.value ||
    !temporaryAiAvailable.value
  ));

  async function fixWorkspaceSetupWithTemporaryAi() {
    if (workspaceSetupAskDisabled.value) {
      return false;
    }
    const setup = {
      ...workspaceSetup.value,
      diagnostic: workspaceSetupDiagnostic.value
    };
    workspaceSetupFixSending.value = true;
    try {
      const result = await requestTemporaryAi({
        completionMessage: "AI repair finished. Vibe64 is verifying workspace preparation now.",
        dedupeKey: [
          "workspace-setup",
          sessionId.value,
          workspaceSetupStatus.value,
          text(setup.updatedAt),
          text(setup.diagnostic)
        ].join("|"),
        displayMessage: "Fix workspace preparation.",
        failureMessage: "Temporary AI stopped before confirming completion. Vibe64 is checking whether its edits repaired workspace preparation.",
        message: workspaceSetupFixPrompt(setup),
        nextStepMessage: "When the AI finishes, Vibe64 will automatically retry workspace preparation to verify the repair.",
        recoveryNotice: TEMPORARY_AI_RECOVERY_NOTICE,
        title: "Fix workspace preparation"
      });
      const accepted = vibe64RequestAccepted(result);
      const taskId = text(result?.taskId);
      if (accepted && taskId) {
        workspaceSetupFixTaskId.value = taskId;
      }
      return accepted;
    } finally {
      workspaceSetupFixSending.value = false;
    }
  }

  async function handleTemporaryAiTaskFinished(task = {}, reportRecovery = () => {}, { force = false } = {}) {
    const taskId = text(task?.id);
    const status = text(task?.status);
    if (task.sessionId === sessionId.value && task.dedupeKey === subsystemMapTaskKey.value &&
        ["completed", "failed"].includes(status)) {
      systemReloadVersion.value += 1;
      return "subsystem-map";
    }
    if (task.recoveryOperation === "update") {
      const runId = text(task.runId);
      if (
        !taskId || !runId || task.sessionId !== sessionId.value ||
        task.busy || ["starting", "inProgress"].includes(status) ||
        saveWorkSending.value || saveWorkOperationActive.value ||
        ["checking", "unconfirmed"].includes(task.recoveryOutcome) ||
        (!force && (status !== "completed" || task.outcomeKind !== "complete" ||
          checkedUpdateRepairRuns.get(taskId) === runId))
      ) {
        return false;
      }
      checkedUpdateRepairRuns.set(taskId, runId);
      return verifySessionUpdate(task, reportRecovery, !force
        ? text(task.runConflictId) : "");
    }
    if (
      taskId !== workspaceSetupFixTaskId.value ||
      !["completed", "failed"].includes(status)
    ) {
      return false;
    }
    workspaceSetupFixTaskId.value = "";
    if (workspaceSetupNeedsAttention.value) {
      await retryWorkspaceSetup();
    }
    return "workspace-setup";
  }

  async function verifySessionUpdate(task, reportRecovery, reviewedConflictId, { retryAi = true } = {}) {
    const taskId = task?.id;
    const checkingSessionId = sessionId.value;
    const checkingProjectSlug = projectSlug.value;
    const requestId = taskId ? crypto.randomUUID() : "";
    const checkpoint = taskId ? reportRecovery(taskId, { status: "checking", message: "Checking Update…",
      recoveryRequestId: requestId }) : true;
    const checkpointSaved = checkpoint && typeof checkpoint.then === "function" ? await checkpoint : checkpoint;
    if (checkingSessionId !== sessionId.value || checkingProjectSlug !== projectSlug.value) return false;
    if (checkpointSaved === false) {
      if (taskId) reportRecovery(taskId, { status: "failed",
        message: "Update was not started because its recovery checkpoint could not be saved. Try again after the save error is resolved." });
      return false;
    }
    const result = await saveWork.updateBeforeSave({ reviewedConflictId, ...(requestId ? { requestId } : {}) });
    const work = typeof props.refreshSessionWork === "function"
      ? await props.refreshSessionWork().catch(() => null) : null;
    await nextTick();
    if (checkingSessionId !== sessionId.value || checkingProjectSlug !== projectSlug.value) {
      return false;
    }
    if (!taskId) return "repository-update";
    const operation = work?.updateOperation?.requestId === requestId ? work.updateOperation : null;
    if (["queued", "running", "starting"].includes(operation?.status)) return "repository-update";
    const succeeded = operation ? operation.status === "ready" : result?.ok === true;
    const confirmedFailure = operation?.status === "failed" ||
      ["vibe64_agent_write_mode_busy"].includes(saveWorkFailure.value?.code) ||
      Boolean(saveWorkFailure.value?.code?.startsWith("vibe64_session_update_"));
    const outcome = {
      status: succeeded ? "succeeded" : confirmedFailure ? "failed" : "unconfirmed",
      message: succeeded
        ? UPDATE_REPAIR_SUCCEEDED_MESSAGE
        : confirmedFailure
          ? updateRepairAttentionMessage(operation?.error || saveWorkError.value)
          : "Vibe64 could not confirm this Update result. Check the session's current Update status before trying again."
    };
    if (confirmedFailure && (saveWorkConflictFailure.value || operation?.conflictRecovery)) {
      const failure = saveWorkFailure.value || operation;
      const recovery = failure?.details?.conflictRecovery || operation?.conflictRecovery;
      outcome.recoveryConflictId = recovery?.reviewId || "";
      if (retryAi) {
        outcome.retryKey = JSON.stringify([
          failure?.code,
          recovery?.reviewId || recovery?.canonicalCommit || "",
          failure?.details?.conflictPaths || saveWorkError.value
        ]);
        outcome.retryMessage = [
          "Vibe64 ran Update after the prepared repair, but it did not succeed. The working-tree edits remain. Inspect the current state and repair only the remaining conflicts; do not start over or repeat completed work.",
          `Latest Update diagnostic:\n${saveWorkError.value}`,
          UPDATE_REPAIR_MESSAGES.handoff
        ].join("\n\n");
      }
    }
    reportRecovery(taskId, outcome);
    return "repository-update";
  }

  function applyResolvedUpdate(task = null, reportRecovery = () => {}) {
    const review = saveWork.resolvedUpdateReview.value;
    if (saveWork.updateWorkDisabled.value || repositoryOperationActive.value || props.sessionRenewal?.sourceOperationsSuspended ||
        !review || review.reviewId !== saveWork.updateConflictRecovery.value?.reviewId ||
        task && (task.sessionId !== sessionId.value || task.recoveryOperation !== "update" ||
          task.busy || ["starting", "inProgress"].includes(task.status) ||
          ["checking", "unconfirmed"].includes(task.recoveryOutcome))) return false;
    saveWork.resolvedUpdateReview.value = null;
    return verifySessionUpdate(task, reportRecovery, review.reviewId, { retryAi: false });
  }

  async function fixPreviewIdentityWithTemporaryAi(input = {}) {
    if (!temporaryAiAvailable.value) {
      return false;
    }
    const identity = input?.identity || {};
    const identityName = text(identity.name) || "the selected identity";
    const error = text(input?.error);
    const result = await requestTemporaryAi({
      completionMessage: "AI repair finished. Try the preview identity again from the sign-in menu.",
      dedupeKey: [
        "preview-identity",
        sessionId.value,
        text(identity.type),
        text(identity.value),
        error
      ].join("|"),
      displayMessage: `Fix preview sign-in for ${identityName}.`,
      failureMessage: "Temporary AI stopped before completing the preview identity repair. Review the error and progress below before trying again.",
      message: previewIdentityFixPrompt(input),
      nextStepMessage: "When the AI finishes, try this preview identity again from the sign-in menu.",
      recoveryNotice: TEMPORARY_AI_RECOVERY_NOTICE,
      title: "Fix preview identity"
    });
    return vibe64RequestAccepted(result);
  }

  // `subject` names the problem ("Save", "Update", "repository"); `retry` is what the person retries afterwards.
  async function requestRepositoryRepair({
    code = "",
    details = [],
    diagnostic = "",
    recoveryConflictId = "",
    retry,
    subject,
    title,
    update = false
  }) {
    repositoryRecoverySending.value = true;
    try {
      const result = await requestTemporaryAi({
        completionMessage: update
          ? UPDATE_REPAIR_MESSAGES.completion
          : `AI repair finished. Review its result, then retry ${retry}.`,
        dedupeKey: repositoryTemporaryAiDedupeKey({
          code,
          diagnostic,
          sessionId: sessionId.value
        }),
        displayMessage: `Fix this ${subject} problem without losing work.`,
        failureMessage: `Temporary AI stopped before completing the ${subject} repair. Review the error and progress below before retrying.`,
        message: [
          `Help resolve this Vibe64 ${subject} problem. Inspect the current session and canonical repository state, preserve all work, and do not push until the conflict is understood:`,
          REPOSITORY_TEMPORARY_AI_GIT_BOUNDARY,
          ...details
        ].join("\n\n"),
        nextStepMessage: update ? UPDATE_REPAIR_MESSAGES.nextStep : `Review the repair, then retry ${retry}.`,
        recoveryNotice: TEMPORARY_AI_RECOVERY_NOTICE,
        recoveryOperation: update ? "update" : "",
        recoveryConflictId,
        title
      });
      return vibe64RequestAccepted(result);
    } finally {
      repositoryRecoverySending.value = false;
    }
  }

  async function fixRepositoryActionError() {
    if (repositoryRecoverySending.value || !temporaryAiAvailable.value || !saveWorkCanResolveWithTemporaryAi.value) {
      return false;
    }
    const action = saveWorkActivityIsUpdate.value ? "Update" : "Save";
    const update = action === "Update";
    return requestRepositoryRepair({
      code: saveWorkFailure.value?.code,
      details: [update ? UPDATE_REPAIR_MESSAGES.handoff : "", saveWorkError.value].filter(Boolean),
      diagnostic: saveWorkError.value,
      recoveryConflictId: saveWorkFailure.value?.details?.conflictRecovery?.reviewId || "",
      retry: action,
      subject: action,
      title: `Resolve ${action}`,
      update
    });
  }

  async function fixRepositoryError({
    code = "",
    error = "",
    title = "Resolve repository problem"
  } = {}) {
    const diagnostic = text(error);
    const update = ["vibe64_session_update_conflict", "vibe64_session_update_history_diverged"].includes(code);
    const incoming = code === "vibe64_incoming_merge_conflict";
    if (repositoryRecoverySending.value || !temporaryAiAvailable.value || !diagnostic) {
      return false;
    }
    return requestRepositoryRepair({
      code,
      details: [
        update ? UPDATE_REPAIR_MESSAGES.handoff : "",
        incoming ? "Repair only the listed conflicting files in this receiving session's worktree. Inspect both exact reviewed commits, preserve both sides' intended behavior and all unrelated/staged work. Do not commit, merge, rebase or push. Return to Incoming changes → Review resolved conflicts; only the person's reviewed Merge may integrate this contribution." : "",
        diagnostic
      ],
      diagnostic,
      recoveryConflictId: update
        ? saveWorkFailure.value?.details?.conflictRecovery?.reviewId || ""
        : "",
      retry: "the repository operation",
      subject: "repository",
      title,
      update
    });
  }

  async function describeSubsystems() {
    if (!temporaryAiAvailable.value) {
      return false;
    }
    const result = await requestTemporaryAi({
      title: "Subsystem map",
      dedupeKey: subsystemMapTaskKey.value,
      displayMessage: "Generate the subsystem map from this application.",
      message: [
        "Create or repair genesis/subsystems.md from the application source, existing Program, and schema. Inspect the repository with your normal tools and preserve substantive existing descriptions and unrelated edits. Responsibilities are full explanations of purpose, scope, main parts and collaboration, not one-line map captions. If boundaries change, transfer the applicable prose and Program assignments to the current directory owners, and revalidate each required main source under its owner.",
        "Read .agents/skills/genesis-program/SKILL.md and use its exact subsystem grammar. Resolve the project's Genesis command through its installed skill instructions.",
        "Explain meaningful subsystem responsibilities and declare their Program operations and owned/used tables. Each subsystem has one canonical project-relative directory root, recorded in a required ### Source section with one - Directory `path` entry. Cover every indexed source with a declared owner; nested roots own their more specific files. Stack directory-parent rules can inform adoption, but never create a competing owner list. Assign each Program document to exactly one subsystem, allowing its Sources to cite libraries owned elsewhere. UI components can live in the same subsystem as Engine code. Preserve existing stable subsystem ids and responsibility boundaries. Run Genesis inspect subsystems --json on the resulting file and resolve every validation error before claiming success. Creating the file alone is not completion.",
        "Leave the map as ordinary session changes for review; do not commit, push, or deploy."
      ].join("\n\n"),
      completionMessage: "Subsystem map task finished. Review the map and session changes before saving.",
      failureMessage: "The subsystem map task stopped before completion. Review its progress and any partial edits.",
      nextStepMessage: "The subsystem view refreshes when this task finishes. File changes remain in the session for review and Save."
    });
    return vibe64RequestAccepted(result);
  }

  // The Temporary AI workspace records each repair outcome: a checking
  // checkpoint is persisted before Update runs; final outcomes are reported.
  function reportTemporaryRecovery(taskId, outcome) {
    const workspace = temporaryAiWorkspace?.value;
    if (!workspace) return false;
    return outcome.status === "checking"
      ? workspace.persistTaskRecovery?.(taskId, outcome) ?? false
      : workspace.reportTaskRecovery?.(taskId, outcome) ?? false;
  }

  function reportVerifiedWorkspaceRecovery() {
    if (!workspaceRecoveryTaskId.value || workspaceSetupStatus.value !== "succeeded") {
      return false;
    }
    const reported = temporaryAiWorkspace?.value?.reportTaskRecovery?.(
      workspaceRecoveryTaskId.value,
      {
        message: "Workspace preparation succeeded. Vibe64 independently verified the AI repair.",
        status: "succeeded"
      }
    );
    if (reported) {
      workspaceRecoveryTaskId.value = "";
    }
    return Boolean(reported);
  }

  async function finishTemporaryAiTask(task = {}) {
    const recovery = await handleTemporaryAiTaskFinished(task, reportTemporaryRecovery);
    if (!recovery) {
      return false;
    }
    if (recovery === "workspace-setup") {
      workspaceRecoveryTaskId.value = String(task.id || "").trim();
      reportVerifiedWorkspaceRecovery();
    }
    return true;
  }

  function checkTemporaryAiUpdate(task) {
    if (saveWork.updateWorkDisabled.value) return false;
    return handleTemporaryAiTaskFinished(task, reportTemporaryRecovery, { force: true });
  }

  // An Update the repair already started can settle after its check returned.
  watch(() => [props.workState?.updateOperation, temporaryAiWorkspace?.value?.updateRepairTask], ([operation, task]) => {
    if (!task || task.sessionId !== sessionId.value || !task.recoveryRequestId ||
        operation?.requestId !== task.recoveryRequestId ||
        !["checking", "unconfirmed"].includes(task.recoveryOutcome)) return;
    if (operation.status === "ready") {
      reportTemporaryRecovery(task.id, { status: "succeeded", message: UPDATE_REPAIR_SUCCEEDED_MESSAGE });
    } else if (operation.status === "failed") {
      reportTemporaryRecovery(task.id, { status: "failed",
        message: updateRepairAttentionMessage(operation.error),
        recoveryConflictId: operation.conflictRecovery?.reviewId || "" });
    }
  }, { flush: "post" });

  watch(workspaceSetupStatus, () => {
    reportVerifiedWorkspaceRecovery();
  });

  watch(sessionId, () => {
    workspaceRecoveryTaskId.value = "";
  });

  watch([sessionId, projectSlug, actorKey], () => {
    workspaceSetupFixTaskId.value = "";
    checkedUpdateRepairRuns.clear();
  });

  return {
    applyResolvedUpdate,
    checkTemporaryAiUpdate,
    describeSubsystems,
    finishTemporaryAiTask,
    fixPreviewIdentityWithTemporaryAi,
    fixRepositoryActionError,
    fixRepositoryError,
    fixWorkspaceSetupWithTemporaryAi,
    handleTemporaryAiTaskFinished,
    reportTemporaryRecovery,
    repositoryRecoverySending,
    systemReloadVersion,
    workspaceSetupAskDisabled,
    workspaceSetupFixSending
  };
}

export {
  previewIdentityFixPrompt,
  useVibe64TemporaryAiRepairs,
  workspaceSetupFixPrompt
};
