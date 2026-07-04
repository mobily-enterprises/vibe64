import { deepFreeze } from "@local/vibe64-core/server/deepFreeze";
import {
  WORKFLOW_REPOSITORY_PROFILE_CANONICAL_GIT,
  WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR,
  WORKFLOW_REPOSITORY_PROFILE_LOCAL_SOURCE,
  normalizeWorkflowRepositoryProfile
} from "@local/vibe64-core/server/projectRepository";

const CORE_COMPOSER_TEMPLATES = deepFreeze([
  {
    group: "Code",
    groupPath: ["Code", "Deslop"],
    icon: "bug-check",
    id: "core.deslop_changes",
    label: "Only changes",
    order: 21,
    promptId: "run_deslop",
    source: "core",
    systemPromptId: "deslop_changes"
  },
  {
    group: "Code",
    groupPath: ["Code", "Deslop"],
    icon: "code-review",
    id: "core.deslop_codebase",
    label: "Whole codebase",
    order: 20,
    promptId: "run_deslop",
    source: "core",
    systemPromptId: "deslop_codebase"
  },
  {
    group: "Code",
    groupPath: ["Code", "Check UI"],
    icon: "monitor-check",
    id: "core.check_ui_changes",
    label: "Only changes",
    order: 23,
    promptId: "run_deep_ui_check",
    source: "core",
    systemPromptId: "check_ui_changes"
  },
  {
    group: "Code",
    groupPath: ["Code", "Check UI"],
    icon: "monitor-check",
    id: "core.check_ui_codebase",
    label: "Whole codebase",
    order: 22,
    promptId: "run_deep_ui_check",
    source: "core",
    systemPromptId: "check_ui_codebase"
  },
  {
    group: "Info",
    icon: "code-review",
    id: "core.create_handover",
    label: "Create handover",
    order: 31,
    promptId: "fallback",
    source: "core",
    systemPromptId: "session_handover"
  },
]);

const SYNC_COMPOSER_TEMPLATES_BY_PROFILE = deepFreeze({
  [WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR]: {
    label: "Sync code with GitHub",
    systemPromptId: "sync_with_remote"
  },
  [WORKFLOW_REPOSITORY_PROFILE_CANONICAL_GIT]: {
    label: "Sync code with Vibe64 Git",
    systemPromptId: "sync_with_managed_git"
  },
  [WORKFLOW_REPOSITORY_PROFILE_LOCAL_SOURCE]: {
    label: "Sync code with local repo",
    systemPromptId: "sync_with_local_source"
  }
});

function syncComposerTemplate(session = {}) {
  const workflowRepositoryProfile = normalizeWorkflowRepositoryProfile(
    session.metadata?.workflow_repository_profile
  ) || WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR;
  const profileTemplate = SYNC_COMPOSER_TEMPLATES_BY_PROFILE[workflowRepositoryProfile] ||
    SYNC_COMPOSER_TEMPLATES_BY_PROFILE[WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR];
  return {
    group: "Git",
    icon: "sync",
    id: "core.sync_with_remote",
    label: profileTemplate.label,
    order: 10,
    promptId: "fallback",
    source: "core",
    systemPromptId: profileTemplate.systemPromptId
  };
}

function coreComposerTemplates(session = {}) {
  return [
    ...CORE_COMPOSER_TEMPLATES,
    syncComposerTemplate(session)
  ].map((template) => ({
    ...template
  }));
}

export {
  coreComposerTemplates,
  syncComposerTemplate
};
