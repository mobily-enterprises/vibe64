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

export {
  canUseIssueSessionTerminal,
  isAbandonedIssueSession,
  isClosedIssueSession,
  isOpenIssueSession,
  issueSessionCodexExpectedOutputs,
  issueSessionCodexPromptActionLabel,
  issueSessionStatusColor,
  issueSessionStatusLabel,
  issueSessionTitleFromIssueText,
  parseGithubSessionLink,
  shouldAutoInjectIssueSessionCodexPrompt,
  shouldUseManualIssueSessionCodexPrompt,
  shortIssueSessionId
};
