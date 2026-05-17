const CLOSED_SESSION_STATUSES = new Set(["abandoned", "finished"]);

function shortAiStudioSessionId(sessionId) {
  return String(sessionId || "").replace(/^\d{4}-/u, "");
}

function aiStudioIssueTitleFromText(issueText) {
  const firstMeaningfulLine = String(issueText || "")
    .split(/\r?\n/u)
    .map((line) => line.replace(/^#+\s*/u, "").trim())
    .find(Boolean);
  return (firstMeaningfulLine || "").slice(0, 120);
}

function aiStudioSessionDisplayTitle(session = {}) {
  const issueTitle = firstText(session?.issueTitle, aiStudioIssueTitleFromText(session?.issueText));
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
    if (definition.id === stepId) {
      return true;
    }
    return Array.isArray(definition.sourceStepIds) && definition.sourceStepIds.includes(stepId);
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
  const issueText = String(session.issueText || "");
  const issueTitle = firstText(session.issueTitle, aiStudioIssueTitleFromText(issueText));
  const issueLink = parseGithubSessionLink(session.issueUrl, "issue");
  const prLink = parseGithubSessionLink(session.prUrl, "pr");
  const completedStepCount = Array.isArray(session.completedSteps) ? session.completedSteps.length : 0;
  const currentStepLabel = aiStudioSessionCurrentStepLabel(session, stepDefinitions);
  const nextCommand = firstText(session.nextCommand);
  const actionCommands = Array.isArray(session.actionCommands)
    ? session.actionCommands.map((command) => firstText(command?.command)).filter(Boolean)
    : [];
  const blueprintPath = firstText(session.blueprintPath, session.blueprint?.path, session.appBlueprintPath);
  const pullRequestPath = firstText(session.pullRequestPath);
  const prOutcome = session.prOutcome && typeof session.prOutcome === "object" ? session.prOutcome : null;

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
      copyValue: nextCommand,
      detail: "Same step from the command line",
      icon: "step",
      key: "next-command",
      label: "Next CLI Step",
      value: nextCommand,
      visible: Boolean(nextCommand && isOpenAiStudioSession(session))
    },
    {
      copyValue: actionCommands.join("\n"),
      detail: actionCommands[0] || "",
      expandable: actionCommands.length > 1,
      expandedValue: actionCommands.join("\n"),
      icon: "step",
      key: "action-commands",
      label: "Step Commands",
      value: actionCommands.length === 1 ? actionCommands[0] : `${actionCommands.length} commands`,
      visible: actionCommands.length > 0
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
      detail: issueTitle,
      expandable: Boolean(issueText),
      expandedValue: issueText,
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
      copyValue: pullRequestPath,
      detail: pullRequestPath,
      href: fileHref(pullRequestPath),
      icon: "report",
      key: "pull-request-draft",
      label: "PR Draft",
      value: "pull_request.md",
      visible: Boolean(pullRequestPath)
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
  aiStudioIssueTitleFromText,
  parseGithubSessionLink,
  shortAiStudioSessionId
};
