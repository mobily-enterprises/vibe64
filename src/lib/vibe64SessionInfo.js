import {
  mdiCalendarClockOutline,
  mdiFolderHomeOutline,
  mdiFolderOutline,
  mdiGithub,
  mdiIdentifier,
  mdiRobotOutline,
  mdiSourceBranch,
  mdiSourceCommit
} from "@mdi/js";
import {
  vibe64SessionPullRequest,
  shortVibe64SessionId
} from "@/lib/vibe64SessionViewModel.js";

function text(value = "") {
  return String(value || "").trim();
}

function plainObject(value = null) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function safeRepositoryRemote(value = "") {
  const remote = text(value);
  if (!remote || /[\r\n\0]/u.test(remote)) {
    return "";
  }
  try {
    const url = new URL(remote);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    // Git's common SCP-style remotes have no URL credential/query surface.
    return /^git@[^\s/:]+:[^\s]+$/u.test(remote) ? remote : "";
  }
}

function githubRepositoryName(project = {}) {
  const github = plainObject(project.githubRepository || project.repository?.github);
  return text(github.fullName || github.repository || github.name);
}

function repositoryFact(session = {}, project = {}) {
  const metadata = plainObject(session.metadata);
  const fullName = githubRepositoryName(project);
  const remote = safeRepositoryRemote(
    metadata.source_remote_url ||
    project.repository?.github?.cloneUrl ||
    project.githubRepository?.cloneUrl ||
    project.repository?.remoteUrl
  );
  if (!fullName && !remote) {
    return null;
  }
  const href = remote.startsWith("https://") || remote.startsWith("http://")
    ? remote.replace(/\.git$/u, "")
    : "";
  return {
    copyValue: remote || fullName,
    detail: remote && fullName ? remote : "Canonical Git remote",
    href,
    icon: mdiGithub,
    key: "repository",
    label: "Repository",
    value: fullName || remote
  };
}

function vibe64SessionInfoFacts(session = null, project = {}) {
  if (!session || typeof session !== "object" || Array.isArray(session)) {
    return [];
  }
  const metadata = plainObject(session.metadata);
  const agentSession = plainObject(session.agentSession);
  const agentThread = plainObject(agentSession.thread);
  const agentTurn = plainObject(agentSession.turn);
  const sessionId = text(session.sessionId);
  const sessionRoot = text(session.sessionRoot);
  const sourcePath = text(session.sourcePath || session.source || metadata.source_path);
  const projectSource = text(project.sourceRoot);
  const branch = text(metadata.branch || session.branch);
  const baseBranch = text(metadata.base_branch || metadata.source_default_branch);
  const baseCommit = text(metadata.base_commit);
  const threadId = text(agentThread.id || agentTurn.threadId);
  const turnId = text(agentTurn.id || agentTurn.turnId);
  const createdAt = text(session.manifest?.createdAt || session.createdAt);
  const repository = repositoryFact(session, project);
  const pullRequest = vibe64SessionPullRequest(session);

  return [
    ...(pullRequest ? [{
      key: "pull-request", label: pullRequest.number ? `PR #${pullRequest.number}` : "Pull request branch",
      value: pullRequest.title || pullRequest.headBranch, href: pullRequest.url, icon: mdiGithub,
      detail: `Save to ${pullRequest.headRepository}:${pullRequest.headBranch}`
    }, {
      key: "save-destination", label: "Save destination", value: `${pullRequest.headRepository}:${pullRequest.headBranch}`,
      icon: mdiSourceBranch, detail: "Save updates this pull request branch"
    }] : []),
    {
      copyValue: sessionId,
      detail: "Vibe64 session identifier",
      icon: mdiIdentifier,
      key: "session",
      label: "Session",
      value: shortVibe64SessionId(sessionId),
      visible: Boolean(sessionId)
    },
    {
      copyValue: sourcePath,
      detail: session.sourceReady === false ? "Session source is not ready" : "Session source",
      icon: mdiFolderOutline,
      key: "source",
      label: "Source",
      value: sourcePath,
      visible: Boolean(sourcePath)
    },
    {
      copyValue: projectSource,
      detail: "Project checkout used as the session baseline",
      icon: mdiFolderHomeOutline,
      key: "project-source",
      label: "Project baseline",
      value: projectSource,
      visible: Boolean(projectSource && projectSource !== sourcePath)
    },
    {
      copyValue: sessionRoot,
      detail: "Vibe64 conversation and runtime state",
      icon: mdiFolderOutline,
      key: "session-state",
      label: "Session state",
      value: sessionRoot,
      visible: Boolean(sessionRoot)
    },
    {
      copyValue: branch,
      detail: "Session branch remains recoverable in Git",
      icon: mdiSourceBranch,
      key: "branch",
      label: "Branch",
      value: branch,
      visible: Boolean(branch)
    },
    {
      copyValue: baseBranch,
      detail: baseCommit ? `Based on ${baseCommit.slice(0, 12)}` : "Project branch cloned for this session",
      icon: mdiSourceBranch,
      key: "base-branch",
      label: "Base branch",
      value: baseBranch,
      visible: Boolean(baseBranch)
    },
    {
      copyValue: baseCommit,
      detail: "Exact project baseline commit",
      icon: mdiSourceCommit,
      key: "base-commit",
      label: "Base commit",
      value: baseCommit.slice(0, 12),
      visible: Boolean(baseCommit)
    },
    repository,
    {
      copyValue: threadId,
      detail: "Provider thread used to continue this conversation",
      icon: mdiRobotOutline,
      key: "agent-thread",
      label: "Agent thread",
      value: threadId,
      visible: Boolean(threadId)
    },
    {
      copyValue: turnId,
      detail: "Most recently observed provider turn",
      icon: mdiRobotOutline,
      key: "agent-turn",
      label: "Agent turn",
      value: turnId,
      visible: Boolean(turnId)
    },
    {
      copyValue: createdAt,
      detail: "Session creation time",
      icon: mdiCalendarClockOutline,
      key: "created-at",
      label: "Created",
      value: createdAt,
      visible: Boolean(createdAt)
    }
  ].filter((fact) => fact?.visible !== false && fact?.value);
}

function vibe64SessionInfoText(facts = [], { status = "" } = {}) {
  const lines = (Array.isArray(facts) ? facts : [])
    .map((fact) => {
      const value = text(fact?.copyValue || fact?.value);
      return value ? `${text(fact?.label) || "Value"}: ${value}` : "";
    })
    .filter(Boolean);
  const normalizedStatus = text(status);
  if (normalizedStatus) {
    lines.splice(1, 0, `Status: ${normalizedStatus.replaceAll("_", " ")}`);
  }
  return lines.join("\n");
}

export {
  safeRepositoryRemote,
  vibe64SessionInfoFacts,
  vibe64SessionInfoText
};
