import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  pathExists
} from "@local/vibe64-core/server/core";
import {
  normalizePlainObject
} from "@local/vibe64-core/server/serverResponses";
import {
  targetScriptError
} from "@local/studio-terminal-core/server/targetScriptTerminal";
import {
  runVibe64Command
} from "@local/vibe64-execution/server";

async function readJsonFile(absolutePath) {
  try {
    return JSON.parse(await readFile(absolutePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw new Error(`Cannot read ${absolutePath}: ${String(error?.message || error)}`);
  }
}

async function inspectCurrentAppMarkers(appRoot, markers = [], {
  ready = (markerResults) => markerResults.every((marker) => marker.exists)
} = {}) {
  const markerResults = await Promise.all(markers.map(async (marker) => {
    const absolutePath = path.join(appRoot, marker.relativePath);
    return {
      ...marker,
      exists: await pathExists(absolutePath),
      path: absolutePath
    };
  }));
  return {
    markers: markerResults,
    ready: ready(markerResults)
  };
}

async function inspectCurrentAppDirectories(appRoot, directories = []) {
  return Promise.all(directories.map(async (directory) => {
    const absolutePath = path.join(appRoot, directory.relativePath);
    return {
      ...directory,
      exists: await pathExists(absolutePath),
      path: absolutePath
    };
  }));
}

async function runGit(appRoot, args) {
  const result = await runVibe64Command({
    actor: "daemon",
    allowedRoots: [appRoot],
    command: "git",
    args,
    cwd: appRoot,
    envPolicy: "project",
    gitSafeDirectories: [appRoot],
    mode: "capture",
    purpose: "adapter",
    runtimes: ["git"],
    timeout: 10_000
  });
  return {
    ok: result.ok === true,
    output: String(result.ok === true ? result.stdout : result.stderr || result.stdout || result.output || result.error || "").trim()
  };
}

function parseGitStatus(rawStatus) {
  return String(rawStatus || "")
    .split(/\r?\n/gu)
    .map((line) => line.trimEnd())
    .filter(Boolean);
}

async function inspectCurrentAppGit(appRoot, {
  includeGit = true
} = {}) {
  if (!includeGit) {
    return {
      enabled: false
    };
  }
  const [branch, status] = await Promise.all([
    runGit(appRoot, ["branch", "--show-current"]),
    runGit(appRoot, ["status", "--short"])
  ]);
  return {
    branch: branch.ok ? branch.output : "",
    enabled: true,
    ok: branch.ok && status.ok,
    status: status.ok ? parseGitStatus(status.output) : [],
    statusError: status.ok ? "" : status.output
  };
}

function packageScriptEntries(packageJson = {}, {
  defaultScriptNames = []
} = {}) {
  return Object.entries(normalizePlainObject(packageJson?.scripts))
    .map(([name, command]) => ({
      command: String(command || ""),
      id: `adapter:${String(name || "")}`,
      label: String(name || ""),
      name: String(name || ""),
      source: "adapter",
      starredByDefault: defaultScriptNames.includes(String(name || ""))
    }))
    .filter((script) => script.name)
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function inspectPackageTargetScripts(appRoot, {
  defaultScriptNames = [],
  scripts = (packageJson) => packageScriptEntries(packageJson, {
    defaultScriptNames
  })
} = {}) {
  const packageJsonPath = path.join(appRoot, "package.json");
  const packageJson = await readJsonFile(packageJsonPath);
  if (!packageJson) {
    return targetScriptError("package_json_missing", `Cannot find ${packageJsonPath}.`, {
      scripts: []
    });
  }
  const scriptEntries = await scripts(packageJson, {
    appRoot,
    packageJsonPath
  });
  return {
    ok: true,
    packageJson,
    packageJsonPath,
    scriptCount: scriptEntries.length,
    scripts: scriptEntries.sort((left, right) => left.name.localeCompare(right.name))
  };
}

async function inspectDescribedCurrentApp(targetRoot, {
  adapter = "",
  appPath = "/",
  config = () => ({}),
  directories = [],
  includeGit = true,
  localPackages = () => ({
    appPackageName: "",
    packages: []
  }),
  markers = [],
  ready = (markerResults) => markerResults.every((marker) => marker.exists)
} = {}) {
  const normalizedTargetRoot = path.resolve(targetRoot || process.cwd());
  const [markerState, directoryState, git, resolvedLocalPackages, resolvedAppPath] = await Promise.all([
    inspectCurrentAppMarkers(normalizedTargetRoot, markers, {
      ready
    }),
    inspectCurrentAppDirectories(normalizedTargetRoot, directories),
    inspectCurrentAppGit(normalizedTargetRoot, {
      includeGit
    }),
    localPackages(normalizedTargetRoot),
    typeof appPath === "function" ? appPath(normalizedTargetRoot) : appPath
  ]);
  const resolvedConfig = await config(normalizedTargetRoot, {
    markers: markerState.markers,
    ready: markerState.ready
  });

  return {
    adapter,
    appPath: resolvedAppPath || "/",
    config: resolvedConfig,
    directories: directoryState,
    git,
    localPackages: resolvedLocalPackages,
    markers: markerState.markers,
    ok: true,
    ready: markerState.ready,
    root: normalizedTargetRoot
  };
}

export {
  inspectCurrentAppDirectories,
  inspectCurrentAppGit,
  inspectCurrentAppMarkers,
  inspectDescribedCurrentApp,
  inspectPackageTargetScripts,
  packageScriptEntries,
  readJsonFile
};
