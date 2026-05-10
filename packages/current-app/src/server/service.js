import { execFile } from "node:child_process";
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { loadAppConfigFromAppRoot } from "@jskit-ai/kernel/server/support";

const execFileAsync = promisify(execFile);

const JSKIT_APP_MARKERS = Object.freeze([
  { id: "packageJson", label: "package.json", relativePath: "package.json", kind: "file" },
  { id: "publicConfig", label: "config/public.js", relativePath: "config/public.js", kind: "file" },
  { id: "clientEntry", label: "src/main.js", relativePath: "src/main.js", kind: "file" },
  {
    id: "mainDescriptor",
    label: "packages/main/package.descriptor.mjs",
    relativePath: "packages/main/package.descriptor.mjs",
    kind: "file"
  },
  { id: "jskitLock", label: ".jskit/lock.json", relativePath: ".jskit/lock.json", kind: "file" }
]);

const PROJECT_DIRECTORIES = Object.freeze([
  { id: "src", label: "src", relativePath: "src" },
  { id: "packages", label: "packages", relativePath: "packages" },
  { id: "tests", label: "tests", relativePath: "tests" }
]);

function normalizePlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function sortTextValues(values = []) {
  return [...values]
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}

async function pathExists(absolutePath) {
  try {
    await access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile(absolutePath) {
  if (!(await pathExists(absolutePath))) {
    return {
      exists: false,
      data: null,
      error: ""
    };
  }

  try {
    const source = await readFile(absolutePath, "utf8");
    return {
      exists: true,
      data: JSON.parse(source),
      error: ""
    };
  } catch (error) {
    return {
      exists: true,
      data: null,
      error: String(error?.message || error)
    };
  }
}

async function inspectMarkers(appRoot) {
  const markers = [];
  for (const marker of JSKIT_APP_MARKERS) {
    markers.push({
      ...marker,
      exists: await pathExists(path.join(appRoot, marker.relativePath))
    });
  }
  return markers;
}

async function inspectDirectories(appRoot) {
  const directories = [];
  for (const directory of PROJECT_DIRECTORIES) {
    directories.push({
      ...directory,
      exists: await pathExists(path.join(appRoot, directory.relativePath))
    });
  }
  return directories;
}

async function inspectLocalPackages(appRoot) {
  const packagesPath = path.join(appRoot, "packages");
  if (!(await pathExists(packagesPath))) {
    return [];
  }

  try {
    const entries = await readdir(packagesPath, {
      withFileTypes: true
    });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}

function normalizeScripts(packageJson) {
  return Object.entries(normalizePlainObject(packageJson?.scripts))
    .map(([name, command]) => ({
      name,
      command: String(command || "")
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function normalizePackageNamesFromManifest(packageJson) {
  return sortTextValues([
    ...Object.keys(normalizePlainObject(packageJson?.dependencies)),
    ...Object.keys(normalizePlainObject(packageJson?.devDependencies)),
    ...Object.keys(normalizePlainObject(packageJson?.peerDependencies)),
    ...Object.keys(normalizePlainObject(packageJson?.optionalDependencies))
  ]);
}

function normalizeInstalledPackages(lockJson) {
  const installedPackages = normalizePlainObject(lockJson?.installedPackages);
  return Object.entries(installedPackages)
    .map(([fallbackPackageId, rawRecord]) => {
      const record = normalizePlainObject(rawRecord);
      const source = normalizePlainObject(record.source);
      return {
        packageId: String(record.packageId || fallbackPackageId),
        version: String(record.version || ""),
        sourceType: String(source.type || ""),
        packagePath: String(source.packagePath || "")
      };
    })
    .filter((record) => record.packageId)
    .sort((left, right) => left.packageId.localeCompare(right.packageId));
}

function packageIdMatches(packageId, fragments = []) {
  const normalizedPackageId = String(packageId || "").toLowerCase();
  return fragments.some((fragment) => normalizedPackageId.includes(fragment));
}

function detectRuntimeNeeds({ packageNames = [], installedPackages = [] } = {}) {
  const packageIds = sortTextValues([
    ...packageNames,
    ...installedPackages.map((entry) => entry.packageId)
  ]);

  return {
    auth: packageIds.some((packageId) => packageIdMatches(packageId, ["auth-"])),
    users: packageIds.some((packageId) => packageIdMatches(packageId, ["users-"])),
    workspaces: packageIds.some((packageId) => packageIdMatches(packageId, ["workspaces-"])),
    database: packageIds.some((packageId) => packageIdMatches(packageId, ["database-runtime"]))
  };
}

function normalizeSurfaces(appConfig) {
  const surfaceDefinitions = normalizePlainObject(appConfig?.surfaceDefinitions);
  return Object.values(surfaceDefinitions)
    .map((rawSurface) => {
      const surface = normalizePlainObject(rawSurface);
      return {
        id: String(surface.id || ""),
        label: String(surface.label || ""),
        pagesRoot: String(surface.pagesRoot || ""),
        enabled: surface.enabled === true,
        requiresAuth: surface.requiresAuth === true,
        requiresWorkspace: surface.requiresWorkspace === true,
        accessPolicyId: String(surface.accessPolicyId || "")
      };
    })
    .filter((surface) => surface.id)
    .sort((left, right) => left.id.localeCompare(right.id));
}

async function inspectConfig(appRoot) {
  const publicConfigExists = await pathExists(path.join(appRoot, "config/public.js"));
  const serverConfigExists = await pathExists(path.join(appRoot, "config/server.js"));
  if (!publicConfigExists) {
    return {
      publicConfigExists,
      serverConfigExists,
      loadError: "",
      tenancyMode: "",
      surfaceDefaultId: "",
      surfaces: []
    };
  }

  try {
    const appConfig = await loadAppConfigFromAppRoot({
      appRoot
    });
    return {
      publicConfigExists,
      serverConfigExists,
      loadError: "",
      tenancyMode: String(appConfig?.tenancyMode || ""),
      surfaceDefaultId: String(appConfig?.surfaceDefaultId || ""),
      surfaces: normalizeSurfaces(appConfig)
    };
  } catch (error) {
    return {
      publicConfigExists,
      serverConfigExists,
      loadError: String(error?.message || error),
      tenancyMode: "",
      surfaceDefaultId: "",
      surfaces: []
    };
  }
}

async function runGit(appRoot, args) {
  try {
    const result = await execFileAsync("git", args, {
      cwd: appRoot,
      timeout: 5000,
      maxBuffer: 1024 * 1024
    });
    return {
      ok: true,
      stdout: String(result.stdout || "").trim(),
      stderr: String(result.stderr || "").trim(),
      error: ""
    };
  } catch (error) {
    return {
      ok: false,
      stdout: String(error?.stdout || "").trim(),
      stderr: String(error?.stderr || "").trim(),
      error: String(error?.message || error)
    };
  }
}

function parseGitStatus(rawStatus) {
  return String(rawStatus || "")
    .split(/\r?\n/u)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => ({
      code: line.slice(0, 2).trim() || "??",
      path: line.slice(3).trim() || line.trim()
    }));
}

async function inspectGit(appRoot, { includeGit = true } = {}) {
  if (!includeGit) {
    return {
      checked: false,
      isRepo: false,
      rootPath: "",
      branch: "",
      dirty: false,
      changedFiles: [],
      error: ""
    };
  }

  const repoCheck = await runGit(appRoot, ["rev-parse", "--is-inside-work-tree"]);
  if (!repoCheck.ok || repoCheck.stdout !== "true") {
    return {
      checked: true,
      isRepo: false,
      rootPath: "",
      branch: "",
      dirty: false,
      changedFiles: [],
      error: repoCheck.stderr || repoCheck.error
    };
  }

  const [rootResult, branchResult, statusResult] = await Promise.all([
    runGit(appRoot, ["rev-parse", "--show-toplevel"]),
    runGit(appRoot, ["branch", "--show-current"]),
    runGit(appRoot, ["status", "--short"])
  ]);
  const changedFiles = parseGitStatus(statusResult.stdout);

  return {
    checked: true,
    isRepo: true,
    rootPath: rootResult.stdout,
    branch: branchResult.stdout,
    dirty: changedFiles.length > 0,
    changedFiles,
    error: statusResult.ok ? "" : statusResult.stderr || statusResult.error
  };
}

async function inspectCurrentApp(appRoot, { includeGit = true } = {}) {
  const normalizedAppRoot = path.resolve(String(appRoot || process.cwd()));
  const [packageResult, lockResult, markers, directories, localPackages, config, git] = await Promise.all([
    readJsonFile(path.join(normalizedAppRoot, "package.json")),
    readJsonFile(path.join(normalizedAppRoot, ".jskit/lock.json")),
    inspectMarkers(normalizedAppRoot),
    inspectDirectories(normalizedAppRoot),
    inspectLocalPackages(normalizedAppRoot),
    inspectConfig(normalizedAppRoot),
    inspectGit(normalizedAppRoot, { includeGit })
  ]);

  const packageJson = normalizePlainObject(packageResult.data);
  const lockJson = normalizePlainObject(lockResult.data);
  const packageNames = normalizePackageNamesFromManifest(packageJson);
  const installedPackages = normalizeInstalledPackages(lockJson);
  const jskitPackagesFromLock = installedPackages.filter((entry) =>
    entry.packageId.startsWith("@jskit-ai/") || entry.packageId.startsWith("@local/")
  );
  const directJskitDependencies = packageNames.filter((packageName) =>
    packageName.startsWith("@jskit-ai/") || packageName.startsWith("@local/")
  );

  return Object.freeze({
    ok: true,
    rootPath: normalizedAppRoot,
    isJskitApp: markers.every((marker) => marker.exists),
    markers,
    directories,
    packageJson: {
      exists: packageResult.exists,
      error: packageResult.error,
      name: String(packageJson.name || ""),
      version: String(packageJson.version || ""),
      private: packageJson.private === true,
      scripts: normalizeScripts(packageJson),
      directJskitDependencies
    },
    jskitLock: {
      exists: lockResult.exists,
      error: lockResult.error,
      installedPackages: jskitPackagesFromLock
    },
    config,
    localPackages,
    runtimeNeeds: detectRuntimeNeeds({
      packageNames,
      installedPackages
    }),
    git
  });
}

function createService({ appRoot = process.cwd() } = {}) {
  return Object.freeze({
    async inspectCurrentApp(input = {}, options = {}) {
      void options;
      return inspectCurrentApp(appRoot, {
        includeGit: input?.includeGit !== false
      });
    }
  });
}

export {
  createService,
  inspectCurrentApp
};
