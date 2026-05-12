const CLOSED_SESSION_STATUSES = new Set(["abandoned", "finished"]);

function shortIssueSessionId(sessionId) {
  return String(sessionId || "").replace(/^\d{4}-/u, "");
}

function issueSessionTitleFromIssueText(issueText) {
  const firstMeaningfulLine = String(issueText || "")
    .split(/\r?\n/u)
    .map((line) => line.replace(/^#+\s*/u, "").trim())
    .find(Boolean);
  return (firstMeaningfulLine || "").slice(0, 120);
}

function parseGithubSessionLink(value, kind) {
  const fallbackLabel = kind === "pr" ? "Pull request" : "Issue";
  try {
    const url = new URL(String(value || ""));
    const [, owner, repo, type, number] = url.pathname.split("/");
    const expectedType = kind === "pr" ? "pull" : "issues";
    if (url.hostname === "github.com" && owner && repo && type === expectedType && number) {
      const prefix = kind === "pr" ? "PR" : "Issue";
      return {
        label: `${prefix} #${number}`,
        repo: `${owner}/${repo}`
      };
    }
  } catch {
    return {
      label: fallbackLabel,
      repo: ""
    };
  }
  return {
    label: fallbackLabel,
    repo: ""
  };
}

function issueSessionStatusLabel(status) {
  return String(status || "pending").replaceAll("_", " ");
}

function issueSessionStatusColor(status) {
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

function isAbandonedIssueSession(session = {}) {
  return String(session?.status || "") === "abandoned";
}

function isClosedIssueSession(session = {}) {
  return CLOSED_SESSION_STATUSES.has(String(session?.status || ""));
}

function isOpenIssueSession(session = {}) {
  return !isClosedIssueSession(session);
}

function canUseIssueSessionTerminal(session = {}) {
  return isOpenIssueSession(session) && session.worktreeReady === true;
}

function issueSessionCurrentStepLabel(session = {}, stepDefinitions = []) {
  const stepId = session?.currentStep || "";
  const step = stepDefinitions.find((definition) => definition.id === stepId);
  return step?.label || session?.currentStepAction?.buttonLabel || stepId || "No active step";
}

function issueSessionFacts(session = {}, stepDefinitions = []) {
  const issueText = String(session.issueText || "");
  const issueTitle = String(session.issueTitle || "").trim() || issueSessionTitleFromIssueText(issueText);
  const planText = String(session.planText || "").trim();
  const issueLink = parseGithubSessionLink(session.issueUrl, "issue");
  const prLink = parseGithubSessionLink(session.prUrl, "pr");
  const completedStepCount = Array.isArray(session.completedSteps) ? session.completedSteps.length : 0;
  const currentStepLabel = issueSessionCurrentStepLabel(session, stepDefinitions);

  return [
    {
      detail: `${completedStepCount} of ${stepDefinitions.length} steps complete`,
      icon: "step",
      key: "step",
      label: "Current Step",
      available: Boolean(currentStepLabel),
      value: currentStepLabel
    },
    {
      copyValue: session.sessionId || "",
      detail: session.sessionRoot || "",
      icon: "session",
      key: "session",
      label: "Session",
      available: Boolean(session.sessionId),
      value: shortIssueSessionId(session.sessionId)
    },
    {
      copyValue: session.worktree || "",
      detail: "Git worktree ready",
      icon: "worktree",
      key: "worktree",
      label: "Worktree",
      available: Boolean(session.worktreeReady && session.worktree),
      value: session.worktree || ""
    },
    {
      copyValue: session.branch || "",
      detail: "Session branch remains recoverable in Git",
      icon: "branch",
      key: "branch",
      label: "Branch",
      available: Boolean(session.branch),
      value: session.branch || ""
    },
    {
      copyValue: session.codexThreadId || "",
      detail: "Used by codex resume",
      icon: "codex",
      key: "codex",
      label: "Codex Session",
      available: Boolean(session.codexThreadId),
      value: session.codexThreadId || ""
    },
    {
      detail: issueTitle,
      expandable: Boolean(issueText),
      expandedValue: issueText,
      href: session.issueUrl || "",
      icon: "github",
      key: "issue",
      label: "GitHub Issue",
      available: Boolean(session.issueUrl),
      value: session.issueUrl ? issueLink.label : ""
    },
    {
      detail: "Approved implementation plan",
      expandable: Boolean(planText),
      expandedValue: planText,
      icon: "step",
      key: "plan",
      label: "Plan",
      available: Boolean(planText),
      value: "Plan saved"
    },
    {
      detail: session.prUrl ? issueTitle : "",
      href: session.prUrl || "",
      icon: "github",
      key: "pr",
      label: "Pull Request",
      available: Boolean(session.prUrl),
      value: session.prUrl ? prLink.label : ""
    }
  ].filter((fact) => fact.available);
}

export {
  canUseIssueSessionTerminal,
  isAbandonedIssueSession,
  isClosedIssueSession,
  isOpenIssueSession,
  issueSessionCurrentStepLabel,
  issueSessionFacts,
  issueSessionStatusColor,
  issueSessionStatusLabel,
  issueSessionTitleFromIssueText,
  parseGithubSessionLink,
  shortIssueSessionId
};
