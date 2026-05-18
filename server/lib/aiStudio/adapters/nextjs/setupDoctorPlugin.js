import {
  blockedDoctorCheck as blockedCheck,
  createDoctorRepair,
  failDoctorCheck as failCheck,
  hardStopDoctorCheck as hardStopCheck,
  passDoctorCheck as passCheck
} from "../../../doctorCheckItems.js";
import {
  createDoctorPluginToolkit
} from "../../../doctorPluginToolkit.js";
import {
  hostUserDockerArgs,
  shellQuote
} from "../../../shellCommands.js";
import {
  STUDIO_BASE_TOOLCHAIN_IMAGE
} from "../../../studioRuntimeIdentity.js";
import {
  createRuntimeContainerDoctorEntries
} from "../../runtimeContainers.js";
import {
  detectPackageManager,
  hasDependency
} from "../../nodePackage.js";
import {
  NEXTJS_PACKAGE_MANAGER_CONFIG,
  NEXTJS_SEED_BUNDLER_CONFIG,
  NEXTJS_SEED_IMPORT_ALIAS_CONFIG,
  NEXTJS_SEED_LANGUAGE_CONFIG,
  NEXTJS_SEED_LINTER_CONFIG,
  NEXTJS_SEED_SOURCE_LAYOUT_CONFIG,
  NEXTJS_SEED_STYLING_CONFIG
} from "./constants.js";
import {
  createNextjsRuntimeContainers,
  expectedNextjsDatabaseUrl,
  nextjsDatabaseEnvWriteScript,
  selectedNextjsDatabaseRuntime,
  startNextjsRuntimeRepair
} from "./databaseRuntime.js";

const ROUTER_MARKERS = Object.freeze([
  "app",
  "src/app",
  "pages",
  "src/pages"
]);

const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);
const SEED_BUNDLERS = new Set(["turbopack", "webpack"]);
const SEED_LANGUAGES = new Set(["typescript", "javascript"]);
const SEED_LINTERS = new Set(["eslint", "biome", "none"]);
const SEED_SOURCE_LAYOUTS = new Set(["src", "root"]);
const SEED_STYLING = new Set(["tailwind", "none"]);

function configValues(config = {}) {
  return config?.values && typeof config.values === "object" ? config.values : config;
}

function selectedPackageManager(config = {}) {
  const packageManager = String(configValues(config)[NEXTJS_PACKAGE_MANAGER_CONFIG] || "npm").trim();
  return PACKAGE_MANAGERS.has(packageManager) ? packageManager : "npm";
}

function selectedSeedValue(config = {}, fieldId = "", allowedValues = new Set(), fallback = "") {
  const value = String(configValues(config)[fieldId] || fallback).trim();
  return allowedValues.has(value) ? value : fallback;
}

function selectedSeedImportAlias(config = {}) {
  return String(configValues(config)[NEXTJS_SEED_IMPORT_ALIAS_CONFIG] || "@/*").trim() || "@/*";
}

function createNextAppUseFlag(packageManager = "npm") {
  return {
    bun: "--use-bun",
    npm: "--use-npm",
    pnpm: "--use-pnpm",
    yarn: "--use-yarn"
  }[packageManager] || "--use-npm";
}

function createNextAppSeedFlags(config = {}) {
  const language = selectedSeedValue(config, NEXTJS_SEED_LANGUAGE_CONFIG, SEED_LANGUAGES, "typescript");
  const styling = selectedSeedValue(config, NEXTJS_SEED_STYLING_CONFIG, SEED_STYLING, "tailwind");
  const linter = selectedSeedValue(config, NEXTJS_SEED_LINTER_CONFIG, SEED_LINTERS, "eslint");
  const sourceLayout = selectedSeedValue(config, NEXTJS_SEED_SOURCE_LAYOUT_CONFIG, SEED_SOURCE_LAYOUTS, "src");
  const bundler = selectedSeedValue(config, NEXTJS_SEED_BUNDLER_CONFIG, SEED_BUNDLERS, "turbopack");
  const linterFlag = {
    biome: "--biome",
    eslint: "--eslint",
    none: "--no-linter"
  }[linter];
  return [
    "--yes",
    "--reset-preferences",
    language === "javascript" ? "--javascript" : "--typescript",
    styling === "none" ? "--no-tailwind" : "--tailwind",
    linterFlag,
    "--app",
    sourceLayout === "root" ? "--no-src-dir" : "--src-dir",
    bundler === "webpack" ? "--webpack" : "--turbopack",
    "--import-alias",
    selectedSeedImportAlias(config),
    "--disable-git"
  ];
}

function createNextAppCommand({
  appDir = "$app_dir",
  config = {}
} = {}) {
  const packageManager = selectedPackageManager(config);
  const appDirArg = appDir === "$app_dir" ? "\"$app_dir\"" : shellQuote(appDir);
  const flags = [
    ...createNextAppSeedFlags(config),
    createNextAppUseFlag(packageManager)
  ].map(shellQuote).join(" ");
  if (packageManager === "pnpm") {
    return `corepack pnpm create next-app ${appDirArg} ${flags}`;
  }
  if (packageManager === "yarn") {
    return `corepack yarn create next-app ${appDirArg} ${flags}`;
  }
  if (packageManager === "bun") {
    return `bunx create-next-app@latest ${appDirArg} ${flags}`;
  }
  return `npx --yes create-next-app@latest ${appDirArg} ${flags}`;
}

function createNextAppScript(config = {}, {
  targetRoot = ""
} = {}) {
  const databaseEnvScript = selectedNextjsDatabaseRuntime(config) === "none"
    ? ""
    : nextjsDatabaseEnvWriteScript({
        config,
        targetRoot
      });
  return [
    "set -e",
    "set -x",
    "tmp_dir=\"$(mktemp -d)\"",
    "app_dir=\"$tmp_dir/app\"",
    "cleanup() { rm -rf \"$tmp_dir\"; }",
    "trap cleanup EXIT",
    createNextAppCommand({
      config
    }),
    "cp -a \"$app_dir/.\" .",
    databaseEnvScript
  ].join("\n");
}

function createNextAppRepair(config = {}) {
  return createDoctorRepair({
    actionId: "terminal-create-next-app",
    autoRun: true,
    command: createNextAppCommand({
      appDir: "<temporary-directory>/app",
      config
    }),
    kind: "terminal",
    label: "Create Next.js app"
  });
}

function writableHostUserDockerArgs() {
  return [
    ...hostUserDockerArgs(),
    "-e",
    "HOME=/tmp/studio-home",
    "-e",
    "npm_config_cache=/tmp/npm-cache"
  ];
}

async function readTargetPackageJson(toolkit, targetRoot) {
  const result = await toolkit.readTargetJson("package.json", {
    targetRoot
  });
  return result.ok ? result.value : null;
}

async function existingRouterMarkers(toolkit, targetRoot) {
  const markers = await Promise.all(ROUTER_MARKERS.map(async (relativePath) => {
    return await toolkit.targetFileExists(relativePath, {
      targetRoot
    }) ? relativePath : "";
  }));
  return markers.filter(Boolean).sort((left, right) => left.localeCompare(right));
}

function packageUsesNext(packageJson = {}) {
  return hasDependency(packageJson, "next") ||
    Object.values(packageJson?.scripts || {}).some((script) => /\bnext\b/u.test(String(script || "")));
}

async function checkPackageJson(toolkit, targetRoot, context = {}) {
  const result = await toolkit.readTargetJson("package.json", {
    targetRoot
  });
  if (!result.ok) {
    const nonGitEntries = (context.nonGitEntries || []).filter((entry) => entry !== "node_modules");
    if (nonGitEntries.length) {
      return hardStopCheck({
        id: "nextjs-package-json",
        label: "package.json",
        expected: "A package.json exists or the target has no app-owned files.",
        observed: `package.json is missing, but files exist:\n${nonGitEntries.join("\n")}`,
        explanation: "Studio will not run create-next-app over existing app files because it cannot know their ownership."
      });
    }
    return blockedCheck({
      id: "nextjs-package-json",
      label: "package.json",
      expected: "A readable package.json exists in the target project.",
      observed: result.missing ? "package.json is missing." : result.error,
      explanation: "Seed a Next.js app before installing dependencies or running workflow commands.",
      repair: createNextAppRepair(context.config)
    });
  }
  return passCheck({
    id: "nextjs-package-json",
    label: "package.json",
    expected: "A readable package.json exists in the target project.",
    observed: result.path,
    explanation: "The target has package metadata for Next.js setup."
  });
}

async function checkRouterMarkers(toolkit, targetRoot) {
  const markers = await existingRouterMarkers(toolkit, targetRoot);
  if (markers.length === 0) {
    return failCheck({
      id: "nextjs-router",
      label: "Router files",
      expected: "An app/, src/app/, pages/, or src/pages/ router directory exists.",
      observed: "No Next.js router directory was found.",
      explanation: "Next.js projects use App Router and/or Pages Router directories."
    });
  }
  return passCheck({
    id: "nextjs-router",
    label: "Router files",
    expected: "An app/, src/app/, pages/, or src/pages/ router directory exists.",
    observed: markers.join(", "),
    explanation: "The target has a router layout Next.js can inspect."
  });
}

async function checkNextDependency(toolkit, targetRoot) {
  const packageJson = await readTargetPackageJson(toolkit, targetRoot);
  if (!packageJson) {
    return failCheck({
      id: "nextjs-dependency",
      label: "Next.js dependency",
      expected: "package.json declares next or a Next.js package script.",
      observed: "package.json is missing.",
      explanation: "Seed or restore package.json before Next.js dependency checks run."
    });
  }
  if (packageUsesNext(packageJson)) {
    return passCheck({
      id: "nextjs-dependency",
      label: "Next.js dependency",
      expected: "package.json declares next or a Next.js package script.",
      observed: "Next.js dependency or script is present.",
      explanation: "The target is configured for Next.js commands."
    });
  }
  return failCheck({
    id: "nextjs-dependency",
    label: "Next.js dependency",
    expected: "package.json declares next or a Next.js package script.",
    observed: `Dependencies: ${Object.keys(packageJson.dependencies || {}).join(", ") || "none"}`,
    explanation: "This package is not recognisable as a Next.js project."
  });
}

async function checkPackageManager(toolkit, targetRoot) {
  const packageJson = await readTargetPackageJson(toolkit, targetRoot) || {};
  const packageManager = await detectPackageManager(targetRoot, packageJson);
  return passCheck({
    id: "nextjs-package-manager",
    label: "Package manager",
    expected: "Studio can identify the package manager used by the target.",
    observed: packageManager.lockfile
      ? `${packageManager.name} via ${packageManager.lockfile}`
      : `${packageManager.name} via ${packageManager.source}`,
    explanation: "Next.js workflow commands will use this package manager for install and CLI execution."
  });
}

function parseEnvText(text = "") {
  const values = {};
  for (const line of String(text || "").split(/\r?\n/u)) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u.exec(line.trim());
    if (!match) {
      continue;
    }
    let value = match[2].trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

async function readDotEnvLocal(toolkit, targetRoot) {
  const envFile = await toolkit.readTargetFile(".env.local", {
    targetRoot
  });
  return envFile.ok ? parseEnvText(envFile.value) : {};
}

function seedDatabaseEnvRepair(targetRoot, config, toolkit) {
  return toolkit.shellTerminalAction({
    actionId: "terminal-seed-nextjs-db-env",
    autoRun: true,
    commandPreview: "write Next.js DATABASE_URL defaults",
    cwd: targetRoot,
    label: "Seed database .env.local",
    script: () => nextjsDatabaseEnvWriteScript({
      config,
      targetRoot
    })
  }).repair({
    config,
    targetRoot
  });
}

async function checkDatabaseEnv(toolkit, targetRoot, config = {}) {
  const runtime = selectedNextjsDatabaseRuntime(config);
  if (runtime === "none") {
    return passCheck({
      id: "nextjs-database-env",
      label: "Database environment",
      expected: "DATABASE_URL is required only when a managed database is selected.",
      observed: "No managed database selected.",
      explanation: "This Next.js target does not need database environment defaults."
    });
  }
  const expected = expectedNextjsDatabaseUrl(runtime, targetRoot);
  const env = await readDotEnvLocal(toolkit, targetRoot);
  if (env.DATABASE_URL !== expected) {
    const seedRepair = seedDatabaseEnvRepair(targetRoot, config, toolkit);
    return blockedCheck({
      id: "nextjs-database-env",
      label: "Database environment",
      expected: ".env.local declares the DATABASE_URL for the selected managed database.",
      observed: env.DATABASE_URL ? "DATABASE_URL points somewhere else." : "DATABASE_URL is missing.",
      explanation: "Next.js apps conventionally read database connection strings from environment variables; Studio needs the target to point at the managed runtime container.",
      repair: seedRepair,
      repairs: [
        seedRepair,
        startNextjsRuntimeRepair({
          config,
          targetRoot
        })
      ].filter(Boolean)
    });
  }
  return passCheck({
    id: "nextjs-database-env",
    label: "Database environment",
    expected: ".env.local declares the DATABASE_URL for the selected managed database.",
    observed: "DATABASE_URL matches the selected AI Studio-managed database.",
    explanation: "Next.js scripts and app review terminals can attach to the managed database runtime."
  });
}

function runtimeContainerEntries(toolkit, context = {}, fallbackTargetRoot = "") {
  const targetRoot = context.targetRoot || fallbackTargetRoot;
  return createRuntimeContainerDoctorEntries(toolkit, createNextjsRuntimeContainers({
    config: context.config || {},
    targetRoot
  }), {
    adapterId: "nextjs",
    targetRoot
  });
}

function createNextjsSetupDoctorPlugin({
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
  const createNextAppTerminal = toolkit.toolchainTerminalAction({
    actionId: "terminal-create-next-app",
    autoRun: true,
    commandArgs: (context = {}) => ["bash", "-lc", createNextAppScript(context.config, {
      targetRoot: context.targetRoot || targetRoot
    })],
    commandPreview: (context = {}) => createNextAppRepair(context.config).commandPreview,
    extraArgs: writableHostUserDockerArgs(),
    image: STUDIO_BASE_TOOLCHAIN_IMAGE,
    label: "Create Next.js app",
    targetRoot: ({ targetRoot: contextTargetRoot = "" } = {}) => contextTargetRoot || targetRoot
  });

  return toolkit.plugin({
    id: "nextjs-target-runtime",
    label: "Next.js target runtime",
    checks(context = {}) {
      const checkTargetRoot = context.targetRoot || targetRoot;
      const containers = runtimeContainerEntries(toolkit, context, targetRoot);
      return [
        {
          expected: "A readable package.json exists in the target project.",
          id: "nextjs-package-json",
          label: "package.json",
          run: () => checkPackageJson(toolkit, checkTargetRoot, context)
        },
        {
          expected: "An app/, src/app/, pages/, or src/pages/ router directory exists.",
          id: "nextjs-router",
          label: "Router files",
          run: () => checkRouterMarkers(toolkit, checkTargetRoot)
        },
        {
          expected: "package.json declares next or a Next.js package script.",
          id: "nextjs-dependency",
          label: "Next.js dependency",
          run: () => checkNextDependency(toolkit, checkTargetRoot)
        },
        {
          expected: "Studio can identify the package manager used by the target.",
          id: "nextjs-package-manager",
          label: "Package manager",
          run: () => checkPackageManager(toolkit, checkTargetRoot)
        },
        {
          expected: "Next.js database environment matches the selected managed database.",
          id: "nextjs-database-env",
          label: "Database environment",
          run: () => checkDatabaseEnv(toolkit, checkTargetRoot, context.config || {})
        },
        ...containers.checks
      ];
    },
    terminalActions(context = {}) {
      return [
        createNextAppTerminal,
        toolkit.shellTerminalAction({
          actionId: "terminal-seed-nextjs-db-env",
          autoRun: true,
          commandPreview: "write Next.js DATABASE_URL defaults",
          cwd: context.targetRoot || targetRoot,
          env: configEnvironment,
          label: "Seed database .env.local",
          script: () => nextjsDatabaseEnvWriteScript({
            config: context.config || {},
            targetRoot: context.targetRoot || targetRoot
          })
        }),
        ...runtimeContainerEntries(toolkit, context, targetRoot).terminalActions
      ];
    }
  });
}

export {
  createNextAppCommand,
  createNextAppRepair,
  createNextAppScript,
  createNextjsSetupDoctorPlugin
};
