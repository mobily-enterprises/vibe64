const CLOSED_SESSION_STATUSES = new Set(["abandoned", "finished"]);
const REPORT_LABEL = "Report";

function shortVibe64SessionId(sessionId) {
  return String(sessionId || "").replace(/^\d{4}-/u, "");
}

function vibe64SessionDisplayTitle(session = {}) {
  const sessionName = firstText(session?.sessionName) || firstText(session?.metadata?.issue_word);
  if (sessionName) {
    return sessionName;
  }
  const issueTitle = firstText(session?.issueTitle);
  if (issueTitle) {
    return issueTitle;
  }
  const shortSessionId = shortVibe64SessionId(session?.sessionId);
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

function vibe64SessionStatusLabel(status) {
  return String(status || "pending").replaceAll("_", " ");
}

function vibe64SessionStatusColor(status) {
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

function isAbandonedVibe64Session(session = {}) {
  return String(session?.status || "") === "abandoned";
}

function isClosedVibe64Session(session = {}) {
  return CLOSED_SESSION_STATUSES.has(String(session?.status || ""));
}

function isOpenVibe64Session(session = {}) {
  return !isClosedVibe64Session(session);
}

function normalizedText(value) {
  return String(value || "").trim();
}

function firstText(...values) {
  return values.map(normalizedText).find(Boolean) || "";
}

function brokerOperationLabel(operation = "") {
  return normalizedText(operation).replaceAll("_", " ");
}

const GITHUB_BROKER_CONFIRMATION_PROMPTS = Object.freeze({
  comment_pr: "I confirm: comment on the pull request now.",
  commit_and_push: "I confirm: commit and push the current changes now.",
  commit_changes: "I confirm: commit the current changes now.",
  create_issue: "I confirm: create an issue now.",
  create_pr: "I confirm: create a pull request now.",
  merge_pr: "I confirm: merge the pull request now.",
  push_branch: "I confirm: push the current branch now.",
  sync_branch: "I confirm: sync the current branch now."
});

function githubBrokerConfirmationPrompt(operation = "") {
  const normalizedOperation = normalizedText(operation);
  return GITHUB_BROKER_CONFIRMATION_PROMPTS[normalizedOperation] ||
    `I confirm: ${brokerOperationLabel(normalizedOperation)} now.`;
}

function githubBrokerConfirmationState(session = {}) {
  const metadata = session.metadata || {};
  const operation = firstText(metadata.codex_github_broker_last_operation);
  const code = firstText(metadata.codex_github_broker_last_code);
  const required = Boolean(
    operation &&
    (
      normalizedText(metadata.codex_github_broker_last_needs_confirmation) === "yes" ||
      code === "vibe64_github_confirmation_required"
    )
  );
  return {
    label: operation ? brokerOperationLabel(operation) : "",
    operation,
    prompt: operation ? githubBrokerConfirmationPrompt(operation) : "",
    required
  };
}

function githubBrokerFact(session = {}) {
  const metadata = session.metadata || {};
  const operation = firstText(metadata.codex_github_broker_last_operation);
  if (!operation) {
    return null;
  }
  const ok = normalizedText(metadata.codex_github_broker_last_ok) === "yes";
  const code = firstText(metadata.codex_github_broker_last_code);
  const summary = firstText(metadata.codex_github_broker_last_summary);
  const confirmationRequired = normalizedText(metadata.codex_github_broker_last_needs_confirmation) === "yes" ||
    code === "vibe64_github_confirmation_required";
  const detail = confirmationRequired
    ? "Confirmation required"
    : ok
      ? firstText(summary, "Completed")
      : firstText(summary, code, "Failed");
  return {
    detail,
    icon: "github",
    key: "github-broker",
    label: "GitHub Broker",
    value: brokerOperationLabel(operation),
    visible: true
  };
}

function vibe64SessionCurrentStepLabel(session = {}, stepDefinitions = []) {
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

function buildVibe64SessionFacts(session = {}, stepDefinitions = []) {
  const issueTitle = firstText(session.issueTitle);
  const issueLink = parseGithubSessionLink(session.issueUrl, "issue");
  const prLink = parseGithubSessionLink(session.prUrl, "pr");
  const completedStepCount = Array.isArray(session.completedSteps) ? session.completedSteps.length : 0;
  const currentStepLabel = vibe64SessionCurrentStepLabel(session, stepDefinitions);
  const blueprintPath = firstText(session.blueprintPath);
  const prOutcome = session.prOutcome && typeof session.prOutcome === "object" ? session.prOutcome : null;
  const reportPath = firstText(session.reportPath);
  const workSource = firstText(session.workSource);
  const sourcePrLink = parseGithubSessionLink(session.sourcePrUrl, "pr");
  const workSourceDetail = workSource === "existing_pr"
    ? firstText(session.sourcePrTitle, session.sourcePrUpdateMode === "stacked" ? "Stacked PR base" : session.sourcePrUpdateMode)
    : workSource === "existing_issue"
      ? issueTitle
      : "New branch";
  const workSourceHref = workSource === "existing_pr"
    ? session.sourcePrUrl || ""
    : workSource === "existing_issue"
      ? session.issueUrl || ""
      : "";
  const workSourceValue = workSource === "existing_pr"
    ? `Stack on ${sourcePrLink.label}`
    : workSource === "existing_issue"
      ? issueLink.label
      : "New branch";
  const brokerFact = githubBrokerFact(session);

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
      value: shortVibe64SessionId(session.sessionId),
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
      detail: workSourceDetail,
      href: workSourceHref,
      icon: "github",
      key: "work-source",
      label: "Work Source",
      value: workSourceValue,
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
      value: vibe64SessionStatusLabel(prOutcome?.outcome || ""),
      visible: Boolean(prOutcome?.outcome)
    },
    brokerFact
  ].filter((fact) => fact?.visible);
}

export {
  isAbandonedVibe64Session,
  isClosedVibe64Session,
  isOpenVibe64Session,
  vibe64SessionDisplayTitle,
  buildVibe64SessionFacts,
  githubBrokerConfirmationPrompt,
  githubBrokerConfirmationState,
  vibe64SessionStatusColor,
  vibe64SessionStatusLabel,
  parseGithubSessionLink,
  shortVibe64SessionId
};
