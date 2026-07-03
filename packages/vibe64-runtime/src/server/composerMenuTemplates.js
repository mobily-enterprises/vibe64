import { deepFreeze } from "@local/vibe64-core/server/deepFreeze";

const CORE_COMPOSER_TEMPLATES = deepFreeze([
  {
    group: "Deslop",
    groupPath: ["Deslop"],
    icon: "bug-check",
    id: "core.deslop_changes",
    label: "Current changes",
    order: 20,
    promptId: "run_deslop",
    source: "core",
    systemPromptId: "deslop_changes"
  },
  {
    group: "Deslop",
    groupPath: ["Deslop"],
    icon: "code-review",
    id: "core.deslop_codebase",
    label: "The whole codebase",
    order: 10,
    promptId: "run_deslop",
    source: "core",
    systemPromptId: "deslop_codebase"
  },
  {
    group: "Check UI",
    groupPath: ["Check UI"],
    icon: "monitor-check",
    id: "core.check_ui_changes",
    label: "Current changes",
    order: 40,
    promptId: "run_deep_ui_check",
    source: "core",
    systemPromptId: "check_ui_changes"
  },
  {
    group: "Check UI",
    groupPath: ["Check UI"],
    icon: "monitor-check",
    id: "core.check_ui_codebase",
    label: "The whole codebase",
    order: 30,
    promptId: "run_deep_ui_check",
    source: "core",
    systemPromptId: "check_ui_codebase"
  },
  {
    group: "Ask Codex",
    icon: "code-review",
    id: "core.create_handover",
    label: "Create handover",
    order: 25,
    promptId: "fallback",
    source: "core",
    systemPromptId: "session_handover"
  },
  {
    group: "Git",
    icon: "sync",
    id: "core.sync_with_remote",
    label: "Sync code with GitHub",
    order: 10,
    promptId: "fallback",
    source: "core",
    systemPromptId: "sync_with_remote"
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
