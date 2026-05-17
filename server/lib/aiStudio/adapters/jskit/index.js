import {
  JSKIT_CONFIG_FIELDS,
  JSKIT_MARKERS,
  JSKIT_PROMPT_PACK_ROOT,
  JskitTargetAdapter
} from "./adapter.js";
import {
  deepFreeze
} from "../../deepFreeze.js";
import {
  createJskitAiStudioCommandTerminalSpec
} from "./commandTerminalSpecs.js";
export {
  DEFAULT_TARGET_SCRIPT_NAMES,
  createJskitTargetScriptTerminalSpec,
  inspectJskitCurrentApp,
  inspectJskitTargetScripts,
  targetScriptCommandPreview,
  targetScriptTerminalArgs
} from "./currentApp.js";

const JSKIT_AI_STUDIO_COMMANDS = deepFreeze([
  {
    id: "accept_changes",
    label: "Accept changes"
  },
  {
    id: "commit_changes",
    label: "Commit changes"
  },
  {
    id: "create_issue_on_gh",
    label: "Create issue on GH"
  },
  {
    id: "create_pr_on_gh",
    label: "Create PR on GH"
  },
  {
    id: "create_worktree",
    label: "Create worktree"
  },
  {
    id: "finish_session",
    label: "Finish session"
  },
  {
    id: "install_dependencies",
    label: "Install dependencies"
  },
  {
    id: "merge_pr",
    label: "Merge PR"
  },
  {
    id: "run_automated_checks",
    label: "Run automated checks"
  },
  {
    id: "sync_main_checkout",
    label: "Sync main checkout"
  }
]);

function createJskitTargetAdapter({
  commandTerminalSpecFactory = createJskitAiStudioCommandTerminalSpec
} = {}) {
  return new JskitTargetAdapter({
    commandTerminalSpecFactory,
    commands: JSKIT_AI_STUDIO_COMMANDS
  });
}

export {
  createJskitTargetAdapter,
  createJskitAiStudioCommandTerminalSpec,
  JSKIT_CONFIG_FIELDS,
  JSKIT_MARKERS,
  JSKIT_PROMPT_PACK_ROOT,
  JSKIT_AI_STUDIO_COMMANDS,
  JskitTargetAdapter
};
