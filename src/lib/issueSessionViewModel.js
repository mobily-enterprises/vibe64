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
  return isOpenIssueSession(session) &&
    session.worktreeReady === true &&
    Array.isArray(session.completedSteps) &&
    session.completedSteps.includes("dependencies_installed");
}

function issueSessionCodexPrompt(session = {}) {
  const promptField = String(session?.codex?.promptField || "");
  return promptField ? String(session?.[promptField] || "") : "";
}

function issueSessionCodexExpectedOutputs(session = {}) {
  const contractFields = session?.codex?.responseContract?.fields;
  if (Array.isArray(contractFields) && contractFields.length > 0) {
    return contractFields.filter((output) => output?.field && output?.extract);
  }
  return [];
}

function hasIssueSessionCodexPrompt(session = {}) {
  return session?.codex?.mode === "inject_prompt" && Boolean(issueSessionCodexPrompt(session));
}

function shouldAutoInjectIssueSessionCodexPrompt(session = {}) {
  return hasIssueSessionCodexPrompt(session) && session?.codex?.autoInject === true;
}

function shouldUseManualIssueSessionCodexPrompt(session = {}) {
  return hasIssueSessionCodexPrompt(session) && session?.codex?.autoInject !== true;
}

function issueSessionCodexPromptActionLabel(session = {}) {
  return String(session?.codex?.promptActionLabel || "").trim() || "Submit prompt to Codex";
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
  const blueprintPath = firstText(session.blueprintPath, session.blueprint?.path, session.appBlueprintPath);
  const finalReportPath = firstText(session.finalReportPath);
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
      copyValue: finalReportPath,
      detail: finalReportPath,
      href: fileHref(finalReportPath),
      icon: "report",
      key: "final-report",
      label: "Final Report",
      value: "final_report.md",
      visible: Boolean(finalReportPath)
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
  issueSessionCodexExpectedOutputs,
  issueSessionDisplayTitle,
  issueSessionFacts,
  issueSessionCodexPromptActionLabel,
  issueSessionStatusColor,
  issueSessionStatusLabel,
  issueSessionTitleFromIssueText,
  parseGithubSessionLink,
  shouldAutoInjectIssueSessionCodexPrompt,
  shouldUseManualIssueSessionCodexPrompt,
  shortIssueSessionId
};
