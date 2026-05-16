import {
  mdiCheck,
  mdiCodeBraces,
  mdiFileDocumentOutline,
  mdiFolderOutline,
  mdiGithub,
  mdiIdentifier,
  mdiPencilOutline,
  mdiPlay,
  mdiProgressCheck,
  mdiRobotOutline,
  mdiSourceBranch,
  mdiSync
} from "@mdi/js";
import {
  isAbandonedIssueSession,
  isOpenIssueSession,
  issueSessionFacts,
  shortIssueSessionId
} from "@/lib/issueSessionViewModel.js";
import {
  DEFAULT_MAX_OPEN_SESSIONS
} from "@/lib/aiStudioSessionRequestConfig.js";

function sessionOrderKey(session = {}) {
  return String(session.createdAt || session.manifest?.createdAt || session.sessionId || "");
}

function visibleAiStudioSessions(sessions = []) {
  return sessions
    .filter((session) => !isAbandonedIssueSession(session))
    .sort((left, right) => sessionOrderKey(left).localeCompare(sessionOrderKey(right)));
}

function aiStudioSessionLimits({
  payloadLimits = {},
  sessions = []
} = {}) {
  return {
    maxOpenSessions: Number(payloadLimits.maxOpenSessions || DEFAULT_MAX_OPEN_SESSIONS),
    openSessionCount: Number(payloadLimits.openSessionCount || sessions.filter(isOpenIssueSession).length)
  };
}

function enrichAiStudioSessionForDisplay(session = null) {
  if (!session) {
    return null;
  }
  const metadata = session.metadata || {};
  return {
    ...session,
    branch: session.branch || metadata.branch || metadata.session_branch || "",
    issueTitle: session.issueTitle || metadata.issue_title || "",
    issueUrl: session.issueUrl || metadata.issue_url || "",
    prUrl: session.prUrl || metadata.pr_url || "",
    pullRequestPath: session.pullRequestPath || metadata.pull_request_path || "",
    worktree: session.worktree || metadata.worktree || metadata.worktree_path || ""
  };
}

function buildAiStudioTimelineSteps(session = {}) {
  const currentStepId = String(session?.currentStep || "");
  return (session?.stepDefinitions || []).map((step, fallbackIndex) => {
    const status = String(step.status || "");
    const current = status === "current" || step.id === currentStepId;
    const done = status === "done" || step.done === true;
    const description = String(step.description || "");
    return {
      badges: [],
      canExpand: done && !current && Boolean(description),
      canRewind: false,
      current,
      description,
      done,
      id: step.id,
      index: Number.isFinite(Number(step.index)) ? Number(step.index) : fallbackIndex,
      label: step.label || step.id,
      rewindLabel: "",
      rewindStepId: "",
      state: current ? "current" : done ? "done" : "pending",
      title: description || undefined
    };
  });
}

function aiStudioPromptHandoffFromSession(session = {}) {
  const actionHandoff = session?.actionResult?.codexPromptHandoff;
  if (actionHandoff && typeof actionHandoff === "object") {
    return actionHandoff;
  }
  const sessionHandoff = session?.codexPromptHandoff;
  return sessionHandoff && typeof sessionHandoff === "object" ? sessionHandoff : null;
}

function aiStudioSessionFactIcon(icon) {
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

function aiStudioSessionFacts(session = {}) {
  return issueSessionFacts(session, session?.stepDefinitions || [])
    .map((fact) => ({
      ...fact,
      icon: aiStudioSessionFactIcon(fact.icon)
    }));
}

function aiStudioActionIcon(action = {}) {
  if (action.type === "prompt") {
    return mdiRobotOutline;
  }
  if (action.type === "editor") {
    return mdiPencilOutline;
  }
  if (["create_issue_on_gh", "create_pr_on_gh", "merge_pr"].includes(action.id)) {
    return mdiGithub;
  }
  if (["create_worktree", "install_dependencies", "sync_main_checkout"].includes(action.id)) {
    return mdiSync;
  }
  if (action.type === "finish") {
    return mdiCheck;
  }
  if (action.id === "run_automated_checks") {
    return mdiPlay;
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

function shortAiStudioSessionId(sessionId = "") {
  return shortIssueSessionId(sessionId);
}

export {
  aiStudioActionIcon,
  aiStudioPromptHandoffFromSession,
  aiStudioSessionFacts,
  aiStudioSessionLimits,
  buildAiStudioTimelineSteps,
  commandMessage,
  currentStepDisabledReason,
  enrichAiStudioSessionForDisplay,
  shortAiStudioSessionId,
  visibleAiStudioSessions
};
