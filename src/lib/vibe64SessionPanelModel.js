import {
  mdiCheck,
  mdiCodeBraces,
  mdiFileDocumentOutline,
  mdiFolderOutline,
  mdiGithub,
  mdiIdentifier,
  mdiMessagePlusOutline,
  mdiPackageVariantClosed,
  mdiPlay,
  mdiProgressCheck,
  mdiRobotOutline,
  mdiSourceBranch,
  mdiSourceCommit,
  mdiSync,
  mdiUndoVariant
} from "@mdi/js";
import {
  buildVibe64SessionFacts,
  isOpenVibe64Session,
  shortVibe64SessionId as formatShortVibe64SessionId
} from "@/lib/vibe64SessionViewModel.js";
import {
  DEFAULT_MAX_OPEN_SESSIONS
} from "@/lib/vibe64SessionRequestConfig.js";
import {
  vibe64SessionSourcePath
} from "@/lib/vibe64SessionPaths.js";

function sessionOrderKey(session = {}) {
  return String(session.createdAt || session.manifest?.createdAt || session.sessionId || "");
}

function visibleVibe64Sessions(sessions = []) {
  return sessions
    .filter(isOpenVibe64Session)
    .sort((left, right) => sessionOrderKey(left).localeCompare(sessionOrderKey(right)));
}

function vibe64SessionLimits({
  payloadLimits = {},
  sessions = []
} = {}) {
  return {
    maxOpenSessions: Number(payloadLimits.maxOpenSessions || DEFAULT_MAX_OPEN_SESSIONS),
    openSessionCount: Number(payloadLimits.openSessionCount || sessions.filter(isOpenVibe64Session).length)
  };
}

function blockingVibe64SessionPageError({
  hasMountedRuntime = false,
  runtimePageError = "",
  selectedSession = null,
  selectedSessionLoadError = "",
  sessionListLoadError = "",
  sessions = []
} = {}) {
  const runtimeError = String(runtimePageError || "").trim();
  if (runtimeError) {
    return runtimeError;
  }

  const hasSelectedSession = Boolean(selectedSession?.sessionId || selectedSession);
  const listError = String(sessionListLoadError || "").trim();
  if (listError && !hasMountedRuntime && !hasSelectedSession && sessions.length < 1) {
    return listError;
  }

  const selectedError = String(selectedSessionLoadError || "").trim();
  if (selectedError && !hasMountedRuntime && !hasSelectedSession) {
    return selectedError;
  }

  return "";
}

function enrichVibe64SessionForDisplay(session = null) {
  if (!session) {
    return null;
  }
  const metadata = session.metadata || {};
  const source = vibe64SessionSourcePath(session);
  const sourceRemoved = String(metadata.source_removed || "").trim().toLowerCase() === "yes";
  const sourceRecoverable = sourceRemoved && String(metadata.source_recovery_saved || "").trim().toLowerCase() === "yes" &&
    Boolean(metadata.source_recovery_branch || metadata.source_recovery_head);
  return {
    ...session,
    branch: session.branch || metadata.branch || metadata.session_branch || "",
    issueTitle: session.issueTitle || metadata.issue_title || "",
    issueUrl: session.issueUrl || metadata.issue_url || "",
    prUrl: session.prUrl || metadata.pr_url || "",
    pullRequestPath: session.pullRequestPath || metadata.pull_request_path || "",
    sessionName: session.sessionName || metadata.issue_word || "",
    sourcePrTitle: metadata.source_pr_title || "",
    sourcePrUpdateMode: metadata.source_pr_update_mode || "",
    sourcePrUrl: metadata.source_pr_url || "",
    workSource: metadata.work_source || "",
    source,
    sourceReady: !sourceRemoved && (session.sourceReady === true || Boolean(source)),
    sourceRecoverable,
    sourceRecoveryName: metadata.source_recovery_session_name || session.sessionName || metadata.issue_word || "",
    sourceRemoved
  };
}

function buildVibe64TimelineSteps(session = {}) {
  const currentStepId = String(session?.currentStep || "");
  const sessionIsOpen = isOpenVibe64Session(session || {});
  return (session?.stepDefinitions || []).map((step, fallbackIndex) => {
    const status = String(step.status || "");
    const current = status === "current" || step.id === currentStepId;
    const done = status === "done" || step.done === true;
    const description = String(step.description || "");
    const canRewind = sessionIsOpen && done && !current && step.rewindable !== false;
    return {
      badges: [],
      canExpand: done && !current && (Boolean(description) || canRewind),
      canRewind,
      current,
      description,
      done,
      id: step.id,
      icon: vibe64TimelineStepIcon(step),
      index: Number.isFinite(Number(step.index)) ? Number(step.index) : fallbackIndex,
      label: step.label || step.id,
      rewindLabel: step.label || step.id,
      rewindStepId: step.id,
      state: current ? "current" : done ? "done" : "pending",
      title: description || undefined
    };
  });
}

function buildVibe64AutopilotNavigationSteps(session = {}) {
  return buildVibe64TimelineSteps(session);
}

function vibe64TimelineStepIcon(step = {}) {
  const id = String(step.id || "");
  if (id.includes("session")) {
    return mdiIdentifier;
  }
  if (id.includes("worktree")) {
    return mdiFolderOutline;
  }
  if (id.includes("seed") || id.includes("issue")) {
    return mdiMessagePlusOutline;
  }
  if (id.includes("plan") || id.includes("validate")) {
    return mdiProgressCheck;
  }
  if (id.includes("execute")) {
    return mdiPlay;
  }
  if (id.includes("dependencies")) {
    return mdiPackageVariantClosed;
  }
  if (id.includes("review") || id.includes("accepted")) {
    return mdiCheck;
  }
  if (id.includes("report") || id.includes("knowledge")) {
    return mdiFileDocumentOutline;
  }
  if (id.includes("commit")) {
    return mdiSourceCommit;
  }
  if (id.includes("pull_request") || id.includes("merge")) {
    return mdiGithub;
  }
  return mdiRobotOutline;
}

function vibe64PromptHandoffFromSession(session = {}) {
  const actionHandoff = session?.actionResult?.codexPromptHandoff;
  if (actionHandoff && typeof actionHandoff === "object") {
    return actionHandoff;
  }
  const sessionHandoff = session?.codexPromptHandoff;
  return sessionHandoff && typeof sessionHandoff === "object" ? sessionHandoff : null;
}

function vibe64SessionFactIcon(icon) {
  return {
    blueprint: mdiFileDocumentOutline,
    branch: mdiSourceBranch,
    codex: mdiRobotOutline,
    github: mdiGithub,
    report: mdiFileDocumentOutline,
    session: mdiIdentifier,
    step: mdiProgressCheck,
    worktree: mdiFolderOutline
  }[icon] || mdiIdentifier;
}

function vibe64SessionFacts(session = {}) {
  return buildVibe64SessionFacts(session, session?.stepDefinitions || [])
    .map((fact) => ({
      ...fact,
      icon: vibe64SessionFactIcon(fact.icon)
    }));
}

function vibe64ActionIcon(action = {}) {
  const icon = String(action.icon || "");
  if (icon) {
    return {
      branch: mdiSourceBranch,
      code: mdiCodeBraces,
      codex: mdiRobotOutline,
      commit: mdiSourceCommit,
      github: mdiGithub,
      "message-square-plus": mdiMessagePlusOutline,
      "rotate-ccw": mdiUndoVariant,
      run: mdiPlay,
      success: mdiCheck,
      sync: mdiSync
    }[icon] || mdiCodeBraces;
  }
  return mdiCodeBraces;
}

function currentStepDisabledReason(actions = [], next = null) {
  const disabledAction = actions.find((action) => action.enabled !== true && action.disabledReason);
  if (disabledAction) {
    return disabledAction.disabledReason;
  }
  if (next?.visible && next.enabled !== true) {
    return next.disabledReason || "";
  }
  return "";
}

function commandMessage(command, type) {
  return command.messageType === type ? command.message : "";
}

function shortVibe64SessionId(sessionId = "") {
  return formatShortVibe64SessionId(sessionId);
}

export {
  vibe64ActionIcon,
  blockingVibe64SessionPageError,
  vibe64PromptHandoffFromSession,
  vibe64SessionFacts,
  vibe64SessionLimits,
  buildVibe64AutopilotNavigationSteps,
  buildVibe64TimelineSteps,
  commandMessage,
  currentStepDisabledReason,
  enrichVibe64SessionForDisplay,
  shortVibe64SessionId,
  visibleVibe64Sessions
};
