function githubProjectRepositoryName(project) {
  return project?.githubRepository?.fullName || project?.repository?.github?.fullName || "";
}

function githubProjectAvailable(project) {
  return Boolean(githubProjectRepositoryName(project)) && project?.repositoryMode !== "managed_git";
}

export { githubProjectAvailable, githubProjectRepositoryName };
