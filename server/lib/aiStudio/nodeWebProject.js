import {
  detectPackageManager,
  installCommand,
  readPackageJson
} from "./nodePackage.js";

const DEFAULT_APP_ROUTER_MARKER_IDS = Object.freeze([
  "app_router",
  "src_app_router"
]);

const DEFAULT_PAGES_ROUTER_MARKER_IDS = Object.freeze([
  "pages_router",
  "src_pages_router"
]);

function projectMarkerExists(markers = [], markerId = "") {
  return markers.some((marker) => marker.id === markerId && marker.exists);
}

function projectRouterMode(markers = [], {
  appRouterMarkerIds = DEFAULT_APP_ROUTER_MARKER_IDS,
  pagesRouterMarkerIds = DEFAULT_PAGES_ROUTER_MARKER_IDS
} = {}) {
  const hasApp = appRouterMarkerIds.some((id) => projectMarkerExists(markers, id));
  const hasPages = pagesRouterMarkerIds.some((id) => projectMarkerExists(markers, id));
  if (hasApp && hasPages) {
    return "app+pages";
  }
  if (hasApp) {
    return "app";
  }
  if (hasPages) {
    return "pages";
  }
  return "unknown";
}

async function nodePackageManagerInspectionExtra({
  packageJson = null,
  targetRoot = ""
} = {}) {
  return {
    packageManager: await detectPackageManager(
      targetRoot,
      packageJson || await readPackageJson(targetRoot)
    )
  };
}

function commandLineScript(lines = []) {
  return [
    "set -e",
    ...lines
  ].join("\n");
}

async function nodeInstallWorkflowHook({ worktreePath = "" } = {}) {
  const packageJson = await readPackageJson(worktreePath);
  const packageManager = await detectPackageManager(worktreePath, packageJson || {});
  const command = installCommand(packageManager.name);
  return {
    command,
    commandPreview: command,
    metadata: {
      dependencies_package_manager: packageManager.name
    }
  };
}

export {
  commandLineScript,
  nodeInstallWorkflowHook,
  nodePackageManagerInspectionExtra,
  projectMarkerExists,
  projectRouterMode
};
