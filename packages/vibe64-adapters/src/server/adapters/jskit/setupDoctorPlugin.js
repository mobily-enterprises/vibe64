import {
  createDoctorPluginToolkit
} from "@local/setup-doctor-core/server/doctorPluginToolkit";
import {
  createDoctorRepair,
  failDoctorCheck,
  passDoctorCheck
} from "@local/vibe64-core/server/doctorCheckItems";
import {
  VIBE64_RUNTIME_LOCK_FILE,
  runtimeToolCommandArgs,
  runtimeToolVersionMatches,
  validateRuntimeLock
} from "@local/vibe64-core/server/runtimeToolchain";
import {
  createJskitProjectSetupTerminalActions,
  createJskitProjectSetupChecks
} from "./setupProjectChecks.js";

function createJskitSetupDoctorPlugin({
  config = {},
  configEnvironment = {},
    runtimeRequirements = null,
    materializeRuntimeConfig = null,
    runtimeConfigEnvironment = null,
    serviceDataRoot = "",
    startTerminalSession,
    studioRoot = "",
    targetRoot = "",
    terminalNamespace = ""
} = {}) {
  const toolkit = createDoctorPluginToolkit({
    startTerminalSession,
    studioRoot,
    targetRoot,
    terminalEnv: configEnvironment,
    terminalNamespace
  });

  const runtimeLockRepair = createDoctorRepair({
    actionId: "save-project-runtime-config",
    command: "Save Project config to regenerate vibe64.runtime-lock.json",
    kind: "manual",
    label: "Regenerate runtime lock"
  });

  function runtimeLockCheck() {
    return {
      expected: "The source-owned Vibe64 runtime lock matches the JSKIT adapter config.",
      id: "runtime-lock",
      label: "Runtime lock",
      async run(context = {}) {
        if (typeof runtimeRequirements !== "function") {
          return failDoctorCheck({
            expected: "The JSKIT adapter declares runtime requirements.",
            explanation: "Doctor validates the runtime lock from adapter-owned requirements.",
            id: "runtime-lock",
            label: "Runtime lock",
            observed: "Runtime requirement resolver is unavailable."
          });
        }
        const projectConfig = context.config || config || {};
        let requirements = [];
        try {
          requirements = await runtimeRequirements({
            config: projectConfig,
            projectType: {
              projectType: projectConfig.projectType || "jskit"
            },
            targetRoot: context.targetRoot || targetRoot
          });
        } catch (error) {
          return failDoctorCheck({
            expected: "The selected JSKIT runtime is supported by Vibe64.",
            explanation: "Unsupported adapter runtime choices must be changed before Doctor can realize binaries or services.",
            id: "runtime-lock",
            label: "Runtime lock",
            observed: error?.message || error,
            repair: runtimeLockRepair
          });
        }
        const lockResult = await toolkit.readTargetJson(VIBE64_RUNTIME_LOCK_FILE, {
          targetRoot: context.targetRoot || targetRoot
        });
        if (!lockResult.ok) {
          return failDoctorCheck({
            expected: "A source-owned vibe64.runtime-lock.json file exists.",
            explanation: "The runtime lock is generated from the Vibe64 catalog and JSKIT project config.",
            id: "runtime-lock",
            label: "Runtime lock",
            observed: lockResult.missing ? "missing" : lockResult.error,
            repair: runtimeLockRepair
          });
        }
        const validation = validateRuntimeLock(lockResult.value, {
          adapterId: "jskit",
          projectType: projectConfig.projectType || "jskit",
          runtimeRequirements: requirements
        });
        if (!validation.ok) {
          return failDoctorCheck({
            expected: "Runtime lock package ids match the selected JSKIT config.",
            explanation: "A stale runtime lock means the source config and realized runtime contract disagree.",
            id: "runtime-lock",
            label: "Runtime lock",
            observed: validation.error,
            repair: runtimeLockRepair
          });
        }
        return passDoctorCheck({
          expected: "Runtime lock package ids match the selected JSKIT config.",
          explanation: "Doctor will run JSKIT checks through the locked Vibe64 runtime packages.",
          id: "runtime-lock",
          label: "Runtime lock",
          observed: validation.expectedPackageIds.join(", ")
        });
      }
    };
  }

  return toolkit.plugin({
    id: "jskit-target-runtime",
    label: "JSKIT target runtime",

    checks() {
        const projectSetupChecks = createJskitProjectSetupChecks(toolkit, {
          materializeRuntimeConfig,
          runtimeConfigEnvironment,
          serviceDataRoot
        });
      const nodeCheck = toolkit.hostCommandCheck({
        id: "node",
        label: "Node",
        commandArgs: runtimeToolCommandArgs("nodejs-22", "node"),
        expected: "Node 22 is available through the Vibe64 runtime toolchain.",
        explanation: "JSKIT Project Setup runs package scripts through the Vibe64-selected Node runtime.",
        validate: (output) => runtimeToolVersionMatches(output, "nodejs-22", "node")
      });
      const npmCheck = toolkit.hostCommandCheck({
        id: "npm",
        label: "npm",
        commandArgs: runtimeToolCommandArgs("nodejs-22", "npm"),
        expected: "npm is available through the Vibe64 runtime toolchain.",
        explanation: "JSKIT Project Setup uses npm from the Vibe64-selected Node runtime.",
        validate: (output) => runtimeToolVersionMatches(output, "nodejs-22", "npm")
      });

      return [
        runtimeLockCheck(),
        {
          expected: "Node 22 is available through the Vibe64 runtime toolchain.",
          id: "node",
          label: "Node",
          run() {
            return nodeCheck.run();
          }
        },
        {
          expected: "npm is available through the Vibe64 runtime toolchain.",
          id: "npm",
          label: "npm",
          run() {
            return npmCheck.run();
          }
        },
        projectSetupChecks.scaffold,
        projectSetupChecks.dependencies,
        projectSetupChecks.runtimeServices,
        projectSetupChecks.verificationCommand
      ];
    },
    terminalActions(context = {}) {
      return [
          ...createJskitProjectSetupTerminalActions({
            materializeRuntimeConfig,
            runtimeConfigEnvironment,
            serviceDataRoot,
            targetRoot: context.targetRoot || targetRoot,
            toolkit
          })
      ];
    }
  });
}

export {
  createJskitSetupDoctorPlugin
};
