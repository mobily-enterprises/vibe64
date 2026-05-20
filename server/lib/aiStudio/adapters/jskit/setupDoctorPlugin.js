import {
  createDoctorPluginToolkit
} from "../../../doctorPluginToolkit.js";
import {
  STUDIO_BASE_TOOLCHAIN_IMAGE
} from "../../../studioRuntimeIdentity.js";
import {
  adapterToolchainBuildRepair,
  adapterToolchainBuildScript,
  checkAdapterToolchainImage,
  missingAdapterToolchainCheck
} from "../../adapterToolchains.js";
import {
  createJskitMariaDbRuntimeContainer,
  JSKIT_MARIADB_HOST,
  readDatabaseHostFromDotEnv,
  targetWantsJskitMariaDb
} from "./setupMariaDbRuntime.js";
import {
  createRuntimeContainerDoctorEntries
} from "../../runtimeContainers.js";
import {
  createJskitProjectSetupTerminalActions,
  createJskitProjectSetupChecks
} from "./setupProjectChecks.js";
import {
  JSKIT_TOOLCHAIN_IMAGE
} from "./toolchainIdentity.js";

const JSKIT_TOOLCHAIN_DOCKERFILE = "tooling/adapters/jskit/Dockerfile";
const JSKIT_TOOLCHAIN_CONTEXT = "tooling/adapters/jskit";

function buildJskitToolchainScript() {
  return adapterToolchainBuildScript({
    baseImage: STUDIO_BASE_TOOLCHAIN_IMAGE,
    context: JSKIT_TOOLCHAIN_CONTEXT,
    dockerfile: JSKIT_TOOLCHAIN_DOCKERFILE,
    image: JSKIT_TOOLCHAIN_IMAGE
  });
}

function buildJskitToolchainRepair() {
  return adapterToolchainBuildRepair({
    actionId: "build-jskit-toolchain",
    baseImage: STUDIO_BASE_TOOLCHAIN_IMAGE,
    context: JSKIT_TOOLCHAIN_CONTEXT,
    dockerfile: JSKIT_TOOLCHAIN_DOCKERFILE,
    image: JSKIT_TOOLCHAIN_IMAGE,
    label: "Build JSKIT toolchain"
  });
}

async function checkJskitToolchainImage(toolkit) {
  return checkAdapterToolchainImage(toolkit, {
    buildRepair: buildJskitToolchainRepair(),
    explanation: "Build the JSKIT adapter toolchain before running JSKIT setup commands.",
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
    buildRepair: buildJskitToolchainRepair(),
    id,
    label,
    expected
  });
}

function createJskitSetupDoctorPlugin({
  configEnvironment = {},
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
  const buildToolchainTerminal = toolkit.shellTerminalAction({
    actionId: "build-jskit-toolchain",
    autoRun: true,
    commandPreview: () => buildJskitToolchainRepair().commandPreview,
    cwd: ({ targetRoot = "" } = {}) => studioRoot || targetRoot,
    env: configEnvironment,
    label: "Build JSKIT toolchain",
    script: buildJskitToolchainScript
  });
  const mariaDbContainer = createJskitMariaDbRuntimeContainer({
    required: async (context = {}) => {
      const checkTargetRoot = context.targetRoot || targetRoot;
      return await targetWantsJskitMariaDb(checkTargetRoot, toolkit) &&
        await readDatabaseHostFromDotEnv(checkTargetRoot) === JSKIT_MARIADB_HOST;
    },
    targetRoot
  });
  const runtimeContainers = createRuntimeContainerDoctorEntries(toolkit, [
    mariaDbContainer
  ], {
    adapterId: "jskit",
    targetRoot
  });

  return toolkit.plugin({
    id: "jskit-target-runtime",
    label: "JSKIT target runtime",

    checks() {
      let jskitToolchainReady = false;
      const projectSetupChecks = createJskitProjectSetupChecks(toolkit);
      const [mariaDbContainerCheck] = runtimeContainers.checks;
      const nodeCheck = toolkit.toolchainCommandCheck({
        id: "node",
        label: "Node",
        commandArgs: ["node", "--version"],
        expected: "Node 22 runs inside the JSKIT adapter toolchain.",
        explanation: "JSKIT Project Setup runs package scripts through Node.",
        image: JSKIT_TOOLCHAIN_IMAGE,
        repair: buildJskitToolchainRepair(),
        validate: (output) => /^v22\./u.test(output.trim())
      });
      const npmCheck = toolkit.toolchainCommandCheck({
        id: "npm",
        label: "npm",
        commandArgs: ["npm", "--version"],
        expected: "npm runs inside the JSKIT adapter toolchain.",
        explanation: "JSKIT Project Setup uses npm for installs and package scripts.",
        image: JSKIT_TOOLCHAIN_IMAGE,
        repair: buildJskitToolchainRepair()
      });
      const mariaDbClientCheck = toolkit.toolchainCommandCheck({
        id: "mariadb-client",
        label: "MariaDB client",
        commandArgs: ["bash", "-lc", "command -v mariadb && mariadb --version"],
        expected: "MariaDB CLI runs inside the JSKIT adapter toolchain.",
        explanation: "JSKIT Project Setup uses the MariaDB CLI to validate whichever database endpoint .env selects.",
        image: JSKIT_TOOLCHAIN_IMAGE,
        repair: buildJskitToolchainRepair(),
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
        {
          expected: "Managed JSKIT MariaDB is ready when the target declares a MySQL-compatible runtime.",
          id: "jskit-mariadb",
          label: "JSKIT MariaDB",
          run: mariaDbContainerCheck.run
        },
        projectSetupChecks.runtimeServices,
        projectSetupChecks.verificationCommand
      ];
    },
    terminalActions(context = {}) {
      return [
        ...runtimeContainers.terminalActions,
        buildToolchainTerminal,
        ...createJskitProjectSetupTerminalActions({
          targetRoot: context.targetRoot || targetRoot,
          toolkit
        })
      ];
    }
  });
}

export {
  buildJskitToolchainRepair,
  createJskitSetupDoctorPlugin,
  JSKIT_TOOLCHAIN_IMAGE
};
