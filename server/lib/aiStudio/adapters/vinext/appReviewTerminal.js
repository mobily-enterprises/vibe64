import {
  createAiStudioAppReviewTerminalSpec
} from "../../appReviewTerminal.js";
import {
  createAiStudioLaunchTargetTerminalSpec
} from "../../launchTargetTerminal.js";
import {
  VINEXT_REVIEW_MODE_CONFIG
} from "./constants.js";
import {
  detectPackageManager,
  packageBinCommand,
  readPackageJson
} from "./packageManager.js";

function configValues(config = {}) {
  return config?.values && typeof config.values === "object" ? config.values : config;
}

function reviewMode(config = {}) {
  const mode = String(configValues(config)[VINEXT_REVIEW_MODE_CONFIG] || "production").trim();
  return mode === "development" ? "development" : "production";
}

function vinextLaunchTarget(id, label) {
  return {
    id,
    label
  };
}

async function listVinextLaunchTargets({
  session = {}
} = {}) {
  const worktreePath = String(session.metadata?.worktree_path || "").trim();
  if (!worktreePath || !await readPackageJson(worktreePath)) {
    return [];
  }
  return [
    vinextLaunchTarget("built", "Build and run built version"),
    vinextLaunchTarget("dev", "Run dev version")
  ];
}

function configForLaunchTarget(config = {}, launchTargetId = "") {
  return {
    ...configValues(config),
    [VINEXT_REVIEW_MODE_CONFIG]: launchTargetId === "dev" ? "development" : "production"
  };
}

async function createVinextReviewDescriptor({
  config = {},
  port,
  worktreePath = ""
} = {}) {
  const packageJson = await readPackageJson(worktreePath);
  const packageManager = await detectPackageManager(worktreePath, packageJson || {});
  const mode = reviewMode(config);
  const buildCommand = packageBinCommand(packageManager.name, "vinext", ["build"]);
  const serverCommand = mode === "development"
    ? packageBinCommand(packageManager.name, "vinext", ["dev", "--hostname", "0.0.0.0", "--port", String(port)])
    : packageBinCommand(packageManager.name, "vinext", ["start", "--hostname", "0.0.0.0", "--port", String(port)]);

  return {
    commands: [
      mode === "production"
        ? {
            command: buildCommand,
            label: "Building Vinext app.",
            networkEnv: false
          }
        : null,
      {
        command: serverCommand,
        label: "Starting Vinext review server.",
        networkEnv: true
      }
    ].filter(Boolean),
    metadata: {
      buildCommand: mode === "production" ? buildCommand : "",
      commandSource: "vinext",
      mode,
      packageManager: packageManager.name,
      serverCommand
    },
    urlPath: "/"
  };
}

function createVinextLaunchTargetTerminalSpec({
  context = {},
  launchTargetId = "",
  session = {},
  targetRoot = ""
} = {}) {
  if (!["built", "dev"].includes(launchTargetId)) {
    return {
      ok: false,
      message: `Unknown Vinext launch target: ${launchTargetId || "(empty)"}.`
    };
  }
  return createAiStudioLaunchTargetTerminalSpec({
    adapterId: "vinext",
    launchTarget: context.launchTarget || vinextLaunchTarget(launchTargetId, launchTargetId),
    resolveLaunch: ({ port, worktreePath }) => createVinextReviewDescriptor({
      config: configForLaunchTarget(context.config || session.config || {}, launchTargetId),
      port,
      worktreePath
    }),
    session,
    targetRoot
  });
}

function createVinextAppReviewTerminalSpec({
  context = {},
  session = {},
  targetRoot = ""
} = {}) {
  return createAiStudioAppReviewTerminalSpec({
    adapterId: "vinext",
    resolveReview: ({ port, worktreePath }) => createVinextReviewDescriptor({
      config: context.config || session.config || {},
      port,
      worktreePath
    }),
    session,
    targetRoot
  });
}

export {
  createVinextAppReviewTerminalSpec,
  createVinextLaunchTargetTerminalSpec,
  createVinextReviewDescriptor,
  listVinextLaunchTargets
};
