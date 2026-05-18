import {
  createAiStudioAppReviewTerminalSpec
} from "../../appReviewTerminal.js";
import {
  createAiStudioLaunchTargetTerminalSpec
} from "../../launchTargetTerminal.js";
import {
  detectPackageManager,
  packageBinCommand,
  packageScript,
  readPackageJson,
  runScriptCommand
} from "../../nodePackage.js";
import {
  NEXTJS_REVIEW_MODE_CONFIG
} from "./constants.js";
import {
  nextjsRuntimeDockerArgs
} from "./databaseRuntime.js";

function configValues(config = {}) {
  return config?.values && typeof config.values === "object" ? config.values : config;
}

function reviewMode(config = {}) {
  const mode = String(configValues(config)[NEXTJS_REVIEW_MODE_CONFIG] || "production").trim();
  return mode === "development" ? "development" : "production";
}

function nextCommandOrPackageScript(packageJson = {}, packageManagerName = "npm", {
  args = [],
  binArgs = [],
  scriptName = ""
} = {}) {
  return packageScript(packageJson, scriptName)
    ? runScriptCommand(packageManagerName, scriptName, args)
    : packageBinCommand(packageManagerName, "next", binArgs.length ? binArgs : [scriptName, ...args]);
}

function nextjsLaunchTarget(id, label) {
  return {
    id,
    label
  };
}

async function listNextjsLaunchTargets({
  session = {}
} = {}) {
  const worktreePath = String(session.metadata?.worktree_path || "").trim();
  if (!worktreePath || !await readPackageJson(worktreePath)) {
    return [];
  }
  return [
    nextjsLaunchTarget("built", "Build and run built version"),
    nextjsLaunchTarget("dev", "Run dev version")
  ];
}

function configForLaunchTarget(config = {}, launchTargetId = "") {
  return {
    ...configValues(config),
    [NEXTJS_REVIEW_MODE_CONFIG]: launchTargetId === "dev" ? "development" : "production"
  };
}

async function createNextjsReviewDescriptor({
  config = {},
  port,
  targetRoot = "",
  worktreePath = ""
} = {}) {
  const packageJson = await readPackageJson(worktreePath);
  const packageManager = await detectPackageManager(worktreePath, packageJson || {});
  const mode = reviewMode(config);
  const buildCommand = nextCommandOrPackageScript(packageJson || {}, packageManager.name, {
    scriptName: "build"
  });
  const serverArgs = ["-H", "0.0.0.0", "-p", String(port)];
  const serverCommand = mode === "development"
    ? nextCommandOrPackageScript(packageJson || {}, packageManager.name, {
        args: serverArgs,
        scriptName: "dev"
      })
    : nextCommandOrPackageScript(packageJson || {}, packageManager.name, {
        args: serverArgs,
        scriptName: "start"
      });

  return {
    commands: [
      mode === "production"
        ? {
            command: buildCommand,
            label: "Building Next.js app.",
            networkEnv: false
          }
        : null,
      {
        command: serverCommand,
        label: "Starting Next.js review server.",
        networkEnv: true
      }
    ].filter(Boolean),
    extraDockerArgs: nextjsRuntimeDockerArgs({
      config,
      targetRoot
    }),
    metadata: {
      buildCommand: mode === "production" ? buildCommand : "",
      commandSource: "next",
      mode,
      packageManager: packageManager.name,
      serverCommand
    },
    urlPath: "/"
  };
}

function createNextjsLaunchTargetTerminalSpec({
  context = {},
  launchTargetId = "",
  session = {},
  targetRoot = ""
} = {}) {
  if (!["built", "dev"].includes(launchTargetId)) {
    return {
      ok: false,
      message: `Unknown Next.js launch target: ${launchTargetId || "(empty)"}.`
    };
  }
  const reviewTargetRoot = targetRoot || session.targetRoot || "";
  return createAiStudioLaunchTargetTerminalSpec({
    adapterId: "nextjs",
    launchTarget: context.launchTarget || nextjsLaunchTarget(launchTargetId, launchTargetId),
    resolveLaunch: ({ port, worktreePath }) => createNextjsReviewDescriptor({
      config: configForLaunchTarget(context.config || session.config || {}, launchTargetId),
      port,
      targetRoot: reviewTargetRoot,
      worktreePath
    }),
    session,
    targetRoot: reviewTargetRoot
  });
}

function createNextjsAppReviewTerminalSpec({
  context = {},
  session = {},
  targetRoot = ""
} = {}) {
  const reviewTargetRoot = targetRoot || session.targetRoot || "";
  return createAiStudioAppReviewTerminalSpec({
    adapterId: "nextjs",
    resolveReview: ({ port, worktreePath }) => createNextjsReviewDescriptor({
      config: context.config || session.config || {},
      port,
      targetRoot: reviewTargetRoot,
      worktreePath
    }),
    session,
    targetRoot: reviewTargetRoot
  });
}

export {
  createNextjsAppReviewTerminalSpec,
  createNextjsLaunchTargetTerminalSpec,
  createNextjsReviewDescriptor,
  listNextjsLaunchTargets
};
