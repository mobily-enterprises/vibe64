const CLOSED_SESSION_STATUSES = new Set(["abandoned", "finished"]);
const REPORT_LABEL = "Report";

function shortAiStudioSessionId(sessionId) {
  return String(sessionId || "").replace(/^\d{4}-/u, "");
}

function aiStudioSessionDisplayTitle(session = {}) {
  const sessionName = firstText(session?.sessionName) || firstText(session?.metadata?.issue_word);
  if (sessionName) {
    return sessionName;
  }
  const issueTitle = firstText(session?.issueTitle);
  if (issueTitle) {
    return issueTitle;
  }
  const shortSessionId = shortAiStudioSessionId(session?.sessionId);
  return shortSessionId ? `Session ${shortSessionId}` : "";
}

function githubSessionLinkParts(value, kind) {
  try {
    const url = new URL(String(value || ""));
    const [, owner, repo, type, number] = url.pathname.split("/");
    const expectedType = kind === "pr" ? "pull" : "issues";
    if (url.hostname === "github.com" && owner && repo && type === expectedType && number) {
      return {
        number,
        owner,
        repo
      };
    }
  } catch {
    return null;
  }
  return null;
}

function parseGithubSessionLink(value, kind) {
  const fallbackLabel = kind === "pr" ? "Pull request" : "Issue";
  const parts = githubSessionLinkParts(value, kind);
  if (parts) {
    const prefix = kind === "pr" ? "PR" : "Issue";
    return {
      label: `${prefix} #${parts.number}`,
      repo: `${parts.owner}/${parts.repo}`
    };
  }
  return {
    label: fallbackLabel,
    repo: ""
  };
}

function aiStudioSessionStatusLabel(status) {
  return String(status || "pending").replaceAll("_", " ");
}

function aiStudioSessionStatusColor(status) {
  const normalizedStatus = String(status || "");
  if (normalizedStatus === "finished") {
    return "success";
  }
  if (["abandoned", "failed", "blocked"].includes(normalizedStatus)) {
    return "error";
  }
  if (normalizedStatus === "waiting_for_user") {
    return "warning";
  }
  return "primary";
}

function isAbandonedAiStudioSession(session = {}) {
  return String(session?.status || "") === "abandoned";
}

function isClosedAiStudioSession(session = {}) {
  return CLOSED_SESSION_STATUSES.has(String(session?.status || ""));
}

function isOpenAiStudioSession(session = {}) {
  return !isClosedAiStudioSession(session);
}

function normalizedText(value) {
  return String(value || "").trim();
}

function firstText(...values) {
  return values.map(normalizedText).find(Boolean) || "";
}

function aiStudioSessionCurrentStepLabel(session = {}, stepDefinitions = []) {
  const stepId = normalizedText(session?.currentStep);
  const step = stepDefinitions.find((definition) => {
    return definition.id === stepId;
  });
  return firstText(step?.label, stepId, "No active step");
}

function fileHref(filePath) {
  const path = normalizedText(filePath);
  if (!path || !path.startsWith("/")) {
    return "";
  }
  return `file://${path.split("/").map((segment) => encodeURIComponent(segment)).join("/")}`;
}

function buildAiStudioSessionFacts(session = {}, stepDefinitions = []) {
  const issueTitle = firstText(session.issueTitle);
  const issueLink = parseGithubSessionLink(session.issueUrl, "issue");
  const prLink = parseGithubSessionLink(session.prUrl, "pr");
  const completedStepCount = Array.isArray(session.completedSteps) ? session.completedSteps.length : 0;
  const currentStepLabel = aiStudioSessionCurrentStepLabel(session, stepDefinitions);
  const blueprintPath = firstText(session.blueprintPath);
  const prOutcome = session.prOutcome && typeof session.prOutcome === "object" ? session.prOutcome : null;
  const reportPath = firstText(session.reportPath);
  const workSource = firstText(session.workSource);
  const sourcePrLink = parseGithubSessionLink(session.sourcePrUrl, "pr");

  return [
    {
      detail: stepDefinitions.length ? `${completedStepCount} of ${stepDefinitions.length} steps complete` : "",
      icon: "step",
      key: "step",
      label: "Current Step",
      value: currentStepLabel,
      visible: Boolean(currentStepLabel)
    },
    {
      copyValue: session.sessionRoot || session.sessionId || "",
      detail: session.sessionRoot || "",
      icon: "session",
      key: "session",
      label: "Session",
      value: shortAiStudioSessionId(session.sessionId),
      visible: Boolean(session.sessionId)
    },
    {
      copyValue: session.worktree || "",
      detail: "Git worktree ready",
      icon: "worktree",
      key: "worktree",
      label: "Worktree",
      value: session.worktree || "",
      visible: Boolean(session.worktreeReady && session.worktree)
    },
    {
      copyValue: session.codexThreadId || "",
      detail: "Used by codex resume",
      icon: "codex",
      key: "codex",
      label: "Codex Session",
      value: session.codexThreadId || "",
      visible: Boolean(session.codexThreadId)
    },
    {
      copyValue: session.branch || "",
      detail: "Session branch remains recoverable in Git",
      icon: "branch",
      key: "branch",
      label: "Branch",
      value: session.branch || "",
      visible: Boolean(session.branch)
    },
    {
      detail: firstText(session.sourcePrTitle, session.sourcePrUpdateMode),
      href: session.sourcePrUrl || "",
      icon: "github",
      key: "work-source",
      label: "Work Source",
      value: workSource === "existing_pr" ? sourcePrLink.label : "New branch",
      visible: Boolean(workSource)
    },
    {
      detail: issueTitle,
      href: session.issueUrl || "",
      icon: "github",
      key: "issue",
      label: "GitHub Issue",
      value: session.issueUrl ? issueLink.label : "",
      visible: Boolean(session.issueUrl)
    },
    {
      detail: issueTitle,
      href: session.prUrl || "",
      icon: "github",
      key: "pr",
      label: "Pull Request",
      value: session.prUrl ? prLink.label : "",
      visible: Boolean(session.prUrl)
    },
    {
      copyValue: blueprintPath,
      detail: blueprintPath,
      href: fileHref(blueprintPath),
      icon: "blueprint",
      key: "blueprint",
      label: "Blueprint",
      value: "APP_BLUEPRINT.md",
      visible: Boolean(session.blueprintExists && blueprintPath)
    },
    {
      copyValue: reportPath,
      detail: reportPath,
      href: fileHref(reportPath),
      icon: "report",
      key: "session-report",
      label: "Report",
      value: REPORT_LABEL,
      visible: Boolean(reportPath)
    },
    {
      detail: firstText(prOutcome?.reason, prOutcome?.mergedAt),
      icon: "github",
      key: "pr-outcome",
      label: "PR Outcome",
      value: aiStudioSessionStatusLabel(prOutcome?.outcome || ""),
      visible: Boolean(prOutcome?.outcome)
    }
  ].filter((fact) => fact.visible);
}

export {
  isAbandonedAiStudioSession,
  isClosedAiStudioSession,
  isOpenAiStudioSession,
  aiStudioSessionDisplayTitle,
  buildAiStudioSessionFacts,
  aiStudioSessionStatusColor,
  aiStudioSessionStatusLabel,
  parseGithubSessionLink,
  shortAiStudioSessionId
};
