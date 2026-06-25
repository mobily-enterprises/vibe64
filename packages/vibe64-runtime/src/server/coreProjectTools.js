import {
  projectSyncMainCheckoutTerminalSpec
} from "@local/vibe64-adapters/server/workflowCommandTerminal/mergeSync";
import {
  normalizeText
} from "@local/vibe64-core/server/core";
import {
  deepFreeze
} from "@local/vibe64-core/server/deepFreeze";
import {
  createProjectToolRegistry,
  registerProjectToolContributorModules
} from "./projectToolRegistry.js";

function projectToolsReady(context = {}) {
  return context.projectReady !== false;
}

function projectToolsDisabledReason(context = {}) {
  return normalizeText(context.projectMessage) || "Save Vibe64 project configuration before using project tools.";
}

const coreProjectToolModule = deepFreeze({
  id: "core",
  tools: [
    {
      id: "sync_main_with_main",
      label: "Refresh Git cache",
      description: "Fetch and prune the private Git cache from origin.",
      type: "command",
      parameters: [],
      enabled: projectToolsReady,
      disabledReason: (context) => projectToolsReady(context) ? "" : projectToolsDisabledReason(context),
      async command(context = {}) {
        return projectSyncMainCheckoutTerminalSpec({
          baseBranch: normalizeText(context.baseBranch) || "main",
          targetRoot: context.targetRoot
        });
      }
    }
  ]
});

const coreProjectToolModules = deepFreeze([
  coreProjectToolModule
]);

function registerCoreProjectToolModules(registry) {
  return registerProjectToolContributorModules(registry, {
    toolModules: coreProjectToolModules
  });
}

function createCoreProjectToolRegistry({
  toolModules = []
} = {}) {
  const registry = createProjectToolRegistry();
  registerCoreProjectToolModules(registry);
  return registerProjectToolContributorModules(registry, {
    toolModules
  });
}

export {
  coreProjectToolModule,
  coreProjectToolModules,
  createCoreProjectToolRegistry,
  registerCoreProjectToolModules
};
