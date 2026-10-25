function githubProjectRepositoryName(project) {
  return project?.githubRepository?.fullName || project?.repository?.github?.fullName || "";
}

function githubProjectAvailable(project) {
  return Boolean(githubProjectRepositoryName(project)) && project?.repositoryMode !== "managed_git";
}

function invalidateGithubIssueQueries(queryClient, basePath, issuePath) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ["vibe64.issue", issuePath] }),
    queryClient.invalidateQueries({ queryKey: ["vibe64.issues", basePath] }),
    queryClient.invalidateQueries({ queryKey: ["vibe64.issueMentions", basePath.replace(/\/issues$/u, "/issue-mentions")] })
  ]);
}

// A GitHub refresh for the project: every GitHub list and item view rereads.
// The project's GitHub API paths sit beside its scoped issues path.
function invalidateGithubProjectQueries(queryClient, issuesPath) {
  const apiPath = name => issuesPath.replace(/\/issues$/u, `/${name}`);
  const labelsPath = apiPath("issue-labels");
  const mentionsPath = apiPath("issue-mentions");
  const prsPath = apiPath("pull-requests");
  const incomingPath = apiPath("incoming");
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

export { githubProjectAvailable, githubProjectRepositoryName, invalidateGithubIssueQueries, invalidateGithubProjectQueries };
