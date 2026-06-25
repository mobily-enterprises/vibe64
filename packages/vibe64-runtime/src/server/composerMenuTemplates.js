import { deepFreeze } from "@local/vibe64-core/server/deepFreeze";

const CORE_COMPOSER_TEMPLATES = deepFreeze([
  {
    group: "Ask Codex",
    icon: "bug-check",
    id: "core.deslop_changes",
    label: "Deslop changes",
    order: 10,
    promptId: "run_deslop",
    source: "core",
    systemPromptId: "deslop_changes"
  },
  {
    group: "Ask Codex",
    icon: "code-review",
    id: "core.deslop_codebase",
    label: "Deslop codebase",
    order: 20,
    promptId: "run_deslop",
    source: "core",
    systemPromptId: "deslop_codebase"
  },
  {
    group: "Git",
    icon: "sync",
    id: "core.sync_with_remote",
    label: "Sync with remote",
    order: 10,
    promptId: "fallback",
    source: "core",
    systemPromptId: "sync_with_remote"
  },
  {
    group: "Git",
    icon: "source-commit",
    id: "core.push_session_to_remote",
    label: "Push session to remote",
    order: 20,
    promptId: "fallback",
    source: "core",
    systemPromptId: "push_session_to_remote"
  }
]);

function coreComposerTemplates() {
  return CORE_COMPOSER_TEMPLATES.map((template) => ({
    ...template
  }));
}

export {
  coreComposerTemplates
};
