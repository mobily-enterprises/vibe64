import path from "node:path";

import {
  blockedDoctorCheck as blockedCheck,
  formatDoctorList as formatList,
  hardStopDoctorCheck as hardStopCheck,
  passDoctorCheck as passCheck
} from "../../../doctorCheckItems.js";
import {
  shellQuote
} from "../../../shellCommands.js";
import {
  shellScript
} from "../../../shellScript.js";
import {
  selectedConfigValue
} from "../../configValues.js";
import {
  writableHostUserDockerArgs
} from "../../dockerRuntime.js";
import {
  parseEnvText
} from "../../envFiles.js";
import {
  createManagedDatabaseDockerArgs,
  createManagedDatabaseRepair,
  jskitDatabaseDockerArgs,
  JSKIT_HOST_DATABASE_HOST,
  JSKIT_MARIADB_HOST,
  JSKIT_MARIADB_ROOT_PASSWORD,
  jskitMariaDbContainerName,
  managedMariaDbAccessInstructions,
  startJskitMariaDbRepair,
  validateDatabaseName
} from "./setupMariaDbRuntime.js";
import {
  configImportProblems,
  missingDirectDependencies,
  readPackageJson
} from "./setupDependencyChecks.js";
import {
  JSKIT_TOOLCHAIN_IMAGE
} from "./toolchainIdentity.js";

const JSKIT_TENANCY_MODE_CONFIG = "jskit_tenancy_mode";
const JSKIT_CREATE_APP_TENANCY_MODES = new Set([
  "none",
  "personal",
  "workspaces"
]);

const DATABASE_ENV_KEYS = Object.freeze([
  "DATABASE_URL",
  "DB_CLIENT",
  "DB_HOST",
  "DB_PORT",
  "DB_NAME",
  "DB_USER",
  "DB_PASSWORD"
]);

function selectedJskitTenancyMode(config = {}) {
  return selectedConfigValue(config, JSKIT_TENANCY_MODE_CONFIG, JSKIT_CREATE_APP_TENANCY_MODES, "none");
}

function repoNameFromTargetRoot(targetRoot) {
  return String(path.basename(targetRoot) || "jskit-app")
    .replace(/[^A-Za-z0-9_.-]+/gu, "-")
    .replace(/^-+|-+$/gu, "") || "jskit-app";
}

function titleFromRepoName(repoName) {
  return repoName
    .split(/[-_.\s]+/u)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ") || "JSKIT App";
}

function scaffoldCommandPreview(config = {}) {
  return `npx @jskit-ai/create-app "$JSKIT_APP_NAME" --target . --force --tenancy-mode ${shellQuote(selectedJskitTenancyMode(config))} --title "$JSKIT_APP_TITLE" --initial-bundles none`;
}

function scaffoldScript(config = {}) {
  return shellScript([
    "set -e",
    "set -x",
    scaffoldCommandPreview(config)
  ]);
}

function scaffoldEnvArgs(targetRoot) {
  const repoName = repoNameFromTargetRoot(targetRoot);
  return [
    ...writableHostUserDockerArgs({
      env: {
        npm_config_cache: "/tmp/npm-cache"
      }
    }),
    "-e",
    `JSKIT_APP_NAME=${repoName}`,
    "-e",
    `JSKIT_APP_TITLE=${titleFromRepoName(repoName)}`
  ];
}

function scaffoldTerminalAction(targetRoot, toolkit) {
  return toolkit.toolchainTerminalAction({
    actionId: "terminal-scaffold-jskit",
    autoRun: true,
    commandArgs: (context = {}) => ["bash", "-lc", scaffoldScript(context.config)],
    commandPreview: (context = {}) => scaffoldCommandPreview(context.config),
    extraArgs: (context = {}) => scaffoldEnvArgs(context.targetRoot || targetRoot),
    image: JSKIT_TOOLCHAIN_IMAGE,
    label: "Seed this project",
    targetRoot
  });
}

function scaffoldRepair(targetRoot, context, toolkit) {
  return scaffoldTerminalAction(targetRoot, toolkit).repair({
    config: context.config,
    targetRoot
  });
}

function npmInstallScript() {
  return shellScript([
    "set -e",
    "set -x",
    "npm install",
    "jskit_deps=$(node -e \"const p=require('./package.json'); const deps={...(p.dependencies||{}), ...(p.devDependencies||{})}; console.log(Object.keys(deps).filter((name) => name.startsWith('@jskit-ai/')).join(' '));\")",
    "if [ -n \"$jskit_deps\" ]; then npm update $jskit_deps; fi"
  ]);
}

function npmInstallTerminalAction(targetRoot, toolkit) {
  return toolkit.toolchainTerminalAction({
    actionId: "terminal-npm-install",
    autoRun: true,
    commandArgs: ["bash", "-lc", npmInstallScript()],
    extraArgs: writableHostUserDockerArgs({
      env: {
        npm_config_cache: "/tmp/npm-cache"
      }
    }),
    image: JSKIT_TOOLCHAIN_IMAGE,
    label: "Install dependencies",
    targetRoot
  });
}

function npmInstallRepair(targetRoot, toolkit) {
  return npmInstallTerminalAction(targetRoot, toolkit).repair({
    targetRoot
  });
}

function databaseEnvWriteScript(targetRoot, {
  replaceExisting = false
} = {}) {
  const defaults = defaultDatabaseEnv(targetRoot);
  const lines = Object.entries(defaults).map(([key, value]) => `${key}=${value}`);
  const script = [
    "set -e",
    "env_file=.env",
    "touch \"$env_file\""
  ];
  if (replaceExisting) {
    script.push(
      "tmp_file=\"$(mktemp)\"",
      `grep -Ev '^(${DATABASE_ENV_KEYS.join("|")})=' "$env_file" > "$tmp_file" || true`,
      "mv \"$tmp_file\" \"$env_file\""
    );
  } else {
    script.push(
      `if grep -Eq '^(${DATABASE_ENV_KEYS.join("|")})=' "$env_file"; then`,
      "  echo '.env already contains database settings; edit it manually instead of seeding defaults.' >&2",
      "  exit 1",
      "fi"
    );
  }
  script.push(
    "printf '\\n# AI Studio managed MariaDB defaults\\n' >> \"$env_file\"",
    ...lines.map((line) => `printf '%s\\n' ${shellQuote(line)} >> "$env_file"`),
    "echo 'Wrote .env database settings for Studio-managed MariaDB.'"
  );
  return script.join("\n");
}

function seedDatabaseEnvTerminalAction(targetRoot, toolkit) {
  return toolkit.shellTerminalAction({
    actionId: "terminal-seed-jskit-db-env",
    autoRun: true,
    commandPreview: "seed JSKIT database .env defaults",
    cwd: targetRoot,
    label: "Seed database .env",
    script: () => databaseEnvWriteScript(targetRoot)
  });
}

function seedDatabaseEnvRepair(targetRoot, toolkit) {
  return seedDatabaseEnvTerminalAction(targetRoot, toolkit).repair({
    targetRoot
  });
}

function managedDatabaseEnvTerminalAction(targetRoot, toolkit) {
  return toolkit.shellTerminalAction({
    actionId: "terminal-use-managed-jskit-db-env",
    autoRun: true,
    commandPreview: "write Studio-managed MariaDB .env defaults",
    cwd: targetRoot,
    label: "Use Studio-managed MariaDB .env",
    script: () => databaseEnvWriteScript(targetRoot, {
      replaceExisting: true
    })
  });
}

function managedDatabaseEnvRepair(targetRoot, toolkit) {
  return managedDatabaseEnvTerminalAction(targetRoot, toolkit).repair({
    targetRoot
  });
}

function packageScript(packageJson, scriptName) {
  const value = packageJson?.scripts?.[scriptName];
  return typeof value === "string" ? value.trim() : "";
}

async function localJskitCliCommandExists(targetRoot, toolkit) {
  const cliPackage = await toolkit.readTargetJson("node_modules/@jskit-ai/jskit-cli/package.json", {
    targetRoot
  });
  return Boolean(cliPackage.ok && cliPackage.value?.bin?.jskit);
}

function dependencyNames(packageJson, jskitLock) {
  const names = new Set();
  for (const bucket of ["dependencies", "devDependencies", "optionalDependencies"]) {
    for (const name of Object.keys(packageJson?.[bucket] || {})) {
      names.add(name);
    }
  }
  for (const name of Object.keys(jskitLock?.installedPackages || {})) {
    names.add(name);
  }
  return names;
}

async function readDotEnv(targetRoot, toolkit) {
  const envFile = await toolkit.readTargetFile(".env", {
    targetRoot
  });
  return envFile.ok ? parseEnvText(envFile.value) : {};
}

function databaseUrlSettings(url) {
  try {
    const parsed = new URL(url);
    return {
      databaseName: parsed.pathname.replace(/^\/+/u, "").split("/")[0] || "",
      host: parsed.hostname || "",
      password: decodeURIComponent(parsed.password || ""),
      port: parsed.port || "",
      user: decodeURIComponent(parsed.username || "")
    };
  } catch {
    return {
      databaseName: "",
      host: "",
      password: "",
      port: "",
      user: ""
    };
  }
}

function databaseEnvIsEmpty(env = {}) {
  return !DATABASE_ENV_KEYS.some((key) => String(env[key] || "").trim());
}

function databaseNameFromTargetRoot(targetRoot = "") {
  return repoNameFromTargetRoot(targetRoot)
    .replace(/[^A-Za-z0-9_]+/gu, "_")
    .replace(/^_+|_+$/gu, "") || "jskit_app";
}

function defaultDatabaseEnv(targetRoot = "") {
  return {
    DB_CLIENT: "mysql2",
    DB_HOST: JSKIT_MARIADB_HOST,
    DB_NAME: databaseNameFromTargetRoot(targetRoot),
    DB_PASSWORD: JSKIT_MARIADB_ROOT_PASSWORD,
    DB_PORT: "3306",
    DB_USER: "root"
  };
}

function managedDatabaseEnvMismatches(env = {}, targetRoot = "") {
  return Object.entries(defaultDatabaseEnv(targetRoot))
    .filter(([key, expectedValue]) => String(env[key] || "").trim() !== expectedValue)
    .map(([key, expectedValue]) => ({
      actual: key === "DB_PASSWORD" && env[key] ? "<redacted>" : String(env[key] || "").trim() || "(missing)",
      expected: key === "DB_PASSWORD" ? "<managed password>" : expectedValue,
      key
    }));
}

function formatManagedDatabaseEnvMismatches(mismatches = []) {
  return mismatches
    .map((item) => `${item.key}: expected ${item.expected}, observed ${item.actual}`)
    .join("\n");
}

function resolvedDatabaseEnv(env = {}) {
  const fromUrl = databaseUrlSettings(env.DATABASE_URL);
  return {
    databaseName: String(env.DB_NAME || fromUrl.databaseName || "").trim(),
    host: String(env.DB_HOST || fromUrl.host || "").trim(),
    password: String(env.DB_PASSWORD ?? fromUrl.password ?? ""),
    port: String(env.DB_PORT || fromUrl.port || "3306").trim(),
    user: String(env.DB_USER || fromUrl.user || "").trim()
  };
}

function loopbackDatabaseHost(host = "") {
  const normalized = String(host || "").trim().toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function formatDatabaseEndpoint(database = {}) {
  return `${database.host || "(missing host)"}:${database.port || "(missing port)"}`;
}

async function checkScaffold(targetRoot, context, toolkit) {
  const markers = {
    configPublic: await toolkit.targetConfigFileExists("public.js", { targetRoot }),
    lock: await toolkit.targetFileExists(".jskit/lock.json", { targetRoot }),
    packageJson: await toolkit.targetFileExists("package.json", { targetRoot })
  };

  if (markers.lock) {
    const lock = await toolkit.readTargetJson(".jskit/lock.json", { targetRoot });
    if (!lock.ok) {
      return hardStopCheck({
        id: "scaffold",
        label: "Seed JSKIT app",
        expected: ".jskit/lock.json is valid JSON.",
        observed: lock.error,
        explanation: "Malformed JSKIT metadata needs manual recovery before Studio can reason about the app."
      });
    }
    context.jskitLock = lock.value;
  }

  if (markers.packageJson && markers.lock && markers.configPublic) {
    return passCheck({
      id: "scaffold",
      label: "Seed JSKIT app",
      expected: "package.json, .jskit/lock.json, and config/public.js exist.",
      observed: "Minimal JSKIT scaffold markers are present.",
      explanation: "Studio can now use official JSKIT tooling for deeper checks."
    });
  }

  const nonGitEntries = (context.nonGitEntries || []).filter((entry) => entry !== "node_modules");
  if (nonGitEntries.length) {
    return hardStopCheck({
      id: "scaffold",
      label: "Seed JSKIT app",
      expected: "Existing files are already a recognizable JSKIT scaffold.",
      observed: `Missing markers: ${Object.entries(markers).filter(([, present]) => !present).map(([name]) => name).join(", ")}\nFiles: ${formatList(nonGitEntries)}`,
      explanation: "Studio will not run the JSKIT app generator over an existing non-JSKIT file tree."
    });
  }

  return blockedCheck({
    id: "scaffold",
    label: "Seed JSKIT app",
    expected: "Minimal JSKIT scaffold markers exist.",
    observed: "No scaffold files are present yet.",
    explanation: "Seed this target with the selected JSKIT configuration before installing dependencies or checking runtime readiness.",
    repair: scaffoldRepair(targetRoot, context, toolkit)
  });
}

async function checkDependencies(targetRoot, context, toolkit) {
  const packageJson = await readPackageJson(targetRoot, toolkit);
  context.packageJson = packageJson;
  if (!packageJson) {
    return blockedCheck({
      id: "dependencies",
      label: "Dependencies runnable",
      expected: "package.json exists before npm install.",
      observed: "package.json is missing.",
      explanation: "Dependencies can only be installed after the scaffold exists."
    });
  }

  const missingDependencies = await missingDirectDependencies(targetRoot, packageJson, toolkit);
  if (missingDependencies.length) {
    return blockedCheck({
      id: "dependencies",
      label: "Dependencies runnable",
      expected: "All direct non-optional package.json dependencies are installed.",
      observed: `Missing node_modules packages:\n${formatList(missingDependencies)}`,
      explanation: "Install dependencies before checking runtime readiness or later workflow commands.",
      repair: npmInstallRepair(targetRoot, toolkit)
    });
  }

  const importProblems = await configImportProblems(targetRoot, toolkit);
  if (importProblems.length) {
    return blockedCheck({
      id: "dependencies",
      label: "Dependencies runnable",
      expected: "Config-file package imports resolve from installed node_modules.",
      observed: formatList(importProblems, 8),
      explanation: "The target lockfile can pin stale JSKIT packages that install successfully but do not provide exports used by generated config files.",
      repair: npmInstallRepair(targetRoot, toolkit)
    });
  }

  const hasJskitBin = await toolkit.targetFileExists(path.join("node_modules", ".bin", "jskit"), { targetRoot });
  const hasJskitCli = await toolkit.targetFileExists(path.join("node_modules", "@jskit-ai", "jskit-cli"), { targetRoot });
  if (hasJskitBin || hasJskitCli) {
    return passCheck({
      id: "dependencies",
      label: "Dependencies runnable",
      expected: "JSKIT CLI dependency is installed locally.",
      observed: "node_modules contains JSKIT CLI tooling.",
      explanation: "Local JSKIT commands can run in the target project.",
      repair: npmInstallRepair(targetRoot, toolkit)
    });
  }

  return blockedCheck({
    id: "dependencies",
    label: "Dependencies runnable",
    expected: "Local dependencies are installed.",
    observed: "node_modules does not contain JSKIT CLI tooling.",
    explanation: "Install dependencies before checking runtime readiness or later workflow commands.",
    repair: npmInstallRepair(targetRoot, toolkit)
  });
}

async function checkRuntimeServices(targetRoot, context, toolkit) {
  const packageJson = context.packageJson || await readPackageJson(targetRoot, toolkit);
  const names = dependencyNames(packageJson, context.jskitLock);
  const hasDatabase = [...names].some((name) => name.includes("database-runtime"));
  const wantsMariaDb = [...names].some((name) => name.includes("database-runtime-mysql"));
  const wantsPostgres = [...names].some((name) => name.includes("database-runtime-postgres"));

  if (!hasDatabase) {
    return passCheck({
      id: "runtime-services",
      label: "Runtime services",
      expected: "No runtime service is required unless the target project asks for one.",
      observed: "No JSKIT database runtime package detected.",
      explanation: "Fresh minimal scaffolds do not require a database."
    });
  }

  if (wantsPostgres && !wantsMariaDb) {
    return hardStopCheck({
      id: "runtime-services",
      label: "Runtime services",
      expected: "This JSKIT setup plugin supports the MariaDB-compatible JSKIT runtime.",
      observed: "Postgres runtime package detected.",
      explanation: "Postgres service orchestration belongs in the JSKIT adapter before this target can be set up automatically."
    });
  }

  const env = await readDotEnv(targetRoot, toolkit);
  if (databaseEnvIsEmpty(env)) {
    const seedRepair = seedDatabaseEnvRepair(targetRoot, toolkit);
    return blockedCheck({
      id: "runtime-services",
      label: "Runtime services",
      expected: ".env declares the database connection that Studio containers should use.",
      observed: "No database settings were found in .env.",
      explanation: "The JSKIT adapter uses .env as the database source of truth. Seed defaults to use Studio-managed MariaDB, or create .env manually for an existing database.",
      repair: seedRepair,
      repairs: [
        seedRepair,
        startJskitMariaDbRepair(targetRoot)
      ]
    });
  }

  const database = resolvedDatabaseEnv(env);
  const validation = validateDatabaseName(database.databaseName);
  if (!validation.ok) {
    return hardStopCheck({
      id: "runtime-services",
      label: "Runtime services",
      expected: "Database apps declare a valid DB_NAME or DATABASE_URL in .env.",
      observed: database.databaseName || "No database name found in .env.",
      explanation: "Studio cannot create or verify an app database without an explicit database name."
    });
  }

  if (!database.host) {
    return hardStopCheck({
      id: "runtime-services",
      label: "Runtime services",
      expected: ".env declares DB_HOST or DATABASE_URL.",
      observed: "No database host found in .env.",
      explanation: "Studio runs JSKIT commands in containers, so the adapter needs an explicit database host that those containers can resolve."
    });
  }

  if (loopbackDatabaseHost(database.host)) {
    return hardStopCheck({
      id: "runtime-services",
      label: "Runtime services",
      expected: ".env DB_HOST is reachable from Studio command containers.",
      observed: `DB_HOST=${database.host} resolves inside each container, not to the host machine.`,
      explanation: `Use DB_HOST=${JSKIT_HOST_DATABASE_HOST} for a host-machine database, DB_HOST=${JSKIT_MARIADB_HOST} for Studio-managed MariaDB, or a real network hostname for an external database.`
    });
  }

  return database.host === JSKIT_MARIADB_HOST
    ? checkManagedMariaDb(env, database, targetRoot, toolkit)
    : checkExternalDatabase(database, targetRoot, toolkit);
}

async function checkManagedMariaDb(env, database, targetRoot, toolkit) {
  const envMismatches = managedDatabaseEnvMismatches(env, targetRoot);
  if (envMismatches.length) {
    return hardStopCheck({
      id: "runtime-services",
      label: "Runtime services",
      expected: `When DB_HOST=${JSKIT_MARIADB_HOST}, all DB_* values match the Studio-managed MariaDB defaults.`,
      observed: formatManagedDatabaseEnvMismatches(envMismatches),
      explanation: "The managed MariaDB container is intentionally local development infrastructure. Keep the managed DB values together in .env when the target uses the managed database.",
      repair: managedDatabaseEnvRepair(targetRoot, toolkit)
    });
  }
  const containerName = jskitMariaDbContainerName(targetRoot);

  const ping = await toolkit.runDocker([
    "exec",
    containerName,
    "mariadb-admin",
    "ping",
    "-uroot",
    `-p${JSKIT_MARIADB_ROOT_PASSWORD}`,
    "--silent"
  ], {
    timeout: 12_000
  });

  if (!ping.ok) {
    return blockedCheck({
      id: "runtime-services",
      label: "Runtime services",
      expected: "Studio-managed JSKIT MariaDB is reachable.",
      observed: ping.output,
      explanation: "Start the JSKIT managed MariaDB runtime before database apps can proceed.",
      repair: startJskitMariaDbRepair(targetRoot)
    });
  }

  const schema = await toolkit.runDocker([
    "exec",
    containerName,
    "mariadb",
    "-uroot",
    `-p${JSKIT_MARIADB_ROOT_PASSWORD}`,
    "-N",
    "-B",
    "-e",
    `SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = '${database.databaseName}';`
  ], {
    timeout: 15_000
  });

  if (!schema.ok || !schema.stdout.split(/\s+/u).includes(database.databaseName)) {
    return blockedCheck({
      id: "runtime-services",
      label: "Runtime services",
      expected: `${database.databaseName} exists in Studio-managed JSKIT MariaDB.`,
      observed: schema.output || "Database not found.",
      explanation: "Create the app database before Studio starts workflow sessions for this target.",
      repair: createManagedDatabaseRepair(database.databaseName, targetRoot)
    });
  }

  if (database.user) {
    const appLogin = await toolkit.runDocker([
      "exec",
      containerName,
      "mariadb",
      `-u${database.user}`,
      database.password ? `-p${database.password}` : "",
      database.databaseName,
      "-e",
      "SELECT 1;"
    ].filter(Boolean), {
      timeout: 15_000
    });

    if (!appLogin.ok) {
      return hardStopCheck({
        id: "runtime-services",
        label: "Runtime services",
        expected: "Configured DB_USER can connect to the app database.",
        observed: appLogin.output,
        explanation: "Fix database credentials or grants manually before Studio continues."
      });
    }
  }

  return passCheck({
    id: "runtime-services",
    label: "Runtime services",
    expected: "Required runtime services are reachable.",
    observed: [
      database.user
        ? `${database.databaseName} exists and ${database.user} can connect.`
        : `${database.databaseName} exists in Studio-managed JSKIT MariaDB.`,
      managedMariaDbAccessInstructions(database.databaseName, targetRoot)
    ].join("\n"),
    explanation: "The target project's database dependency has a reachable database."
  });
}

async function checkExternalDatabase(database, targetRoot, toolkit) {
  const result = await toolkit.toolchainCommandResult({
    commandArgs: [
      "mariadb",
      "--protocol=TCP",
      "-h",
      database.host,
      "-P",
      database.port || "3306",
      ...(database.user ? [`-u${database.user}`] : []),
      ...(database.password ? [`-p${database.password}`] : []),
      database.databaseName,
      "-e",
      "SELECT 1;"
    ],
    extraArgs: jskitDatabaseDockerArgs(database.host, targetRoot),
    image: JSKIT_TOOLCHAIN_IMAGE,
    targetRoot,
    timeout: 15_000
  });

  if (!result.ok) {
    return hardStopCheck({
      id: "runtime-services",
      label: "Runtime services",
      expected: `${formatDatabaseEndpoint(database)} is reachable from Studio command containers using .env credentials.`,
      observed: result.output,
      explanation: `Fix .env or the database grants. Use DB_HOST=${JSKIT_HOST_DATABASE_HOST} when the database is running on the host machine.`
    });
  }

  return passCheck({
    id: "runtime-services",
    label: "Runtime services",
    expected: "Required runtime services are reachable.",
    observed: `${database.databaseName} is reachable at ${formatDatabaseEndpoint(database)}${database.user ? ` as ${database.user}` : ""}.`,
    explanation: "The target project's database dependency has a reachable database."
  });
}

async function checkJskitVerificationCommand(targetRoot, toolkit) {
  const packageJson = await readPackageJson(targetRoot, toolkit);
  if (!packageJson) {
    return blockedCheck({
      id: "jskit-verification-command",
      label: "JSKIT verification command",
      expected: "package.json declares a verify script or the local JSKIT CLI is installed.",
      observed: "package.json could not be read.",
      explanation: "Studio only checks that verification is available for the later workflow stage; it does not run verification during Project Setup.",
      repair: scaffoldRepair(targetRoot, {}, toolkit)
    });
  }

  const verifyScript = packageScript(packageJson, "verify");
  if (verifyScript) {
    return passCheck({
      id: "jskit-verification-command",
      label: "JSKIT verification command",
      expected: "package.json declares a verify script or the local JSKIT CLI is installed.",
      observed: `npm run verify\n${verifyScript}`,
      explanation: "The workflow can run the target verification command later without blocking Project Setup on current lint, test, or policy failures."
    });
  }

  if (await localJskitCliCommandExists(targetRoot, toolkit)) {
    return passCheck({
      id: "jskit-verification-command",
      label: "JSKIT verification command",
      expected: "package.json declares a verify script or the local JSKIT CLI is installed.",
      observed: "npx jskit app verify",
      explanation: "The local JSKIT CLI is installed, so the workflow can run JSKIT verification later."
    });
  }

  return blockedCheck({
    id: "jskit-verification-command",
    label: "JSKIT verification command",
    expected: "package.json declares a verify script or the local JSKIT CLI is installed.",
    observed: "No package.json verify script and no installed @jskit-ai/jskit-cli bin were found.",
    explanation: "Install dependencies or add a package verify script so the later workflow has a concrete verification command.",
    repair: npmInstallRepair(targetRoot, toolkit)
  });
}

function createJskitProjectSetupChecks(toolkit) {
  return {
    dependencies: {
      expected: "Node dependencies are installed enough to run JSKIT commands.",
      id: "dependencies",
      label: "Dependencies runnable",
      run: (context = {}) => checkDependencies(context.targetRoot || "", context, toolkit)
    },
    verificationCommand: {
      expected: "A JSKIT verification command is available for later workflow checks.",
      id: "jskit-verification-command",
      label: "JSKIT verification command",
      run: ({ targetRoot = "" } = {}) => checkJskitVerificationCommand(targetRoot, toolkit)
    },
    runtimeServices: {
      expected: "Only runtime services required by the target project are reachable.",
      id: "runtime-services",
      label: "Runtime services",
      run: (context = {}) => checkRuntimeServices(context.targetRoot || "", context, toolkit)
    },
    scaffold: {
      expected: "Minimal JSKIT scaffold markers exist.",
      id: "scaffold",
      label: "Seed JSKIT app",
      run: (context = {}) => checkScaffold(context.targetRoot || "", context, toolkit)
    }
  };
}

function createDatabaseTerminalAction(targetRoot, toolkit) {
  return toolkit.dockerTerminalAction({
    actionId: "terminal-create-app-db",
    autoRun: true,
    args: ({ input = {} } = {}) => {
      const validation = validateDatabaseName(input.databaseName);
      return createManagedDatabaseDockerArgs(validation.databaseName, targetRoot);
    },
    commandPreview: ({ input = {} } = {}) => {
      const validation = validateDatabaseName(input.databaseName);
      return validation.ok
        ? createManagedDatabaseRepair(validation.databaseName, targetRoot).commandPreview
        : "docker exec <mariadb-container> mariadb -e <create database>";
    },
    cwd: targetRoot,
    label: "Create app database",
    validate({ input = {} } = {}) {
      const validation = validateDatabaseName(input.databaseName);
      return validation.ok ? null : "A valid databaseName input is required.";
    }
  });
}

function createJskitProjectSetupTerminalActions({
  targetRoot = "",
  toolkit = null
} = {}) {
  if (!toolkit) {
    return [];
  }

  return [
    scaffoldTerminalAction(targetRoot, toolkit),
    npmInstallTerminalAction(targetRoot, toolkit),
    seedDatabaseEnvTerminalAction(targetRoot, toolkit),
    managedDatabaseEnvTerminalAction(targetRoot, toolkit),
    createDatabaseTerminalAction(targetRoot, toolkit)
  ];
}

export {
  createJskitProjectSetupChecks,
  createJskitProjectSetupTerminalActions,
  npmInstallScript,
  scaffoldCommandPreview,
  scaffoldScript,
  selectedJskitTenancyMode
};
