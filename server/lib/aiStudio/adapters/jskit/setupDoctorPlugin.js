import {
  createDoctorRepair,
  failDoctorCheck as failCheck,
  passDoctorCheck as passCheck
} from "../../../doctorCheckItems.js";
import {
  createDoctorPluginToolkit
} from "../../../doctorPluginToolkit.js";
import {
  STUDIO_BASE_TOOLCHAIN_IMAGE
} from "../../../studioRuntimeIdentity.js";
import {
  dockerCommand
} from "../../../shellCommands.js";
import {
  JSKIT_MYSQL_CONTAINER,
  JSKIT_MYSQL_ROOT_PASSWORD,
  mysqlCapabilitySql,
  startJskitMysqlRepair,
  startJskitMysqlScript,
  targetWantsJskitMysql
} from "./setupMysqlRuntime.js";
import {
  createJskitTargetSetupTerminalActions,
  createJskitTargetSetupChecks
} from "./setupTargetChecks.js";
import {
  JSKIT_TOOLCHAIN_IMAGE
} from "./toolchainIdentity.js";

const JSKIT_TOOLCHAIN_DOCKERFILE = "tooling/adapters/jskit/Dockerfile";
const JSKIT_TOOLCHAIN_CONTEXT = "tooling/adapters/jskit";

function buildJskitToolchainArgs() {
  return [
    "build",
    "-t",
    JSKIT_TOOLCHAIN_IMAGE,
    "--build-arg",
    `AI_STUDIO_BASE_IMAGE=${STUDIO_BASE_TOOLCHAIN_IMAGE}`,
    "-f",
    JSKIT_TOOLCHAIN_DOCKERFILE,
    JSKIT_TOOLCHAIN_CONTEXT
  ];
}

function buildJskitToolchainScript() {
  const args = buildJskitToolchainArgs();
  return [
    "set -e",
    `echo '$ ${dockerCommand(args)}'`,
    dockerCommand(args)
  ].join("\n");
}

function buildJskitToolchainRepair() {
  return createDoctorRepair({
    actionId: "build-jskit-toolchain",
    command: dockerCommand(buildJskitToolchainArgs()),
    kind: "terminal",
    label: "Build JSKIT toolchain"
  });
}

async function checkJskitToolchainImage(toolkit) {
  const result = await toolkit.runDocker([
    "image",
    "inspect",
    JSKIT_TOOLCHAIN_IMAGE,
    "--format",
    "{{.Id}}"
  ], {
    timeout: 12_000
  });

  if (!result.ok) {
    return failCheck({
      id: "jskit-toolchain-image",
      label: "JSKIT toolchain image",
      expected: `${JSKIT_TOOLCHAIN_IMAGE} exists locally.`,
      observed: result.output,
      explanation: "Build the JSKIT adapter toolchain before running JSKIT setup commands.",
      repair: buildJskitToolchainRepair()
    });
  }

  return passCheck({
    id: "jskit-toolchain-image",
    label: "JSKIT toolchain image",
    expected: `${JSKIT_TOOLCHAIN_IMAGE} exists locally.`,
    observed: result.output,
    explanation: "The JSKIT adapter toolchain image is present."
  });
}

function missingJskitToolchainCheck({
  expected = "",
  id = "",
  label = ""
} = {}) {
  return failCheck({
    id,
    label,
    expected,
    observed: "JSKIT toolchain image is missing.",
    explanation: "Build the JSKIT adapter toolchain image first.",
    repair: buildJskitToolchainRepair()
  });
}

async function checkJskitMysqlCapability(targetRoot = "", toolkit) {
  if (!await targetWantsJskitMysql(targetRoot, toolkit)) {
    return passCheck({
      id: "jskit-mysql",
      label: "JSKIT MySQL",
      expected: "Managed MySQL is required only when the JSKIT target declares a MySQL runtime.",
      observed: "No JSKIT MySQL runtime package detected.",
      explanation: "This target does not currently need the JSKIT managed MySQL runtime."
    });
  }

  const ping = await toolkit.runDocker([
    "exec",
    JSKIT_MYSQL_CONTAINER,
    "mysqladmin",
    "ping",
    "-uroot",
    `-p${JSKIT_MYSQL_ROOT_PASSWORD}`,
    "--silent"
  ], {
    timeout: 12_000
  });

  if (!ping.ok) {
    return failCheck({
      id: "jskit-mysql",
      label: "JSKIT MySQL",
      expected: "Managed JSKIT MySQL is reachable.",
      observed: ping.output,
      explanation: "Start the JSKIT managed MySQL container before database setup checks run.",
      repair: startJskitMysqlRepair()
    });
  }

  const probe = await toolkit.runDocker([
    "exec",
    JSKIT_MYSQL_CONTAINER,
    "mysql",
    "-uroot",
    `-p${JSKIT_MYSQL_ROOT_PASSWORD}`,
    "-e",
    mysqlCapabilitySql()
  ], {
    timeout: 15_000
  });

  if (!probe.ok) {
    return failCheck({
      id: "jskit-mysql",
      label: "JSKIT MySQL",
      expected: "Managed JSKIT MySQL can create/drop a temporary probe database.",
      observed: probe.output,
      explanation: "The JSKIT MySQL container is reachable, but Studio could not prove DDL rights.",
      repair: startJskitMysqlRepair()
    });
  }

  return passCheck({
    id: "jskit-mysql",
    label: "JSKIT MySQL",
    expected: "Managed JSKIT MySQL can create/drop a temporary probe database.",
    observed: "Probe database and table created and dropped successfully.",
    explanation: "The JSKIT managed MySQL runtime is ready for target database setup."
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
    commandPreview: () => buildJskitToolchainRepair().commandPreview,
    cwd: ({ targetRoot = "" } = {}) => studioRoot || targetRoot,
    env: configEnvironment,
    label: "Build JSKIT toolchain",
    script: buildJskitToolchainScript
  });
  const startMysqlTerminal = toolkit.shellTerminalAction({
    actionId: "start-jskit-mysql",
    commandPreview: () => startJskitMysqlRepair().commandPreview,
    cwd: ({ targetRoot = "" } = {}) => studioRoot || targetRoot,
    env: configEnvironment,
    label: "Start JSKIT MySQL",
    script: startJskitMysqlScript
  });

  return toolkit.plugin({
    id: "jskit-target-runtime",
    label: "JSKIT target runtime",

    checks() {
      let jskitToolchainReady = false;
      const targetSetupChecks = createJskitTargetSetupChecks(toolkit);
      const nodeCheck = toolkit.toolchainCommandCheck({
        id: "node",
        label: "Node",
        commandArgs: ["node", "--version"],
        expected: "Node 22 runs inside the JSKIT adapter toolchain.",
        explanation: "JSKIT target setup runs package scripts through Node.",
        image: JSKIT_TOOLCHAIN_IMAGE,
        repair: buildJskitToolchainRepair(),
        validate: (output) => /^v22\./u.test(output.trim())
      });
      const npmCheck = toolkit.toolchainCommandCheck({
        id: "npm",
        label: "npm",
        commandArgs: ["npm", "--version"],
        expected: "npm runs inside the JSKIT adapter toolchain.",
        explanation: "JSKIT target setup uses npm for installs and package scripts.",
        image: JSKIT_TOOLCHAIN_IMAGE,
        repair: buildJskitToolchainRepair()
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
        targetSetupChecks.scaffold,
        targetSetupChecks.dependencies,
        {
          expected: "Managed JSKIT MySQL is ready when the target declares a MySQL runtime.",
          id: "jskit-mysql",
          label: "JSKIT MySQL",
          run({ targetRoot = "" } = {}) {
            return checkJskitMysqlCapability(targetRoot, toolkit);
          }
        },
        targetSetupChecks.runtimeServices,
        targetSetupChecks.verificationCommand
      ];
    },
    terminalActions(context = {}) {
      return [
        startMysqlTerminal,
        buildToolchainTerminal,
        ...createJskitTargetSetupTerminalActions({
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
