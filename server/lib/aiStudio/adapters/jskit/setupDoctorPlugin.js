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
  JSKIT_MARIADB_CONTAINER,
  JSKIT_MARIADB_HOST,
  JSKIT_MARIADB_ROOT_PASSWORD,
  mariaDbCapabilitySql,
  readDatabaseHostFromDotEnv,
  startJskitMariaDbRepair,
  startJskitMariaDbScript,
  targetWantsJskitMariaDb
} from "./setupMariaDbRuntime.js";
import {
  createJskitProjectSetupTerminalActions,
  createJskitProjectSetupChecks
} from "./setupProjectChecks.js";
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

async function checkJskitMariaDbCapability(targetRoot = "", toolkit) {
  if (!await targetWantsJskitMariaDb(targetRoot, toolkit)) {
    return passCheck({
      id: "jskit-mariadb",
      label: "JSKIT MariaDB",
      expected: "Managed MariaDB is required only when the JSKIT target declares a MySQL-compatible runtime.",
      observed: "No JSKIT MySQL-compatible runtime package detected.",
      explanation: "This target does not currently need the JSKIT managed MariaDB runtime."
    });
  }

  const databaseHost = await readDatabaseHostFromDotEnv(targetRoot);
  if (databaseHost !== JSKIT_MARIADB_HOST) {
    return passCheck({
      id: "jskit-mariadb",
      label: "JSKIT MariaDB",
      expected: `Managed MariaDB is required only when .env declares DB_HOST=${JSKIT_MARIADB_HOST}.`,
      observed: databaseHost
        ? `.env declares DB_HOST=${databaseHost}.`
        : ".env does not declare DB_HOST yet.",
      explanation: "The Runtime services check validates whichever database endpoint .env selects."
    });
  }

  const ping = await toolkit.runDocker([
    "exec",
    JSKIT_MARIADB_CONTAINER,
    "mariadb-admin",
    "ping",
    "-uroot",
    `-p${JSKIT_MARIADB_ROOT_PASSWORD}`,
    "--silent"
  ], {
    timeout: 12_000
  });

  if (!ping.ok) {
    return failCheck({
      id: "jskit-mariadb",
      label: "JSKIT MariaDB",
      expected: "Managed JSKIT MariaDB is reachable.",
      observed: ping.output,
      explanation: "Start the JSKIT managed MariaDB container before database setup checks run.",
      repair: startJskitMariaDbRepair()
    });
  }

  const probe = await toolkit.runDocker([
    "exec",
    JSKIT_MARIADB_CONTAINER,
    "mariadb",
    "-uroot",
    `-p${JSKIT_MARIADB_ROOT_PASSWORD}`,
    "-e",
    mariaDbCapabilitySql()
  ], {
    timeout: 15_000
  });

  if (!probe.ok) {
    return failCheck({
      id: "jskit-mariadb",
      label: "JSKIT MariaDB",
      expected: "Managed JSKIT MariaDB can create/drop a temporary probe database.",
      observed: probe.output,
      explanation: "The JSKIT MariaDB container is reachable, but Studio could not prove DDL rights.",
      repair: startJskitMariaDbRepair()
    });
  }

  return passCheck({
    id: "jskit-mariadb",
    label: "JSKIT MariaDB",
    expected: "Managed JSKIT MariaDB can create/drop a temporary probe database.",
    observed: "Probe database and table created and dropped successfully.",
    explanation: "The JSKIT managed MariaDB runtime is ready for target database setup."
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
  const startMariaDbTerminal = toolkit.shellTerminalAction({
    actionId: "start-jskit-mariadb",
    commandPreview: () => startJskitMariaDbRepair().commandPreview,
    cwd: ({ targetRoot = "" } = {}) => studioRoot || targetRoot,
    env: configEnvironment,
    label: "Start JSKIT MariaDB",
    script: startJskitMariaDbScript
  });

  return toolkit.plugin({
    id: "jskit-target-runtime",
    label: "JSKIT target runtime",

    checks() {
      let jskitToolchainReady = false;
      const projectSetupChecks = createJskitProjectSetupChecks(toolkit);
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
        commandArgs: ["mariadb", "--version"],
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
          run({ targetRoot = "" } = {}) {
            return checkJskitMariaDbCapability(targetRoot, toolkit);
          }
        },
        projectSetupChecks.runtimeServices,
        projectSetupChecks.verificationCommand
      ];
    },
    terminalActions(context = {}) {
      return [
        startMariaDbTerminal,
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
