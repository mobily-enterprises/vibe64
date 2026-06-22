import {
  createDoctorPluginToolkit
} from "@local/setup-doctor-core/server/doctorPluginToolkit";
import {
  checkAdapterToolchainImage,
  missingAdapterToolchainCheck
} from "../../adapterToolchains.js";
import {
  createJskitProjectSetupTerminalActions,
  createJskitProjectSetupChecks
} from "./setupProjectChecks.js";
import {
  JSKIT_TOOLCHAIN_IMAGE
} from "./toolchainIdentity.js";

async function checkJskitToolchainImage(toolkit) {
  return checkAdapterToolchainImage(toolkit, {
    explanation: "The JSKIT adapter toolchain image must be available locally before workspaces run JSKIT setup commands.",
    id: "jskit-toolchain-image",
    image: JSKIT_TOOLCHAIN_IMAGE,
    label: "JSKIT toolchain image",
  });
}

function missingJskitToolchainCheck({
  expected = "",
  id = "",
  label = ""
} = {}) {
  return missingAdapterToolchainCheck({
    id,
    label,
    expected
  });
}

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
      let jskitToolchainReady = false;
      const projectSetupChecks = createJskitProjectSetupChecks(toolkit, {
        materializeRuntimeConfig,
        runtimeConfigEnvironment
      });
      const nodeCheck = toolkit.toolchainCommandCheck({
        id: "node",
        label: "Node",
        commandArgs: ["node", "--version"],
        expected: "Node 22 runs inside the JSKIT adapter toolchain.",
        explanation: "JSKIT Project Setup runs package scripts through Node.",
        image: JSKIT_TOOLCHAIN_IMAGE,
        validate: (output) => /^v22\./u.test(output.trim())
      });
      const npmCheck = toolkit.toolchainCommandCheck({
        id: "npm",
        label: "npm",
        commandArgs: ["npm", "--version"],
        expected: "npm runs inside the JSKIT adapter toolchain.",
        explanation: "JSKIT Project Setup uses npm for installs and package scripts.",
        image: JSKIT_TOOLCHAIN_IMAGE
      });
      const mariaDbClientCheck = toolkit.toolchainCommandCheck({
        id: "mariadb-client",
        label: "MariaDB client",
        commandArgs: ["bash", "-lc", "command -v mariadb && mariadb --version"],
        expected: "MariaDB CLI runs inside the JSKIT adapter toolchain.",
        explanation: "JSKIT Project Setup uses the MariaDB CLI to validate whichever database endpoint .env selects.",
        image: JSKIT_TOOLCHAIN_IMAGE,
        validate: (output) => /mariadb/iu.test(output)
      });

      return [
        {
          expected: `${JSKIT_TOOLCHAIN_IMAGE} exists locally.`,
          id: "jskit-toolchain-image",
          label: "JSKIT toolchain image",
          async run() {
            const result = await checkJskitToolchainImage(toolkit);
            jskitToolchainReady = result.status === "pass";
            return result;
          }
        },
        {
          expected: "Node 22 runs inside the JSKIT adapter toolchain.",
          id: "node",
          label: "Node",
          run() {
            return jskitToolchainReady
              ? nodeCheck.run()
              : missingJskitToolchainCheck({
                id: "node",
                label: "Node",
                expected: "Node runs inside the JSKIT adapter toolchain."
              });
          }
        },
        {
          expected: "npm runs inside the JSKIT adapter toolchain.",
          id: "npm",
          label: "npm",
          run() {
            return jskitToolchainReady
              ? npmCheck.run()
              : missingJskitToolchainCheck({
                id: "npm",
                label: "npm",
                expected: "npm runs inside the JSKIT adapter toolchain."
              });
          }
        },
        {
          expected: "MariaDB CLI runs inside the JSKIT adapter toolchain.",
          id: "mariadb-client",
          label: "MariaDB client",
          run() {
            return jskitToolchainReady
              ? mariaDbClientCheck.run()
              : missingJskitToolchainCheck({
                id: "mariadb-client",
                label: "MariaDB client",
                expected: "MariaDB CLI runs inside the JSKIT adapter toolchain."
              });
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
          targetRoot: context.targetRoot || targetRoot,
          toolkit
        })
      ];
    }
  });
}

export {
  createJskitSetupDoctorPlugin,
  JSKIT_TOOLCHAIN_IMAGE
};
