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
  mdiSourceCommit,
  mdiSync
} from "@mdi/js";
import {
  buildAiStudioSessionFacts,
  isOpenAiStudioSession,
  shortAiStudioSessionId as formatShortAiStudioSessionId
} from "@/lib/aiStudioSessionViewModel.js";
import {
  DEFAULT_MAX_OPEN_SESSIONS
} from "@/lib/aiStudioSessionRequestConfig.js";
import {
  aiStudioSessionWorktreePath
} from "@/lib/aiStudioSessionPaths.js";

function sessionOrderKey(session = {}) {
  return String(session.createdAt || session.manifest?.createdAt || session.sessionId || "");
}

function visibleAiStudioSessions(sessions = []) {
  return sessions
    .filter(isOpenAiStudioSession)
    .sort((left, right) => sessionOrderKey(left).localeCompare(sessionOrderKey(right)));
}

function aiStudioSessionLimits({
  payloadLimits = {},
  sessions = []
} = {}) {
  return {
    maxOpenSessions: Number(payloadLimits.maxOpenSessions || DEFAULT_MAX_OPEN_SESSIONS),
    openSessionCount: Number(payloadLimits.openSessionCount || sessions.filter(isOpenAiStudioSession).length)
  };
}

function enrichAiStudioSessionForDisplay(session = null) {
  if (!session) {
    return null;
  }
  const metadata = session.metadata || {};
  const worktree = aiStudioSessionWorktreePath(session);
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
    worktree,
    worktreeReady: session.worktreeReady === true || Boolean(worktree)
  };
}

const AI_STUDIO_AUTOPILOT_INTERACTION_STEPS = Object.freeze([
  {
    id: "session_created",
    label: "Start"
  },
  {
    id: "issue_file_created",
    label: "Briefing"
  },
  {
    id: "seed_application_defined",
    label: "Seed app"
  },
  {
    id: "implementation_reviewed",
    label: "Human review"
  },
  {
    id: "deep_ui_check_run",
    label: "UI improvements"
  },
  {
    id: "changes_accepted",
    label: "Final review"
  },
  {
    id: "pr_merged",
    label: "Merge"
  },
  {
    id: "session_finished",
    label: "Done"
  }
]);

function buildAiStudioTimelineSteps(session = {}) {
  const currentStepId = String(session?.currentStep || "");
  const sessionIsOpen = isOpenAiStudioSession(session || {});
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
      index: Number.isFinite(Number(step.index)) ? Number(step.index) : fallbackIndex,
      label: step.label || step.id,
      rewindLabel: step.label || step.id,
      rewindStepId: step.id,
      state: current ? "current" : done ? "done" : "pending",
      title: description || undefined
    };
  });
}

function buildAiStudioAutopilotNavigationSteps(session = {}) {
  const timelineStepById = new Map(buildAiStudioTimelineSteps(session).map((step) => [step.id, step]));
  const autopilotSteps = AI_STUDIO_AUTOPILOT_INTERACTION_STEPS
    .map((autopilotStep, index) => {
      const timelineStep = timelineStepById.get(autopilotStep.id);
      if (!timelineStep) {
        return null;
      }
      return {
        ...timelineStep,
        autopilotIndex: index,
        label: autopilotStep.label
      };
    })
    .filter(Boolean);
  const currentStep = autopilotSteps.find((step) => step.current);
  const activeStep = currentStep || autopilotSteps.find((step) => step.state !== "done") || autopilotSteps.at(-1);
  if (!activeStep) {
    return [];
  }

  return autopilotSteps.map((step) => {
    if (step.id !== activeStep.id || step.current) {
      return step;
    }
    return {
      ...step,
      current: true,
      state: "current"
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
  return buildAiStudioSessionFacts(session, session?.stepDefinitions || [])
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
  if (["create_issue_on_gh", "create_pr_on_gh", "merge_pr", "open_pr"].includes(action.id)) {
    return mdiGithub;
  }
  if (["use_existing_issue", "use_existing_pr"].includes(action.id)) {
    return mdiGithub;
  }
  if (action.id === "use_new_branch") {
    return mdiSourceBranch;
  }
  if (["create_worktree", "install_dependencies", "sync_main_checkout", "update_code_index"].includes(action.id)) {
    return mdiSync;
  }
  if (action.type === "finish") {
    return mdiCheck;
  }
  if (action.id === "run_automated_checks") {
    return mdiPlay;
  }
  if (action.id === "commit_changes") {
    return mdiSourceCommit;
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
  return formatShortAiStudioSessionId(sessionId);
}

export {
  AI_STUDIO_AUTOPILOT_INTERACTION_STEPS,
  aiStudioActionIcon,
  aiStudioPromptHandoffFromSession,
  aiStudioSessionFacts,
  aiStudioSessionLimits,
  buildAiStudioAutopilotNavigationSteps,
  buildAiStudioTimelineSteps,
  commandMessage,
  currentStepDisabledReason,
  enrichAiStudioSessionForDisplay,
  shortAiStudioSessionId,
  visibleAiStudioSessions
};
