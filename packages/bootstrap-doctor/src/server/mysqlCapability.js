import {
  dockerCommand,
  runDocker
} from "./containerEngine.js";
import {
  createDoctorRepair,
  failDoctorCheck as failCheck,
  passDoctorCheck as passCheck
} from "../../../../server/lib/doctorCheckItems.js";

const MYSQL_CONTAINER = "ai-studio-bootstrap-mysql";
const MYSQL_IMAGE = "mysql:8.4";
const MYSQL_ROOT_PASSWORD = "ai_studio_bootstrap_root";
const MYSQL_VOLUME = "ai_studio_bootstrap_mysql_data";
const MYSQL_PROBE_DATABASE = "ai_studio_bootstrap_probe";
const MYSQL_PROBE_TABLE = "capability_probe";

function commandPreview(args) {
  return dockerCommand(args);
}

function mysqlCommandPreview(args) {
  return commandPreview(args.map((arg) => String(arg).replaceAll(MYSQL_ROOT_PASSWORD, "*****")));
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

function mysqlRepair() {
  const args = [
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

  return createDoctorRepair({
    actionId: "repair-mysql",
    command: [
      commandPreview(["volume", "create", MYSQL_VOLUME]),
      mysqlCommandPreview(args),
      `docker exec ${MYSQL_CONTAINER} mysqladmin ping -uroot -p***** --silent`,
      maskedMysqlExecPreview(mysqlCapabilitySql())
    ].join("\n"),
    kind: "command",
    label: "Start managed MySQL"
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
      timeout: 10000
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

async function checkMysqlCapability({
  dockerReady,
  dockerUnavailableRepair = null
} = {}) {
  if (!dockerReady) {
    return failCheck({
      id: "mysql-capability",
      label: "MySQL capability",
      expected: "Managed MySQL starts and can create/drop a temporary probe table.",
      observed: "Docker is not ready.",
      explanation: "Studio needs a working managed MySQL runtime before it can later prepare an app-specific database.",
      repair: dockerUnavailableRepair
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

export {
  buildMysqlRepairScript,
  checkMysqlCapability,
  mysqlCapabilitySql,
  mysqlRepair,
  repairMysql
};
