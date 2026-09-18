function githubProjectRepositoryName(project) {
  return project?.githubRepository?.fullName || project?.repository?.github?.fullName || "";
}

function githubProjectAvailable(project) {
  return Boolean(githubProjectRepositoryName(project)) && project?.repositoryMode !== "managed_git";
}

function invalidateGithubIssueQueries(queryClient, basePath, issuePath) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ["vibe64.issue", issuePath] }),
    queryClient.invalidateQueries({ queryKey: ["vibe64.issues", basePath] })
  ]);
}

export { githubProjectAvailable, githubProjectRepositoryName, invalidateGithubIssueQueries };
