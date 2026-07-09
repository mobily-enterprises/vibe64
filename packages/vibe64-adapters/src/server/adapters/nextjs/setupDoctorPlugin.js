import {
  blockedDoctorCheck as blockedCheck,
  createDoctorRepair,
  failDoctorCheck as failCheck,
  hardStopDoctorCheck as hardStopCheck,
  passDoctorCheck as passCheck
} from "@local/vibe64-core/server/doctorCheckItems";
import {
  createDoctorPluginToolkit
} from "@local/setup-doctor-core/server/doctorPluginToolkit";
import {
  shellQuote
} from "@local/vibe64-execution/server";
import {
  checkNodePackageManagerHostCommand
} from "../../nodePackageDoctor.js";
import {
  checkExactEnvValues
} from "../../adapterHelpers/setupEnvFiles.js";
import {
  readTargetPackageJson
} from "../../adapterHelpers/setupNodePackages.js";
import {
  checkNodePackageManager,
  checkNodeWebRouterMarkers,
  nodePackageUsesNext,
  packageDependencySummary,
  selectedNodePackageManager
} from "../../adapterHelpers/setupNodeWebChecks.js";
import {
  selectedNextjsPackageManager as selectedPackageManager,
  selectedNextjsSeedBundler,
  selectedNextjsSeedImportAlias,
  selectedNextjsSeedLanguage,
  selectedNextjsSeedLinter,
  selectedNextjsSeedSourceLayout,
  selectedNextjsSeedStyling
} from "./config.js";
import {
  expectedNextjsDatabaseUrl,
  nextjsDatabaseEnvWriteScript,
  selectedNextjsDatabaseRuntime
} from "./databaseRuntime.js";

function createNextAppUseFlag(packageManager = "npm") {
  return {
    bun: "--use-bun",
    npm: "--use-npm",
    pnpm: "--use-pnpm",
    yarn: "--use-yarn"
  }[packageManager] || "--use-npm";
}

function createNextAppSeedFlags(config = {}) {
  const language = selectedNextjsSeedLanguage(config);
  const styling = selectedNextjsSeedStyling(config);
  const linter = selectedNextjsSeedLinter(config);
  const sourceLayout = selectedNextjsSeedSourceLayout(config);
  const bundler = selectedNextjsSeedBundler(config);
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
    selectedNextjsSeedImportAlias(config),
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

async function checkNextDependency(toolkit, targetRoot) {
  const packageJson = await readTargetPackageJson(targetRoot, toolkit);
  if (!packageJson) {
    return failCheck({
      id: "nextjs-dependency",
      label: "Next.js dependency",
      expected: "package.json declares next or a Next.js package script.",
      observed: "package.json is missing.",
      explanation: "Seed or restore package.json before Next.js dependency checks run."
    });
  }
  if (nodePackageUsesNext(packageJson)) {
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
    observed: `Dependencies: ${packageDependencySummary(packageJson)}`,
    explanation: "This package is not recognisable as a Next.js project."
  });
}

async function setupPackageManager(toolkit, targetRoot, config = {}) {
  return selectedNodePackageManager(toolkit, targetRoot, {
    fallback: selectedPackageManager(config)
  });
}

async function checkPackageManagerHostCommand(toolkit, targetRoot, config = {}) {
  return checkNodePackageManagerHostCommand(toolkit, {
    id: "nextjs-package-manager-host-command",
    label: "Package manager command",
    packageManager: await setupPackageManager(toolkit, targetRoot, config),
    targetRoot
  });
}

function seedDatabaseEnvRepair(targetRoot, config, toolkit) {
  return toolkit.commandTerminalAction({
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
  const seedRepair = seedDatabaseEnvRepair(targetRoot, config, toolkit);
  return checkExactEnvValues(toolkit, {
    expected: ".env.local declares the DATABASE_URL for the selected managed database.",
    expectedValues: {
      DATABASE_URL: expected
    },
    explanation: "Next.js apps conventionally read database connection strings from environment variables; Studio needs the target to point at the selected host database endpoint.",
    id: "nextjs-database-env",
    label: "Database environment",
    missingObserved: "DATABASE_URL is missing or points somewhere else.",
    passObserved: "DATABASE_URL matches the selected Vibe64-managed database.",
    relativePath: ".env.local",
    repair: seedRepair,
    repairs: [
      seedRepair
    ].filter(Boolean),
    targetRoot
  });
}

function createNextjsSetupDoctorPlugin({
  configEnvironment = {},
  runCommand,
  runTerminalCommand,
  studioRoot = "",
  targetRoot = "",
  terminalNamespace = ""
} = {}) {
  const toolkit = createDoctorPluginToolkit({
    runTerminalCommand,
    runCommand,
    studioRoot,
    targetRoot,
    terminalEnv: configEnvironment,
    terminalNamespace
  });
  const createNextAppTerminal = toolkit.hostCommandTerminalAction({
    actionId: "terminal-create-next-app",
    autoRun: true,
    commandArgs: (context = {}) => ["bash", "-lc", createNextAppScript(context.config, {
      targetRoot: context.targetRoot || targetRoot
    })],
    commandPreview: (context = {}) => createNextAppRepair(context.config).commandPreview,
    label: "Create Next.js app",
    targetRoot: ({ targetRoot: contextTargetRoot = "" } = {}) => contextTargetRoot || targetRoot
  });

  return toolkit.plugin({
    id: "nextjs-target-runtime",
    label: "Next.js target runtime",
    checks(context = {}) {
      const checkTargetRoot = context.targetRoot || targetRoot;
      return [
        {
          expected: "The selected package manager is available on the host.",
          id: "nextjs-package-manager-host-command",
          label: "Package manager command",
          run: () => checkPackageManagerHostCommand(toolkit, checkTargetRoot, context.config || {})
        },
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
          run: () => checkNodeWebRouterMarkers(toolkit, checkTargetRoot, {
            explanation: "Next.js projects use App Router and/or Pages Router directories.",
            id: "nextjs-router",
            label: "Router files",
            missingObserved: "No Next.js router directory was found."
          })
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
          run: () => checkNodePackageManager(toolkit, checkTargetRoot, {
            explanation: "Next.js workflow commands will use this package manager for install and CLI execution.",
            id: "nextjs-package-manager",
            label: "Package manager"
          })
        },
        {
          expected: "Next.js database environment matches the selected host database.",
          id: "nextjs-database-env",
          label: "Database environment",
          run: () => checkDatabaseEnv(toolkit, checkTargetRoot, context.config || {})
        }
      ];
    },
    terminalActions(context = {}) {
      return [
        createNextAppTerminal,
        toolkit.commandTerminalAction({
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
        })
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
