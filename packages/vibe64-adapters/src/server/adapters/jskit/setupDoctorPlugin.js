import {
  createDoctorPluginToolkit
} from "@local/setup-doctor-core/server/doctorPluginToolkit";
import {
  createJskitProjectSetupTerminalActions,
  createJskitProjectSetupChecks
} from "./setupProjectChecks.js";

function createJskitSetupDoctorPlugin({
  configEnvironment = {},
  materializeRuntimeConfig = null,
  runtimeConfigEnvironment = null,
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

  return toolkit.plugin({
    id: "jskit-target-runtime",
    label: "JSKIT target runtime",

    checks() {
      const projectSetupChecks = createJskitProjectSetupChecks(toolkit, {
        materializeRuntimeConfig,
        runtimeConfigEnvironment
      });
      const nodeCheck = toolkit.hostCommandCheck({
        id: "node",
        label: "Node",
        commandArgs: ["node", "--version"],
        expected: "Node 22 is available on the host.",
        explanation: "JSKIT Project Setup runs package scripts through the host Node installation.",
        validate: (output) => /^v22\./u.test(output.trim())
      });
      const npmCheck = toolkit.hostCommandCheck({
        id: "npm",
        label: "npm",
        commandArgs: ["npm", "--version"],
        expected: "npm is available on the host.",
        explanation: "JSKIT Project Setup uses npm for installs and package scripts."
      });

      return [
        {
          expected: "Node 22 is available on the host.",
          id: "node",
          label: "Node",
          run() {
            return nodeCheck.run();
          }
        },
        {
          expected: "npm is available on the host.",
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
