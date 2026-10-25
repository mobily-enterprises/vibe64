// GitHub rejects issue, comment and pull request bodies longer than this.
const GITHUB_BODY_MAX_LENGTH = 65536;

function githubProjectRepositoryName(project) {
  return project?.githubRepository?.fullName || project?.repository?.github?.fullName || "";
}

function githubProjectAvailable(project) {
  return Boolean(githubProjectRepositoryName(project)) && project?.repositoryMode !== "managed_git";
}

// The project's GitHub API paths sit beside its scoped issues path.
function githubIssuesSiblingPath(issuesPath, name) {
  return issuesPath.replace(/\/issues$/u, `/${name}`);
}

function githubIssueLabelsPath(issuesPath) {
  return githubIssuesSiblingPath(issuesPath, "issue-labels");
}

function githubIssueMentionsPath(issuesPath) {
  return githubIssuesSiblingPath(issuesPath, "issue-mentions");
}

function invalidateGithubIssueQueries(queryClient, basePath, issuePath) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ["vibe64.issue", issuePath] }),
    queryClient.invalidateQueries({ queryKey: ["vibe64.issues", basePath] }),
    queryClient.invalidateQueries({ queryKey: ["vibe64.issueMentions", githubIssueMentionsPath(basePath)] })
  ]);
}

// A GitHub refresh for the project: every GitHub list and item view rereads.
function invalidateGithubProjectQueries(queryClient, issuesPath) {
  const labelsPath = githubIssueLabelsPath(issuesPath);
  const mentionsPath = githubIssueMentionsPath(issuesPath);
  const prsPath = githubIssuesSiblingPath(issuesPath, "pull-requests");
  const incomingPath = githubIssuesSiblingPath(issuesPath, "incoming");
  return queryClient.invalidateQueries({
    predicate: ({ queryKey }) => {
      if (!Array.isArray(queryKey)) return false;
      const [resource, path] = queryKey;
      return (resource === "vibe64.issues" && path === issuesPath) ||
        (resource === "vibe64.issue" && path?.startsWith(`${issuesPath}/`)) ||
        (resource === "vibe64.issueLabels" && path === labelsPath) ||
        (resource === "vibe64.issueMentions" && path === mentionsPath) ||
        (["vibe64.pullRequests", "vibe64.pullRequest"].includes(resource) && path === prsPath) ||
        (resource === "vibe64.incoming" && path === incomingPath);
    }
  });
}

export {
  GITHUB_BODY_MAX_LENGTH,
  githubIssueLabelsPath,
  githubIssueMentionsPath,
  githubProjectAvailable,
  githubProjectRepositoryName,
  invalidateGithubIssueQueries,
  invalidateGithubProjectQueries
};
