import { deepFreeze } from "@local/vibe64-core/server/deepFreeze";

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
