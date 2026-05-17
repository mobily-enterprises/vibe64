import {
  acceptChangesTerminalSpec,
  commitChangesTerminalSpec,
  runAutomatedChecksTerminalSpec
} from "./commandTerminal/workflowCommands.js";
import {
  createIssueOnGhTerminalSpec,
  createPrOnGhTerminalSpec,
  mergePrTerminalSpec,
  syncMainCheckoutTerminalSpec
} from "./commandTerminal/githubCommands.js";
import {
  createWorktreeTerminalSpec,
  installDependenciesTerminalSpec
} from "./commandTerminal/worktreeCommands.js";

const COMMAND_TERMINAL_SPECS = Object.freeze({
  accept_changes: acceptChangesTerminalSpec,
  commit_changes: commitChangesTerminalSpec,
  create_issue_on_gh: createIssueOnGhTerminalSpec,
  create_pr_on_gh: createPrOnGhTerminalSpec,
  create_worktree: createWorktreeTerminalSpec,
  install_dependencies: installDependenciesTerminalSpec,
  merge_pr: mergePrTerminalSpec,
  run_automated_checks: runAutomatedChecksTerminalSpec,
  sync_main_checkout: syncMainCheckoutTerminalSpec
});

async function createJskitAiStudioCommandTerminalSpec({
  commandId = "",
  context = {},
  targetRoot = ""
} = {}) {
  const createSpec = COMMAND_TERMINAL_SPECS[commandId];
  if (!createSpec) {
    return {
      ok: false,
      message: `JSKIT command ${commandId} is not implemented in the command terminal yet.`
    };
  }
  return createSpec({
    context,
    session: context.session || {},
    targetRoot
  });
}

export { createJskitAiStudioCommandTerminalSpec };
