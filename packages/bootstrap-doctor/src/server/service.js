import {
  dockerCommand,
  runDocker
} from "./containerEngine.js";
import {
  closeTerminalSession,
  readTerminalSession,
  startTerminalSession,
  writeTerminalSession
} from "./terminalSessions.js";

const TOOLCHAIN_IMAGE = "jskit-ai-studio-toolchain:0.1.0";
const TOOLCHAIN_DOCKERFILE = "tooling/bootstrap/Dockerfile";
const TOOLCHAIN_CONTEXT = "tooling/bootstrap";
const TOOL_HOME_VOLUME = "jskit_ai_studio_tool_home";
const MYSQL_CONTAINER = "jskit-ai-studio-mysql";
const MYSQL_IMAGE = "mysql:8.4";
const MYSQL_ROOT_PASSWORD = "jskit_studio_root";
const MYSQL_VOLUME = "jskit_ai_studio_mysql_data";
const MYSQL_PROBE_DATABASE = "jskit_ai_studio_bootstrap_probe";
const MYSQL_PROBE_TABLE = "capability_probe";
const REQUIRED_GH_SCOPES = ["repo", "read:org", "gist", "workflow"];

function buildToolchainArgs(commandArgs, extraArgs = []) {
  return [
    "run",
    "--rm",
    "-v",
    `${TOOL_HOME_VOLUME}:/home/studio`,
    "-e",
    "HOME=/home/studio",
    "-w",
    "/workspace",
    ...extraArgs,
    TOOLCHAIN_IMAGE,
    ...commandArgs
  ];
}

function buildTerminalArgs(commandArgs, extraArgs = []) {
  return buildToolchainArgs(commandArgs, ["-it", ...extraArgs]);
}

function commandPreview(args) {
  return dockerCommand(args);
}

function mysqlCommandPreview(args) {
  return commandPreview(args.map((arg) => String(arg).replaceAll(MYSQL_ROOT_PASSWORD, "*****")));
}

function buildToolchainScript() {
  const args = [
    "build",
    "-t",
    TOOLCHAIN_IMAGE,
    "-f",
    TOOLCHAIN_DOCKERFILE,
    TOOLCHAIN_CONTEXT
  ];

  return [
    "set -e",
    `echo '$ ${commandPreview(args)}'`,
    commandPreview(args)
  ].join("\n");
}

function mysqlCapabilitySql() {
  return [
    `CREATE DATABASE IF NOT EXISTS \`${MYSQL_PROBE_DATABASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS \`${MYSQL_PROBE_DATABASE}\`.\`${MYSQL_PROBE_TABLE}\` (id INT NOT NULL PRIMARY KEY)`,
    `DROP TABLE \`${MYSQL_PROBE_DATABASE}\`.\`${MYSQL_PROBE_TABLE}\``,
    `DROP DATABASE \`${MYSQL_PROBE_DATABASE}\``
  ].join("; ");
}

function maskedMysqlExecPreview(sql) {
  return `docker exec ${MYSQL_CONTAINER} mysql -uroot -p***** -e ${JSON.stringify(sql)}`;
}

function buildMysqlRepairScript() {
  const runArgs = [
    "run",
    "-d",
    "--name",
    MYSQL_CONTAINER,
    "-e",
    "MYSQL_ROOT_PASSWORD=*****",
    "-v",
    `${MYSQL_VOLUME}:/var/lib/mysql`,
    "--health-cmd",
    "mysqladmin ping -uroot -p***** --silent",
    "--health-interval",
    "5s",
    "--health-timeout",
    "3s",
    "--health-retries",
    "20",
    MYSQL_IMAGE
  ];
  const probeSql = mysqlCapabilitySql();

  return [
    "set -e",
    `MYSQL_ROOT_PASSWORD='${MYSQL_ROOT_PASSWORD}'`,
    `MYSQL_CONTAINER='${MYSQL_CONTAINER}'`,
    `MYSQL_VOLUME='${MYSQL_VOLUME}'`,
    `MYSQL_IMAGE='${MYSQL_IMAGE}'`,
    `echo '$ ${commandPreview(["volume", "create", MYSQL_VOLUME])}'`,
    `docker volume create '${MYSQL_VOLUME}'`,
    `if ! docker inspect '${MYSQL_CONTAINER}' >/dev/null 2>&1; then`,
    `  echo '$ ${commandPreview(runArgs)}'`,
    `  docker run -d --name '${MYSQL_CONTAINER}' -e MYSQL_ROOT_PASSWORD="$MYSQL_ROOT_PASSWORD" -v '${MYSQL_VOLUME}:/var/lib/mysql' --health-cmd "mysqladmin ping -uroot -p$MYSQL_ROOT_PASSWORD --silent" --health-interval 5s --health-timeout 3s --health-retries 20 '${MYSQL_IMAGE}'`,
    "else",
    `  RUNNING=$(docker inspect '${MYSQL_CONTAINER}' --format '{{.State.Running}}')`,
    "  if [ \"$RUNNING\" != \"true\" ]; then",
    `    echo '$ ${commandPreview(["start", MYSQL_CONTAINER])}'`,
    `    docker start '${MYSQL_CONTAINER}'`,
    "  else",
    `    echo '${MYSQL_CONTAINER} is already running.'`,
    "  fi",
    "fi",
    "for attempt in $(seq 1 40); do",
    `  echo '$ docker exec ${MYSQL_CONTAINER} mysqladmin ping -uroot -p***** --silent'`,
    `  if docker exec '${MYSQL_CONTAINER}' mysqladmin ping -uroot -p"$MYSQL_ROOT_PASSWORD" --silent; then`,
    "    break",
    "  fi",
    "  if [ \"$attempt\" = \"40\" ]; then",
    "    echo 'Timed out waiting for MySQL to accept connections.'",
    "    exit 1",
    "  fi",
    "  sleep 1.5",
    "done",
    `echo '$ ${maskedMysqlExecPreview(probeSql)}'`,
    `docker exec '${MYSQL_CONTAINER}' mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -e '${probeSql}'`
  ].join("\n");
}

function createRepair({
  actionId,
  command,
  input,
  kind = "command",
  label
}) {
  return {
    actionId,
    commandPreview: command,
    input,
    kind,
    label
  };
}

function checkItem({
  id,
  label,
  status,
  expected,
  observed,
  explanation,
  repair = null,
  repairs = null
}) {
  const repairList = Array.isArray(repairs)
    ? repairs.filter(Boolean)
    : [repair].filter(Boolean);

  return {
    id,
    label,
    status,
    required: true,
    expected,
    observed: String(observed || "").trim() || "not available",
    explanation,
    repair: repair || repairList[0] || null,
    repairs: repairList
  };
}

function passCheck(details) {
  return checkItem({
    ...details,
    status: "pass"
  });
}

function failCheck(details) {
  return checkItem({
    ...details,
    status: "fail"
  });
}

function manualDockerRepair() {
  return createRepair({
    actionId: "manual-docker",
    command: "docker version",
    kind: "manual",
    label: "Install and start Docker"
  });
}

function buildToolchainRepair() {
  return createRepair({
    actionId: "build-toolchain",
    command: commandPreview([
      "build",
      "-t",
      TOOLCHAIN_IMAGE,
      "-f",
      TOOLCHAIN_DOCKERFILE,
      TOOLCHAIN_CONTEXT
    ]),
    label: "Build managed toolchain"
  });
}

function mysqlRepair() {
  const probeSql = mysqlCapabilitySql();
  const runArgs = [
    "run",
    "-d",
    "--name",
    MYSQL_CONTAINER,
    "-e",
    `MYSQL_ROOT_PASSWORD=${MYSQL_ROOT_PASSWORD}`,
    "-v",
    `${MYSQL_VOLUME}:/var/lib/mysql`,
    "--health-cmd",
    `mysqladmin ping -uroot -p${MYSQL_ROOT_PASSWORD} --silent`,
    "--health-interval",
    "5s",
    "--health-timeout",
    "3s",
    "--health-retries",
    "20",
    MYSQL_IMAGE
  ];

  return createRepair({
    actionId: "repair-mysql",
    command: [
      commandPreview(["volume", "create", MYSQL_VOLUME]),
      mysqlCommandPreview(runArgs),
      maskedMysqlExecPreview(probeSql)
    ].join("\n"),
    label: "Start MySQL and verify DDL"
  });
}

function ghLoginCommandArgs() {
  return [
    "gh",
    "auth",
    "login",
    "--hostname",
    "github.com",
    "--git-protocol",
    "https",
    "--web",
    "--scopes",
    REQUIRED_GH_SCOPES.join(",")
  ];
}

function ghLoginRepair() {
  const args = buildTerminalArgs(ghLoginCommandArgs());
  return createRepair({
    actionId: "terminal-gh-login",
    command: commandPreview(args),
    kind: "terminal",
    label: "Log in to GitHub"
  });
}

function ghReauthRepair() {
  const script = [
    "gh auth logout --hostname github.com",
    `exec ${commandPreview(ghLoginCommandArgs())}`
  ].join("\n");
  const args = buildTerminalArgs(["bash", "-lc", script]);

  return createRepair({
    actionId: "terminal-gh-reauth",
    command: commandPreview(args),
    kind: "terminal",
    label: "Re-authenticate GitHub"
  });
}

function codexBrowserLoginCommandArgs() {
  return [
    "codex",
    "login"
  ];
}

function codexDeviceLoginCommandArgs() {
  return [
    "codex",
    "login",
    "--device-auth"
  ];
}

function codexLoginRepair() {
  const args = buildTerminalArgs(codexBrowserLoginCommandArgs(), ["--network", "host"]);

  return createRepair({
    actionId: "terminal-codex-login",
    command: commandPreview(args),
    kind: "terminal",
    label: "Log in to Codex with browser"
  });
}

function codexDeviceLoginRepair() {
  const args = buildTerminalArgs(codexDeviceLoginCommandArgs());

  return createRepair({
    actionId: "terminal-codex-device-login",
    command: commandPreview(args),
    kind: "terminal",
    label: "Log in to Codex with device code"
  });
}

function codexReauthRepair() {
  const script = [
    "codex logout || true",
    `exec ${commandPreview(codexBrowserLoginCommandArgs())}`
  ].join("\n");
  const args = buildTerminalArgs(["bash", "-lc", script], ["--network", "host"]);

  return createRepair({
    actionId: "terminal-codex-reauth",
    command: commandPreview(args),
    kind: "terminal",
    label: "Re-authenticate Codex with browser"
  });
}

function codexDeviceReauthRepair() {
  const script = [
    "codex logout || true",
    `exec ${commandPreview(codexDeviceLoginCommandArgs())}`
  ].join("\n");
  const args = buildTerminalArgs(["bash", "-lc", script]);

  return createRepair({
    actionId: "terminal-codex-device-reauth",
    command: commandPreview(args),
    kind: "terminal",
    label: "Re-authenticate Codex with device code"
  });
}

function codexLoginRepairs(hostNetworkReady) {
  return [
    hostNetworkReady ? codexLoginRepair() : null,
    codexDeviceLoginRepair()
  ].filter(Boolean);
}

function codexReauthRepairs(hostNetworkReady) {
  return [
    hostNetworkReady ? codexReauthRepair() : null,
    codexDeviceReauthRepair()
  ].filter(Boolean);
}

function isBootstrapReady(checks) {
  return checks.every((check) => check.required !== true || check.status === "pass");
}

async function checkDocker() {
  const result = await runDocker(["version", "--format", "{{.Server.Version}}"], {
    timeout: 12000
  });

  if (!result.ok) {
    return failCheck({
      id: "docker",
      label: "Docker engine",
      expected: "Docker CLI can reach a running engine.",
      observed: result.output,
      explanation: "Bootstrap repair needs Docker because Studio provisions its managed runtime in containers.",
      repair: manualDockerRepair()
    });
  }

  return passCheck({
    id: "docker",
    label: "Docker engine",
    expected: "Docker CLI can reach a running engine.",
    observed: result.output,
    explanation: "Docker is reachable."
  });
}

async function checkDockerCompose(dockerReady) {
  if (!dockerReady) {
    return failCheck({
      id: "docker-compose",
      label: "Docker Compose plugin",
      expected: "docker compose is available.",
      observed: "Docker is not ready.",
      explanation: "Docker Compose is part of the required container toolchain.",
      repair: manualDockerRepair()
    });
  }

  const result = await runDocker(["compose", "version", "--short"], {
    timeout: 12000
  });

  if (!result.ok) {
    return failCheck({
      id: "docker-compose",
      label: "Docker Compose plugin",
      expected: "docker compose is available.",
      observed: result.output,
      explanation: "The Docker Compose plugin is required for later local services.",
      repair: createRepair({
        actionId: "manual-docker-compose",
        command: "docker compose version",
        kind: "manual",
        label: "Install Docker Compose plugin"
      })
    });
  }

  return passCheck({
    id: "docker-compose",
    label: "Docker Compose plugin",
    expected: "docker compose is available.",
    observed: result.output,
    explanation: "Docker Compose is available."
  });
}

async function checkToolchainImage(dockerReady) {
  if (!dockerReady) {
    return failCheck({
      id: "toolchain-image",
      label: "Managed toolchain image",
      expected: `${TOOLCHAIN_IMAGE} exists locally.`,
      observed: "Docker is not ready.",
      explanation: "Studio cannot inspect the managed toolchain until Docker is ready.",
      repair: manualDockerRepair()
    });
  }

  const result = await runDocker(["image", "inspect", TOOLCHAIN_IMAGE, "--format", "{{.Id}}"], {
    timeout: 12000
  });

  if (!result.ok) {
    return failCheck({
      id: "toolchain-image",
      label: "Managed toolchain image",
      expected: `${TOOLCHAIN_IMAGE} exists locally.`,
      observed: result.output,
      explanation: "Build the managed toolchain before checking Node, npm, git, GH, and Codex.",
      repair: buildToolchainRepair()
    });
  }

  return passCheck({
    id: "toolchain-image",
    label: "Managed toolchain image",
    expected: `${TOOLCHAIN_IMAGE} exists locally.`,
    observed: result.output,
    explanation: "The managed toolchain image is present."
  });
}

function missingToolchainCheck(id, label) {
  return failCheck({
    id,
    label,
    expected: "Runs inside the managed toolchain image.",
    observed: "Managed toolchain image is missing.",
    explanation: "Build the managed toolchain image first.",
    repair: buildToolchainRepair()
  });
}

async function checkToolchainCommand({
  id,
  label,
  commandArgs,
  expected,
  explanation,
  isValid,
  repair
}) {
  const result = await runDocker(buildToolchainArgs(commandArgs), {
    timeout: 20000
  });

  if (!result.ok || !isValid(result.output)) {
    return failCheck({
      id,
      label,
      expected,
      observed: result.output,
      explanation,
      repair
    });
  }

  return passCheck({
    id,
    label,
    expected,
    observed: result.output,
    explanation
  });
}

async function checkHostNetwork(toolchainReady) {
  if (!toolchainReady) {
    return {
      ok: false,
      output: "Managed toolchain image is missing."
    };
  }

  const result = await runDocker(buildToolchainArgs([
    "node",
    "-e",
    "process.exit(0)"
  ], ["--network", "host"]), {
    timeout: 20000
  });

  return {
    ok: result.ok,
    output: result.output || (result.ok ? "Docker host networking is available." : "Docker host networking is unavailable.")
  };
}

async function checkGitHubAuth(toolchainReady) {
  if (!toolchainReady) {
    return missingToolchainCheck("gh-auth", "GitHub login");
  }

  const result = await runDocker(buildToolchainArgs([
    "gh",
    "auth",
    "status",
    "--hostname",
    "github.com"
  ]), {
    timeout: 20000
  });
  const output = result.output;
  const missingScopes = REQUIRED_GH_SCOPES.filter((scope) => !output.includes(scope));

  if (!result.ok || missingScopes.length > 0) {
    return failCheck({
      id: "gh-auth",
      label: "GitHub login",
      expected: `Logged in to github.com with scopes ${REQUIRED_GH_SCOPES.join(", ")}.`,
      observed: output,
      explanation: "Studio needs GH authenticated inside the managed toolchain to inspect remotes and run deploy flows later.",
      repair: ghLoginRepair()
    });
  }

  return passCheck({
    id: "gh-auth",
    label: "GitHub login",
    expected: `Logged in to github.com with scopes ${REQUIRED_GH_SCOPES.join(", ")}.`,
    observed: output,
    explanation: "GH is authenticated inside the managed toolchain.",
    repair: ghReauthRepair()
  });
}

async function checkCodexAuth(toolchainReady, hostNetwork) {
  if (!toolchainReady) {
    return missingToolchainCheck("codex-auth", "Codex login");
  }

  const result = await runDocker(buildToolchainArgs(["codex", "login", "status"]), {
    timeout: 20000
  });

  if (!result.ok) {
    const repairs = codexLoginRepairs(hostNetwork.ok);

    return failCheck({
      id: "codex-auth",
      label: "Codex login",
      expected: "Codex login status succeeds inside the managed toolchain.",
      observed: [
        result.output,
        `Docker host networking: ${hostNetwork.ok ? "available" : hostNetwork.output}`
      ].filter(Boolean).join("\n"),
      explanation: "Codex must be logged in before Studio can orchestrate local implementation sessions. Browser login uses Docker host networking when available; device-code login remains the fallback.",
      repair: repairs[0],
      repairs
    });
  }

  const repairs = codexReauthRepairs(hostNetwork.ok);

  return passCheck({
    id: "codex-auth",
    label: "Codex login",
    expected: "Codex login status succeeds inside the managed toolchain.",
    observed: [
      result.output,
      `Docker host networking: ${hostNetwork.ok ? "available" : hostNetwork.output}`
    ].filter(Boolean).join("\n"),
    explanation: "Codex is authenticated inside the managed toolchain.",
    repair: repairs[0],
    repairs
  });
}

async function waitForMysqlReady() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = await runDocker([
      "exec",
      MYSQL_CONTAINER,
      "mysqladmin",
      "ping",
      "-uroot",
      `-p${MYSQL_ROOT_PASSWORD}`,
      "--silent"
    ], {
      timeout: 5000
    });

    if (result.ok) {
      return result;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 1500);
    });
  }

  return {
    ok: false,
    output: "Timed out waiting for MySQL to accept connections."
  };
}

async function runMysqlProbe() {
  return runDocker([
    "exec",
    MYSQL_CONTAINER,
    "mysql",
    "-uroot",
    `-p${MYSQL_ROOT_PASSWORD}`,
    "-e",
    mysqlCapabilitySql()
  ], {
    timeout: 15000
  });
}

async function checkMysqlCapability(dockerReady) {
  if (!dockerReady) {
    return failCheck({
      id: "mysql-capability",
      label: "MySQL capability",
      expected: "Managed MySQL starts and can create/drop a temporary probe table.",
      observed: "Docker is not ready.",
      explanation: "Studio needs a working managed MySQL runtime before it can later prepare an app-specific database.",
      repair: manualDockerRepair()
    });
  }

  const inspectResult = await runDocker([
    "inspect",
    MYSQL_CONTAINER,
    "--format",
    "{{.State.Running}} {{if .State.Health}}{{.State.Health.Status}}{{else}}no-health{{end}}"
  ], {
    timeout: 12000
  });

  if (!inspectResult.ok) {
    return failCheck({
      id: "mysql-capability",
      label: "MySQL capability",
      expected: "Managed MySQL starts and can create/drop a temporary probe table.",
      observed: inspectResult.output,
      explanation: "Start the managed MySQL container, then Studio will smoke-test DDL rights with a temporary probe database.",
      repair: mysqlRepair()
    });
  }

  const observed = inspectResult.output.trim();
  const ready = observed.startsWith("true") && !observed.includes("unhealthy") && !observed.includes("starting");
  if (!ready) {
    return failCheck({
      id: "mysql-capability",
      label: "MySQL capability",
      expected: "Managed MySQL is running and healthy.",
      observed,
      explanation: "The managed MySQL container exists but is not ready for SQL checks yet.",
      repair: mysqlRepair()
    });
  }

  const probeResult = await runMysqlProbe();
  if (!probeResult.ok) {
    return failCheck({
      id: "mysql-capability",
      label: "MySQL capability",
      expected: "Managed MySQL can create/drop a temporary probe database and table.",
      observed: probeResult.output,
      explanation: "The MySQL runtime is reachable, but Studio could not prove DDL rights for future app setup.",
      repair: mysqlRepair()
    });
  }

  return passCheck({
    id: "mysql-capability",
    label: "MySQL capability",
    expected: "Managed MySQL can create/drop a temporary probe database and table.",
    observed: "Probe database and table created and dropped successfully.",
    explanation: "The managed MySQL runtime is ready for later app-specific database setup."
  });
}

async function repairMysql() {
  const logs = [];
  const appendResult = (label, result) => {
    logs.push(`$ ${label}`);
    if (result.output) {
      logs.push(result.output);
    }
  };

  const volumeResult = await runDocker(["volume", "create", MYSQL_VOLUME], {
    timeout: 15000
  });
  appendResult(commandPreview(["volume", "create", MYSQL_VOLUME]), volumeResult);
  if (!volumeResult.ok) {
    return {
      ok: false,
      actionId: "repair-mysql",
      output: logs.join("\n"),
      status: "failed"
    };
  }

  const inspectResult = await runDocker(["inspect", MYSQL_CONTAINER, "--format", "{{.Id}}"], {
    timeout: 12000
  });

  if (!inspectResult.ok) {
    const runArgs = [
      "run",
      "-d",
      "--name",
      MYSQL_CONTAINER,
      "-e",
      `MYSQL_ROOT_PASSWORD=${MYSQL_ROOT_PASSWORD}`,
      "-v",
      `${MYSQL_VOLUME}:/var/lib/mysql`,
      "--health-cmd",
      `mysqladmin ping -uroot -p${MYSQL_ROOT_PASSWORD} --silent`,
      "--health-interval",
      "5s",
      "--health-timeout",
      "3s",
      "--health-retries",
      "20",
      MYSQL_IMAGE
    ];
    const runResult = await runDocker(runArgs, {
      timeout: 60000
    });
    appendResult(mysqlCommandPreview(runArgs), runResult);
    if (!runResult.ok) {
      return {
        ok: false,
        actionId: "repair-mysql",
        output: logs.join("\n"),
        status: "failed"
      };
    }
  } else {
    const runningResult = await runDocker([
      "inspect",
      MYSQL_CONTAINER,
      "--format",
      "{{.State.Running}}"
    ], {
      timeout: 12000
    });
    if (runningResult.output !== "true") {
      const startResult = await runDocker(["start", MYSQL_CONTAINER], {
        timeout: 30000
      });
      appendResult(commandPreview(["start", MYSQL_CONTAINER]), startResult);
      if (!startResult.ok) {
        return {
          ok: false,
          actionId: "repair-mysql",
          output: logs.join("\n"),
          status: "failed"
        };
      }
    }
  }

  const readyResult = await waitForMysqlReady();
  appendResult(`wait for ${MYSQL_CONTAINER}`, readyResult);
  if (!readyResult.ok) {
    return {
      ok: false,
      actionId: "repair-mysql",
      output: logs.join("\n"),
      status: "failed"
    };
  }

  const probeResult = await runMysqlProbe();
  appendResult(maskedMysqlExecPreview(mysqlCapabilitySql()), probeResult);

  return {
    ok: probeResult.ok,
    actionId: "repair-mysql",
    output: logs.join("\n"),
    status: probeResult.ok ? "completed" : "failed"
  };
}

function createService() {
  return Object.freeze({
    async getStatus() {
      const docker = await checkDocker();
      const dockerReady = docker.status === "pass";
      const compose = await checkDockerCompose(dockerReady);
      const mysql = await checkMysqlCapability(dockerReady);
      const toolchainImage = await checkToolchainImage(dockerReady);
      const toolchainReady = toolchainImage.status === "pass";
      const hostNetwork = await checkHostNetwork(toolchainReady);

      const node = toolchainReady
        ? await checkToolchainCommand({
          id: "node",
          label: "Node",
          commandArgs: ["node", "--version"],
          expected: "Node 22 runs inside the managed toolchain.",
          explanation: "Studio runs JSKIT commands through the managed Node runtime.",
          isValid: (output) => /^v22\./.test(output.trim()),
          repair: buildToolchainRepair()
        })
        : missingToolchainCheck("node", "Node");
      const npm = toolchainReady
        ? await checkToolchainCommand({
          id: "npm",
          label: "npm",
          commandArgs: ["npm", "--version"],
          expected: "npm runs inside the managed toolchain.",
          explanation: "Studio needs npm for installs, scripts, and verification.",
          isValid: (output) => output.trim().length > 0,
          repair: buildToolchainRepair()
        })
        : missingToolchainCheck("npm", "npm");
      const git = toolchainReady
        ? await checkToolchainCommand({
          id: "git",
          label: "git",
          commandArgs: ["git", "--version"],
          expected: "git runs inside the managed toolchain.",
          explanation: "Studio uses git for status, diffs, commits, and deployments.",
          isValid: (output) => output.includes("git version"),
          repair: buildToolchainRepair()
        })
        : missingToolchainCheck("git", "git");
      const gh = toolchainReady
        ? await checkToolchainCommand({
          id: "gh",
          label: "GitHub CLI",
          commandArgs: ["gh", "--version"],
          expected: "gh runs inside the managed toolchain.",
          explanation: "Studio uses GitHub CLI for repository and deploy-adjacent workflows.",
          isValid: (output) => output.toLowerCase().includes("gh version"),
          repair: buildToolchainRepair()
        })
        : missingToolchainCheck("gh", "GitHub CLI");
      const codex = toolchainReady
        ? await checkToolchainCommand({
          id: "codex",
          label: "Codex CLI",
          commandArgs: ["codex", "--version"],
          expected: "Codex runs inside the managed toolchain.",
          explanation: "Studio delegates implementation work to local Codex sessions.",
          isValid: (output) => output.trim().length > 0,
          repair: buildToolchainRepair()
        })
        : missingToolchainCheck("codex", "Codex CLI");
      const ghAuth = await checkGitHubAuth(toolchainReady);
      const codexAuth = await checkCodexAuth(toolchainReady, hostNetwork);
      const checks = [
        docker,
        compose,
        mysql,
        toolchainImage,
        node,
        npm,
        git,
        gh,
        ghAuth,
        codex,
        codexAuth
      ];

      return {
        ok: true,
        blockedReason: isBootstrapReady(checks) ? "" : "Bootstrap is incomplete.",
        ready: isBootstrapReady(checks),
        checks,
        updatedAt: new Date().toISOString()
      };
    },

    async repair(input = {}) {
      const actionId = String(input.actionId || "");

      if (actionId === "build-toolchain") {
        const args = [
          "build",
          "-t",
          TOOLCHAIN_IMAGE,
          "-f",
          TOOLCHAIN_DOCKERFILE,
          TOOLCHAIN_CONTEXT
        ];
        const result = await runDocker(args, {
          timeout: 10 * 60 * 1000
        });
        return {
          ok: result.ok,
          actionId,
          commandPreview: commandPreview(args),
          output: result.output,
          status: result.ok ? "completed" : "failed"
        };
      }

      if (actionId === "repair-mysql") {
        return repairMysql();
      }

      return {
        ok: false,
        actionId,
        error: "Unknown repair action.",
        status: "failed"
      };
    },

    startTerminal(input = {}) {
      const actionId = String(input.actionId || "");
      if (actionId === "build-toolchain") {
        const script = buildToolchainScript();
        const args = ["-lc", script];
        return startTerminalSession({
          args,
          command: "bash",
          commandPreview: buildToolchainRepair().commandPreview
        });
      }

      if (actionId === "repair-mysql") {
        const script = buildMysqlRepairScript();
        const args = ["-lc", script];
        return startTerminalSession({
          args,
          command: "bash",
          commandPreview: mysqlRepair().commandPreview
        });
      }

      if (actionId === "terminal-gh-login") {
        const args = buildTerminalArgs(ghLoginCommandArgs());
        return startTerminalSession({
          args,
          command: "docker",
          commandPreview: commandPreview(args)
        });
      }

      if (actionId === "terminal-gh-reauth") {
        const script = [
          "gh auth logout --hostname github.com",
          `exec ${commandPreview(ghLoginCommandArgs())}`
        ].join("\n");
        const args = buildTerminalArgs(["bash", "-lc", script]);
        return startTerminalSession({
          args,
          command: "docker",
          commandPreview: commandPreview(args)
        });
      }

      if (actionId === "terminal-codex-login") {
        const args = buildTerminalArgs(codexBrowserLoginCommandArgs(), ["--network", "host"]);
        return startTerminalSession({
          args,
          command: "docker",
          commandPreview: commandPreview(args)
        });
      }

      if (actionId === "terminal-codex-device-login") {
        const args = buildTerminalArgs(codexDeviceLoginCommandArgs());
        return startTerminalSession({
          args,
          command: "docker",
          commandPreview: commandPreview(args)
        });
      }

      if (actionId === "terminal-codex-reauth") {
        const script = [
          "codex logout || true",
          `exec ${commandPreview(codexBrowserLoginCommandArgs())}`
        ].join("\n");
        const args = buildTerminalArgs(["bash", "-lc", script], ["--network", "host"]);
        return startTerminalSession({
          args,
          command: "docker",
          commandPreview: commandPreview(args)
        });
      }

      if (actionId === "terminal-codex-device-reauth") {
        const script = [
          "codex logout || true",
          `exec ${commandPreview(codexDeviceLoginCommandArgs())}`
        ].join("\n");
        const args = buildTerminalArgs(["bash", "-lc", script]);
        return startTerminalSession({
          args,
          command: "docker",
          commandPreview: commandPreview(args)
        });
      }

      return {
        ok: false,
        error: "Unknown terminal action."
      };
    },

    readTerminal(sessionId) {
      return readTerminalSession(sessionId);
    },

    writeTerminal(sessionId, data) {
      return writeTerminalSession(sessionId, data);
    },

    closeTerminal(sessionId) {
      return closeTerminalSession(sessionId);
    }
  });
}

export {
  TOOLCHAIN_IMAGE,
  codexBrowserLoginCommandArgs,
  codexDeviceLoginCommandArgs,
  codexLoginRepairs,
  mysqlCapabilitySql,
  mysqlRepair,
  isBootstrapReady,
  createService
};
