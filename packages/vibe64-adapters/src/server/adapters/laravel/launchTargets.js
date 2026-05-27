import {
  createVibe64WebLaunchTargetTerminalSpec
} from "@local/studio-terminal-core/server/launchTargetTerminal";
import {
  detectPackageManager,
  packageScript,
  readPackageJson,
  runScriptCommand
} from "../../nodePackage.js";
import {
  composerScript,
  readComposerJson
} from "./composerPackage.js";
import {
  LARAVEL_TOOLCHAIN_IMAGE
} from "./toolchainIdentity.js";

function laravelLaunchTarget(id, label) {
  return {
    id,
    label
  };
}

async function listLaravelLaunchTargets({
  session = {}
} = {}) {
  const worktreePath = String(session.metadata?.worktree_path || "").trim();
  if (!worktreePath || !await readComposerJson(worktreePath)) {
    return [];
  }
  return [
    laravelLaunchTarget("built", "Build assets and serve Laravel"),
    laravelLaunchTarget("serve", "Serve Laravel app")
  ];
}

async function createLaravelLaunchDescriptor({
  mode = "built",
  port,
  worktreePath = ""
} = {}) {
  const [composerJson, packageJson] = await Promise.all([
    readComposerJson(worktreePath),
    readPackageJson(worktreePath)
  ]);
  const packageManager = await detectPackageManager(worktreePath, packageJson || {});
  const hasBuildScript = packageScript(packageJson || {}, "build");
  const buildCommand = hasBuildScript ? runScriptCommand(packageManager.name, "build") : "";
  const hasServeScript = Boolean(composerScript(composerJson || {}, "serve"));
  const serverCommand = hasServeScript
    ? `composer run serve -- --host=0.0.0.0 --port ${port}`
    : `php artisan serve --host=0.0.0.0 --port ${port}`;

  return {
    commands: [
      mode === "built" && buildCommand
        ? {
            command: buildCommand,
            label: "Building Laravel frontend assets.",
            networkEnv: false
          }
        : null,
      {
        command: serverCommand,
        label: "Starting Laravel application server.",
        networkEnv: true
      }
    ].filter(Boolean),
    metadata: {
      buildCommand: mode === "built" ? buildCommand : "",
      commandSource: hasServeScript ? "composer" : "artisan",
      mode,
      packageManager: packageManager.name,
      serverCommand
    },
    urlPath: "/"
  };
}

function createLaravelLaunchTargetTerminalSpec({
  context = {},
  launchTargetId = "",
  session = {},
  targetRoot = ""
} = {}) {
  if (!["built", "serve"].includes(launchTargetId)) {
    return {
      ok: false,
      message: `Unknown Laravel launch target: ${launchTargetId || "(empty)"}.`
    };
  }
  const launchTargetRoot = targetRoot || session.targetRoot || "";
  return createVibe64WebLaunchTargetTerminalSpec({
    adapterId: "laravel",
    image: LARAVEL_TOOLCHAIN_IMAGE,
    launchTarget: context.launchTarget || laravelLaunchTarget(launchTargetId, launchTargetId),
    preferredPort: 8000,
    resolveLaunch: ({ port, worktreePath }) => createLaravelLaunchDescriptor({
      config: context.config || session.config || {},
      mode: launchTargetId,
      port,
      targetRoot: launchTargetRoot,
      worktreePath
    }),
    session,
    targetRoot: launchTargetRoot
  });
}

export {
  createLaravelLaunchDescriptor,
  createLaravelLaunchTargetTerminalSpec,
  listLaravelLaunchTargets
};
