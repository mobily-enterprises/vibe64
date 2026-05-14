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
  const outputs = session?.codex?.expectedOutputs;
  if (Array.isArray(outputs) && outputs.length > 0) {
    return outputs.filter((output) => output?.field);
  }
  const output = session?.codex?.expectedOutput;
  return output?.field ? [output] : [];
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

function issueSessionCurrentStepLabel(session = {}, stepDefinitions = []) {
  const stepId = session?.currentStep || "";
  const step = stepDefinitions.find((definition) => definition.id === stepId);
  return step?.label || session?.currentStepAction?.buttonLabel || stepId || "No active step";
}

function issueSessionFacts(session = {}, stepDefinitions = []) {
  const issueText = String(session.issueText || "");
  const issueTitle = String(session.issueTitle || "").trim() || issueSessionTitleFromIssueText(issueText);
  const planText = String(session.planText || "").trim();
  const finalReportText = String(session.finalReportText || "").trim();
  const issueLink = parseGithubSessionLink(session.issueUrl, "issue");
  const prLink = parseGithubSessionLink(session.prUrl, "pr");
  const prOutcome = session.prOutcome && typeof session.prOutcome === "object" ? session.prOutcome : null;
  const agentDecisionsLatest = String(session.agentDecisionsLatest || "").trim();
  const checks = Array.isArray(session.checks) ? session.checks : [];
  const uiChecks = Array.isArray(session.uiChecks) ? session.uiChecks : [];
  const reviewPasses = Array.isArray(session.reviewPasses) ? session.reviewPasses : [];
  const githubCommentCount = session.githubComments && typeof session.githubComments === "object"
    ? Object.keys(session.githubComments).length
    : 0;
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
      detail: session.uiImpact ? `UI impact: ${session.uiImpact}` : "",
      icon: "step",
      key: "classification",
      label: "Issue Classification",
      available: Boolean(session.issueCategory || session.uiImpact),
      value: [session.issueCategory, session.uiImpact].filter(Boolean).join(" / ")
    },
    {
      detail: `Active cycle: ${session.activeCycle || "001"}`,
      icon: "step",
      key: "cycle",
      label: "Rework Cycle",
      available: Array.isArray(session.cycles) && session.cycles.length > 0,
      value: `${session.cycles?.length || 1} cycle${(session.cycles?.length || 1) === 1 ? "" : "s"}`
    },
    {
      detail: checks.map((check) => `${check.stepId}: ${check.ok ? "passed" : "failed"}`).join("\n"),
      expandable: checks.length > 0,
      expandedValue: checks.map((check) => `${check.command || check.stepId}: ${check.ok ? "passed" : "failed"}`).join("\n"),
      icon: "step",
      key: "checks",
      label: "Checks",
      available: checks.length > 0,
      value: `${checks.filter((check) => check.ok).length} of ${checks.length} passed`
    },
    {
      detail: uiChecks.map((check) => `${check.stepId}: ${check.status || (check.ok ? "passed" : "failed")}`).join("\n"),
      expandable: uiChecks.length > 0,
      expandedValue: uiChecks.map((check) => `${check.stepId}: ${check.status || (check.ok ? "passed" : "failed")}${check.reason ? ` (${check.reason})` : ""}`).join("\n"),
      icon: "step",
      key: "ui-checks",
      label: "UI Checks",
      available: uiChecks.length > 0,
      value: `${uiChecks.length} recorded`
    },
    {
      detail: reviewPasses.map((pass) => `${pass.label || pass.pass}: ${pass.status || "recorded"}`).join("\n"),
      expandable: reviewPasses.length > 0,
      expandedValue: reviewPasses.map((pass) => {
        const commit = pass.commit ? `, commit ${String(pass.commit).slice(0, 12)}` : "";
        const changedFiles = Array.isArray(pass.changedFiles) && pass.changedFiles.length
          ? `, ${pass.changedFiles.length} changed file entries`
          : "";
        return `${pass.label || pass.pass}: ${pass.status || "recorded"}${commit}${changedFiles}`;
      }).join("\n"),
      icon: "step",
      key: "review-passes",
      label: "Review Passes",
      available: reviewPasses.length > 0,
      value: `${reviewPasses.length} pass${reviewPasses.length === 1 ? "" : "es"} recorded`
    },
    {
      detail: githubCommentCount > 0 ? Object.keys(session.githubComments || {}).join(", ") : "",
      icon: "github",
      key: "github-comments",
      label: "GitHub Comments",
      available: githubCommentCount > 0,
      value: `${githubCommentCount} recorded`
    },
    {
      copyValue: session.agentDecisionsPath || agentDecisionsLatest,
      detail: session.agentDecisionsPath || "",
      expandable: Boolean(agentDecisionsLatest),
      expandedValue: agentDecisionsLatest,
      icon: "step",
      key: "agent-decisions",
      label: "Agent Decisions",
      available: Boolean(session.agentDecisionsPath || agentDecisionsLatest),
      value: agentDecisionsLatest ? "Latest decisions saved" : "Decision log saved"
    },
    {
      copyValue: session.blueprintPath || "",
      detail: session.blueprintPath || "",
      icon: "step",
      key: "blueprint",
      label: "Blueprint",
      available: Boolean(session.blueprintExists && session.blueprintPath),
      value: "App blueprint saved"
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
      copyValue: session.finalReportPath || finalReportText,
      detail: session.finalReportPath || "",
      expandable: Boolean(finalReportText),
      expandedValue: finalReportText,
      icon: "step",
      key: "final-report",
      label: "Final Report",
      available: Boolean(session.finalReportPath || finalReportText),
      value: "Final report saved"
    },
    {
      copyValue: session.commandLogPath || "",
      detail: session.commandLogPath || "",
      icon: "step",
      key: "command-log",
      label: "Command Log",
      available: Boolean(session.commandLogExists && session.commandLogPath),
      value: "Command log recorded"
    },
    {
      detail: session.prUrl ? issueTitle : "",
      href: session.prUrl || "",
      icon: "github",
      key: "pr",
      label: "Pull Request",
      available: Boolean(session.prUrl),
      value: session.prUrl ? prLink.label : ""
    },
    {
      detail: prOutcome?.reason || prOutcome?.mergedAt || "",
      icon: "github",
      key: "pr-outcome",
      label: "PR Outcome",
      available: Boolean(prOutcome?.outcome),
      value: issueSessionStatusLabel(prOutcome?.outcome || "")
    }
  ].filter((fact) => fact.available);
}

export {
  canUseIssueSessionTerminal,
  isAbandonedIssueSession,
  isClosedIssueSession,
  isOpenIssueSession,
  issueSessionCodexExpectedOutputs,
  issueSessionCodexPromptActionLabel,
  issueSessionCurrentStepLabel,
  issueSessionFacts,
  issueSessionStatusColor,
  issueSessionStatusLabel,
  issueSessionTitleFromIssueText,
  parseGithubSessionLink,
  shouldAutoInjectIssueSessionCodexPrompt,
  shouldUseManualIssueSessionCodexPrompt,
  shortIssueSessionId
};
