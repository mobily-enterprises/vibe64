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

function issueSessionDisplayTitle(session = {}) {
  const issueTitle = firstText(session?.issueTitle, issueSessionTitleFromIssueText(session?.issueText));
  if (issueTitle) {
    return issueTitle;
  }
  const shortSessionId = shortIssueSessionId(session?.sessionId);
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

function issueSessionHasIssueDraft(session = {}) {
  return Boolean(normalizedText(session.issueText) && normalizedText(session.issueTitle));
}

function issueSessionIssueParts(session = {}) {
  return githubSessionLinkParts(session.issueUrl, "issue");
}

function issueSessionHasGithubIssue(session = {}) {
  return Boolean(issueSessionIssueParts(session));
}

function issueSessionIssueNumber(session = {}) {
  return normalizedText(session.issueNumber) || issueSessionIssueParts(session)?.number || "";
}

function issueSessionCanCreateGithubIssue(session = {}) {
  return isOpenIssueSession(session) &&
    normalizedText(session.currentStep) === "issue_submitted" &&
    issueSessionHasIssueDraft(session) &&
    !issueSessionHasGithubIssue(session);
}

function issueSessionHasPullRequestDraft(session = {}) {
  return Boolean(normalizedText(session.pullRequestText));
}

function issueSessionCanCreateGithubPullRequest(session = {}) {
  return isOpenIssueSession(session) &&
    normalizedText(session.currentStep) === "pr_created" &&
    issueSessionHasPullRequestDraft(session) &&
    !normalizedText(session.prUrl);
}

function canUseIssueSessionTerminal(session = {}) {
  if (session.workflowId && session.targetRoot) {
    return isOpenIssueSession(session);
  }
  return isOpenIssueSession(session) &&
    session.worktreeReady === true &&
    Array.isArray(session.completedSteps) &&
    session.completedSteps.includes("dependencies_installed");
}

function issueSessionCodexPrompt(session = {}) {
  const promptField = String(session?.codex?.promptField || "");
  return promptField ? String(session?.[promptField] || "") : "";
}

function hasIssueSessionCodexPrompt(session = {}) {
  return session?.codex?.mode === "inject_prompt" && Boolean(issueSessionCodexPrompt(session));
}

function issueSessionCodexPromptShouldSend(session = {}) {
  return session?.codex?.sendPrompt === true || session?.codex?.autoInject === true;
}

function shouldSendIssueSessionCodexPrompt(session = {}) {
  return hasIssueSessionCodexPrompt(session) && issueSessionCodexPromptShouldSend(session);
}

function shouldAutoInjectIssueSessionCodexPrompt(session = {}) {
  return shouldSendIssueSessionCodexPrompt(session);
}

function shouldUseManualIssueSessionCodexPrompt(session = {}) {
  return hasIssueSessionCodexPrompt(session) && !issueSessionCodexPromptShouldSend(session);
}

function issueSessionCodexPromptActionLabel(session = {}) {
  return String(session?.codex?.promptActionLabel || "").trim() || "Submit prompt to Codex";
}

function issueSessionActionSubmitsCodexPrompt(session = {}, action = {}) {
  const currentStep = normalizedText(session.currentStep);
  const actionKind = normalizedText(action.kind);
  const actionCommand = normalizedText(action.actionCommand || action.sessionAction || action.id || action.command);
  const automationMode = normalizedText(action.automation?.mode);
  if (actionKind === "codex_prompt" || automationMode === "codex_prompt") {
    return true;
  }
  if (currentStep === "issue_prompt_rendered" && (!actionCommand || actionCommand === "define_issue")) {
    return true;
  }
  if (
    currentStep === "issue_created" &&
    (!actionCommand || actionCommand === "create_issue_file")
  ) {
    return true;
  }
  if (
    currentStep === "final_report_created" &&
    (!actionCommand || actionCommand === "create_pull_request_file")
  ) {
    return true;
  }
  if (
    currentStep === "pr_merge_prepared" &&
    actionCommand === "prepare_for_merge"
  ) {
    return true;
  }
  return false;
}

function normalizedText(value) {
  return String(value || "").trim();
}

function firstText(...values) {
  return values.map(normalizedText).find(Boolean) || "";
}

function issueSessionCurrentStepLabel(session = {}, stepDefinitions = []) {
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

function issueSessionFacts(session = {}, stepDefinitions = []) {
  const issueText = String(session.issueText || "");
  const issueTitle = firstText(session.issueTitle, issueSessionTitleFromIssueText(issueText));
  const issueLink = parseGithubSessionLink(session.issueUrl, "issue");
  const prLink = parseGithubSessionLink(session.prUrl, "pr");
  const completedStepCount = Array.isArray(session.completedSteps) ? session.completedSteps.length : 0;
  const currentStepLabel = issueSessionCurrentStepLabel(session, stepDefinitions);
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
      visible: Boolean(nextCommand && isOpenIssueSession(session))
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
      value: shortIssueSessionId(session.sessionId),
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
      visible: Boolean(pullRequestPath && issueSessionHasPullRequestDraft(session))
    },
    {
      detail: firstText(prOutcome?.reason, prOutcome?.mergedAt),
      icon: "github",
      key: "pr-outcome",
      label: "PR Outcome",
      value: issueSessionStatusLabel(prOutcome?.outcome || ""),
      visible: Boolean(prOutcome?.outcome)
    }
  ].filter((fact) => fact.visible);
}

export {
  canUseIssueSessionTerminal,
  isAbandonedIssueSession,
  isClosedIssueSession,
  isOpenIssueSession,
  issueSessionActionSubmitsCodexPrompt,
  issueSessionCanCreateGithubPullRequest,
  issueSessionCanCreateGithubIssue,
  issueSessionDisplayTitle,
  issueSessionFacts,
  issueSessionCodexPromptActionLabel,
  issueSessionHasGithubIssue,
  issueSessionHasIssueDraft,
  issueSessionHasPullRequestDraft,
  issueSessionIssueNumber,
  issueSessionIssueParts,
  issueSessionStatusColor,
  issueSessionStatusLabel,
  issueSessionTitleFromIssueText,
  parseGithubSessionLink,
  shouldAutoInjectIssueSessionCodexPrompt,
  shouldSendIssueSessionCodexPrompt,
  shouldUseManualIssueSessionCodexPrompt,
  shortIssueSessionId
};
