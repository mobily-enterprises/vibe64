import {
  WORKFLOW_REPOSITORY_PROFILE_CANONICAL_GIT,
  WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR,
  WORKFLOW_REPOSITORY_PROFILE_LOCAL_SOURCE,
  normalizeWorkflowRepositoryProfile,
  workflowRepositoryProfileForMode
} from "@local/vibe64-core/server/projectRepository";
import {
  normalizeText
} from "@local/vibe64-core/server/core";

function workflowRepositoryProfileForCommandSession(session = {}) {
  return normalizeWorkflowRepositoryProfile(session.metadata?.workflow_repository_profile) ||
    workflowRepositoryProfileForMode(session.metadata?.repository_mode) ||
    (normalizeText(session.metadata?.github_repository) ? WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR : "") ||
    WORKFLOW_REPOSITORY_PROFILE_LOCAL_SOURCE;
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
