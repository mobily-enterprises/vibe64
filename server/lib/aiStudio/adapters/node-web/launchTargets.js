import {
  createAiStudioWebLaunchTargetTerminalSpec
} from "../../launchTargetTerminal.js";
import {
  detectPackageManager,
  packageScript,
  readPackageJson,
  runScriptCommand
} from "../../nodePackage.js";
import {
  preferredLaunchScriptNames
} from "./projectDetection.js";

function launchTarget(id, label) {
  return {
    id,
    label
  };
}

function hasScript(packageJson = {}, scriptName = "") {
  return Boolean(scriptName && packageScript(packageJson, scriptName));
}

async function listGenericNodeWebLaunchTargets({
  session = {}
} = {}) {
  const worktreePath = String(session.metadata?.worktree_path || "").trim();
  const packageJson = worktreePath ? await readPackageJson(worktreePath) : null;
  if (!packageJson) {
    return [];
  }
  const scripts = preferredLaunchScriptNames(packageJson);
  return [
    scripts.build && scripts.start ? launchTarget("built", "Build and run server script") : null,
    scripts.dev ? launchTarget("dev", "Run dev script") : null,
    hasScript(packageJson, "start") ? launchTarget("start", "Run start script") : null,
    scripts.preview ? launchTarget("preview", "Run preview script") : null
  ].filter(Boolean);
}

function knownCliNetworkArgs(command = "", port = "") {
  const normalizedPort = String(port || "").trim();
  if (!normalizedPort) {
    return [];
  }
  if (/\bnext\b/u.test(command)) {
    return ["-H", "0.0.0.0", "-p", normalizedPort];
  }
  if (/\bvinext\b/u.test(command)) {
    return ["--hostname", "0.0.0.0", "--port", normalizedPort];
  }
  if (/\b(astro|ng|nuxt|svelte-kit|vite)\b/u.test(command)) {
    return ["--host", "0.0.0.0", "--port", normalizedPort];
  }
  return [];
}

function serverScriptCommand(packageJson = {}, packageManagerName = "npm", scriptName = "", {
  port = ""
} = {}) {
  const script = packageScript(packageJson, scriptName);
  return scriptName
    ? runScriptCommand(packageManagerName, scriptName, knownCliNetworkArgs(script, port))
    : "";
}

async function createGenericNodeWebLaunchDescriptor({
  launchTargetId = "dev",
  port,
  worktreePath = ""
} = {}) {
  const packageJson = await readPackageJson(worktreePath);
  const packageManager = await detectPackageManager(worktreePath, packageJson || {});
  const scripts = preferredLaunchScriptNames(packageJson || {});
  const buildScript = scripts.build;
  const serverScript = {
    built: scripts.start,
    dev: scripts.dev,
    preview: scripts.preview,
    start: scripts.start
  }[launchTargetId] || "";
  const serverCommand = serverScriptCommand(packageJson || {}, packageManager.name, serverScript, {
    port
  });
  const buildCommand = launchTargetId === "built" && buildScript
    ? runScriptCommand(packageManager.name, buildScript)
    : "";

  return {
    commands: [
      buildCommand
        ? {
            command: buildCommand,
            label: "Building Node web app.",
            networkEnv: false
          }
        : null,
      serverCommand
        ? {
            command: serverCommand,
            label: "Starting Node web app.",
            networkEnv: true
          }
        : null
    ].filter(Boolean),
    metadata: {
      buildCommand,
      commandSource: "package-script",
      packageManager: packageManager.name,
      port,
      serverCommand,
      serverScript
    },
    urlPath: "/"
  };
}

function createGenericNodeWebLaunchTargetTerminalSpec({
  context = {},
  launchTargetId = "",
  session = {},
  targetRoot = ""
} = {}) {
  if (!["built", "dev", "preview", "start"].includes(launchTargetId)) {
    return {
      ok: false,
      message: `Unknown generic Node web launch target: ${launchTargetId || "(empty)"}.`
    };
  }
  const launchTargetRoot = targetRoot || session.targetRoot || "";
  return createAiStudioWebLaunchTargetTerminalSpec({
    adapterId: "node-web",
    launchTarget: context.launchTarget || launchTarget(launchTargetId, launchTargetId),
    resolveLaunch: ({ port, worktreePath }) => createGenericNodeWebLaunchDescriptor({
      launchTargetId,
      port,
      worktreePath
    }),
    session,
    targetRoot: launchTargetRoot
  });
}

export {
  createGenericNodeWebLaunchDescriptor,
  createGenericNodeWebLaunchTargetTerminalSpec,
  listGenericNodeWebLaunchTargets
};
