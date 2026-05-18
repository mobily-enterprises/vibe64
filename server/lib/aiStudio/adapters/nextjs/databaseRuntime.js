import path from "node:path";

import {
  createRuntimeContainerRepair,
  runtimeContainerName,
  runtimeContainerNetworkDockerArgs
} from "../../runtimeContainers.js";
import {
  shellQuote
} from "../../../shellCommands.js";
import {
  NEXTJS_DATABASE_RUNTIME_CONFIG
} from "./constants.js";

const NEXTJS_DATABASE_RUNTIMES = new Set(["none", "postgres", "mysql"]);
const NEXTJS_POSTGRES_CONTAINER_ID = "nextjs-postgres";
const NEXTJS_POSTGRES_HOST = "nextjs-postgres";
const NEXTJS_POSTGRES_HOST_PORT = "15432";
const NEXTJS_POSTGRES_IMAGE = "postgres:17-alpine";
const NEXTJS_POSTGRES_PASSWORD = "nextjs_password";
const NEXTJS_POSTGRES_USER = "nextjs";
const NEXTJS_MYSQL_CONTAINER_ID = "nextjs-mysql";
const NEXTJS_MYSQL_HOST = "nextjs-mysql";
const NEXTJS_MYSQL_HOST_PORT = "13307";
const NEXTJS_MYSQL_IMAGE = "mysql:8.4";
const NEXTJS_MYSQL_ROOT_PASSWORD = "nextjs_root_password";

function configValues(config = {}) {
  return config?.values && typeof config.values === "object" ? config.values : config;
}

function selectedNextjsDatabaseRuntime(config = {}) {
  const runtime = String(configValues(config)[NEXTJS_DATABASE_RUNTIME_CONFIG] || "postgres").trim();
  return NEXTJS_DATABASE_RUNTIMES.has(runtime) ? runtime : "postgres";
}

function databaseNameFromTargetRoot(targetRoot = "") {
  return String(path.basename(targetRoot) || "nextjs_app")
    .replace(/[^A-Za-z0-9_]+/gu, "_")
    .replace(/^_+|_+$/gu, "") || "nextjs_app";
}

function nextjsPostgresDatabaseUrl(targetRoot = "") {
  return `postgresql://${NEXTJS_POSTGRES_USER}:${NEXTJS_POSTGRES_PASSWORD}@${NEXTJS_POSTGRES_HOST}:5432/${databaseNameFromTargetRoot(targetRoot)}`;
}

function nextjsMysqlDatabaseUrl(targetRoot = "") {
  return `mysql://root:${NEXTJS_MYSQL_ROOT_PASSWORD}@${NEXTJS_MYSQL_HOST}:3306/${databaseNameFromTargetRoot(targetRoot)}`;
}

function expectedNextjsDatabaseUrl(runtime = "none", targetRoot = "") {
  if (runtime === "postgres") {
    return nextjsPostgresDatabaseUrl(targetRoot);
  }
  if (runtime === "mysql") {
    return nextjsMysqlDatabaseUrl(targetRoot);
  }
  return "";
}

function createNextjsPostgresRuntimeContainer(targetRoot = "") {
  const databaseName = databaseNameFromTargetRoot(targetRoot);
  return {
    aliases: [
      NEXTJS_POSTGRES_HOST
    ],
    checkId: "nextjs-postgres",
    env: {
      POSTGRES_DB: databaseName,
      POSTGRES_PASSWORD: NEXTJS_POSTGRES_PASSWORD,
      POSTGRES_USER: NEXTJS_POSTGRES_USER
    },
    expected: "Managed PostgreSQL is running when selected for this Next.js target.",
    health: {
      command: [
        "pg_isready",
        "-U",
        NEXTJS_POSTGRES_USER,
        "-d",
        databaseName
      ],
      interval: "5s",
      retries: 20,
      timeout: "3s"
    },
    id: NEXTJS_POSTGRES_CONTAINER_ID,
    image: NEXTJS_POSTGRES_IMAGE,
    label: "Next.js PostgreSQL",
    ports: [
      {
        container: 5432,
        host: "127.0.0.1",
        hostPort: NEXTJS_POSTGRES_HOST_PORT
      }
    ],
    readyExplanation: "The managed PostgreSQL runtime is ready for Next.js scripts and app review.",
    secretEnv: [
      "POSTGRES_PASSWORD"
    ],
    volumes: [
      {
        id: "data",
        target: "/var/lib/postgresql/data"
      }
    ]
  };
}

function createNextjsMysqlRuntimeContainer(targetRoot = "") {
  const databaseName = databaseNameFromTargetRoot(targetRoot);
  return {
    aliases: [
      NEXTJS_MYSQL_HOST
    ],
    checkId: "nextjs-mysql",
    env: {
      MYSQL_DATABASE: databaseName,
      MYSQL_ROOT_PASSWORD: NEXTJS_MYSQL_ROOT_PASSWORD
    },
    expected: "Managed MySQL is running when selected for this Next.js target.",
    health: {
      command: [
        "mysqladmin",
        "ping",
        "-uroot",
        `-p${NEXTJS_MYSQL_ROOT_PASSWORD}`,
        "--silent"
      ],
      interval: "5s",
      retries: 30,
      timeout: "3s"
    },
    id: NEXTJS_MYSQL_CONTAINER_ID,
    image: NEXTJS_MYSQL_IMAGE,
    label: "Next.js MySQL",
    ports: [
      {
        container: 3306,
        host: "127.0.0.1",
        hostPort: NEXTJS_MYSQL_HOST_PORT
      }
    ],
    readyExplanation: "The managed MySQL runtime is ready for Next.js scripts and app review.",
    secretEnv: [
      "MYSQL_ROOT_PASSWORD"
    ],
    volumes: [
      {
        id: "data",
        target: "/var/lib/mysql"
      }
    ]
  };
}

function createNextjsRuntimeContainers({
  config = {},
  targetRoot = ""
} = {}) {
  const runtime = selectedNextjsDatabaseRuntime(config);
  if (runtime === "postgres") {
    return [createNextjsPostgresRuntimeContainer(targetRoot)];
  }
  if (runtime === "mysql") {
    return [createNextjsMysqlRuntimeContainer(targetRoot)];
  }
  return [];
}

function nextjsRuntimeContainerName({
  config = {},
  targetRoot = ""
} = {}) {
  const runtime = selectedNextjsDatabaseRuntime(config);
  if (runtime === "postgres") {
    return runtimeContainerName({
      adapterId: "nextjs",
      containerId: NEXTJS_POSTGRES_CONTAINER_ID,
      targetRoot
    });
  }
  if (runtime === "mysql") {
    return runtimeContainerName({
      adapterId: "nextjs",
      containerId: NEXTJS_MYSQL_CONTAINER_ID,
      targetRoot
    });
  }
  return "";
}

function nextjsRuntimeDockerArgs({
  config = {},
  targetRoot = ""
} = {}) {
  return selectedNextjsDatabaseRuntime(config) === "none"
    ? []
    : runtimeContainerNetworkDockerArgs(targetRoot);
}

function startNextjsRuntimeRepair({
  config = {},
  targetRoot = ""
} = {}) {
  const [container] = createNextjsRuntimeContainers({
    config,
    targetRoot
  });
  return container
    ? createRuntimeContainerRepair(container, {
        adapterId: "nextjs",
        targetRoot
      })
    : null;
}

function nextjsDatabaseEnvLines({
  config = {},
  targetRoot = ""
} = {}) {
  const runtime = selectedNextjsDatabaseRuntime(config);
  const databaseUrl = expectedNextjsDatabaseUrl(runtime, targetRoot);
  return databaseUrl ? [`DATABASE_URL=${databaseUrl}`] : [];
}

function nextjsDatabaseEnvWriteScript({
  config = {},
  targetRoot = ""
} = {}) {
  const lines = nextjsDatabaseEnvLines({
    config,
    targetRoot
  });
  return [
    "set -e",
    "env_file=.env.local",
    "touch \"$env_file\"",
    "tmp_file=\"$(mktemp)\"",
    "grep -Ev '^(DATABASE_URL)=' \"$env_file\" > \"$tmp_file\" || true",
    "mv \"$tmp_file\" \"$env_file\"",
    ...lines.map((line) => `printf '%s\\n' ${shellQuote(line)} >> "$env_file"`),
    "echo 'Wrote Next.js database settings for AI Studio-managed runtime.'"
  ].join("\n");
}

export {
  NEXTJS_DATABASE_RUNTIMES,
  NEXTJS_MYSQL_HOST,
  NEXTJS_MYSQL_HOST_PORT,
  NEXTJS_POSTGRES_HOST,
  NEXTJS_POSTGRES_HOST_PORT,
  createNextjsRuntimeContainers,
  databaseNameFromTargetRoot,
  expectedNextjsDatabaseUrl,
  nextjsDatabaseEnvLines,
  nextjsDatabaseEnvWriteScript,
  nextjsRuntimeContainerName,
  nextjsRuntimeDockerArgs,
  selectedNextjsDatabaseRuntime,
  startNextjsRuntimeRepair
};
