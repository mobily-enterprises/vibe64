import {
  WORKFLOW_REPOSITORY_PROFILE_CANONICAL_GIT,
  WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR,
  WORKFLOW_REPOSITORY_PROFILE_LOCAL_SOURCE,
  normalizeWorkflowRepositoryProfile,
  workflowRepositoryProfileForMode
} from "@local/vibe64-core/server/projectRepository";

function workflowRepositoryProfileForCommandSession(session = {}) {
  return normalizeWorkflowRepositoryProfile(session.metadata?.workflow_repository_profile) ||
    workflowRepositoryProfileForMode(session.metadata?.repository_mode);
}

function repositoryCommandProfileForSession(session = {}) {
  const workflowRepositoryProfile = workflowRepositoryProfileForCommandSession(session);
  const githubPr = workflowRepositoryProfile === WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR;
  const canonicalGit = workflowRepositoryProfile === WORKFLOW_REPOSITORY_PROFILE_CANONICAL_GIT;
  const localSource = workflowRepositoryProfile === WORKFLOW_REPOSITORY_PROFILE_LOCAL_SOURCE;
  return {
    canonicalGit,
    githubAuthRequired: githubPr,
    githubForkFallbackAllowed: githubPr,
    githubPr,
    localSource,
    workflowRepositoryProfile
  };
}

export {
  repositoryCommandProfileForSession,
  workflowRepositoryProfileForCommandSession
};
