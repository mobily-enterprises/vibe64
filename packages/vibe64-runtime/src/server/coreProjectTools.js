import {
  configTextValue
} from "@local/vibe64-adapters/server/configValues";
import {
  VIBE64_DEPLOY_PRODUCTION_COMMAND_CONFIG,
  VIBE64_DEPLOY_STAGING_COMMAND_CONFIG
} from "@local/vibe64-adapters/server/configStore";
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

function projectConfigCommand(context = {}, fieldId = "") {
  return configTextValue(context.config || context.projectConfig || {}, fieldId);
}

function projectToolsReady(context = {}) {
  return context.projectReady !== false;
}

function projectToolsDisabledReason(context = {}) {
  return normalizeText(context.projectMessage) || "Save Vibe64 project configuration before using project tools.";
}

function deployCommandDisabledReason(label = "", fieldId = "") {
  return `Configure ${fieldId} before using ${label}.`;
}

function deployCommandTool({
  configFieldId = "",
  description = "",
  id = "",
  label = ""
} = {}) {
  return {
    id,
    label,
    description,
    type: "command",
    parameters: [],
    requiresConfirmation: true,
    confirmationMessage: `${label} will run the saved deploy command against the main project checkout.`,
    enabled: (context) => projectToolsReady(context) && Boolean(projectConfigCommand(context, configFieldId)),
    disabledReason: (context) => {
      if (!projectToolsReady(context)) {
        return projectToolsDisabledReason(context);
      }
      return projectConfigCommand(context, configFieldId)
        ? ""
        : deployCommandDisabledReason(label, configFieldId);
    },
    async command(context = {}) {
      const command = projectConfigCommand(context, configFieldId);
      return {
        args: [
          "-lc",
          command
        ],
        command: "bash",
        commandPreview: command,
        cwd: context.targetRoot,
        ok: true
      };
    }
  };
}

const coreProjectToolModule = deepFreeze({
  id: "core",
  tools: [
    deployCommandTool({
      configFieldId: VIBE64_DEPLOY_PRODUCTION_COMMAND_CONFIG,
      description: "Run the configured production deployment command from the main project checkout.",
      id: "push_to_production",
      label: "Push to production"
    }),
    deployCommandTool({
      configFieldId: VIBE64_DEPLOY_STAGING_COMMAND_CONFIG,
      description: "Run the configured staging deployment command from the main project checkout.",
      id: "push_to_staging",
      label: "Push to staging"
    }),
    {
      id: "sync_main_with_main",
      label: "Sync main with main",
      description: "Fetch, checkout, and fast-forward the main checkout from origin.",
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
