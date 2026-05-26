import {
  normalizeText
} from "@local/ai-studio-core/server/core";
import {
  commitChangesTerminalSpec
} from "./workflowCommandTerminal/commitPush.js";
import {
  createIssueOnGhTerminalSpec,
  createPrOnGhTerminalSpec
} from "./workflowCommandTerminal/issuePr.js";
import {
  mergePrTerminalSpec,
  syncMainCheckoutTerminalSpec
} from "./workflowCommandTerminal/mergeSync.js";
import {
  createWorktreeBranch,
  createWorktreePath,
  createWorktreeTerminalSpec,
  installDependenciesTerminalSpec,
  runAutomatedChecksTerminalSpec,
  updateCodeIndexTerminalSpec
} from "./workflowCommandTerminal/worktreeDependencies.js";

const COMMAND_TERMINAL_SPECS = Object.freeze({
  commit_changes: commitChangesTerminalSpec,
  create_issue_on_gh: createIssueOnGhTerminalSpec,
  create_pr_on_gh: createPrOnGhTerminalSpec,
  create_worktree: createWorktreeTerminalSpec,
  install_dependencies: installDependenciesTerminalSpec,
  merge_pr: mergePrTerminalSpec,
  run_automated_checks: runAutomatedChecksTerminalSpec,
  sync_main_checkout: syncMainCheckoutTerminalSpec,
  update_code_index: updateCodeIndexTerminalSpec
});

async function createAiStudioWorkflowCommandTerminalSpec({
  commandId = "",
  context = {},
  hooks = {},
  prepareWorktreeScriptPath = "",
  targetRoot = ""
} = {}) {
  const createSpec = COMMAND_TERMINAL_SPECS[normalizeText(commandId)];
  if (!createSpec) {
    return {
      ok: false,
      message: `AI Studio workflow command ${commandId} is not implemented in the command terminal.`
    };
  }
  return createSpec({
    context,
    hooks,
    prepareWorktreeScriptPath,
    session: context.session || {},
    targetRoot
  });
}

export {
  createAiStudioWorkflowCommandTerminalSpec,
  createWorktreeBranch,
  createWorktreePath
};
