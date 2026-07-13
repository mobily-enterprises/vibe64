#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const TOOLING_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(TOOLING_DIR, "..");
const DEPENDENCY_SECTIONS = Object.freeze([
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies"
]);
const JSKIT_PACKAGE_PATTERN = /^@jskit-ai\/[a-z0-9._-]+$/iu;
const PROGRESS_INTERVAL_MS = 5_000;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function run(command, args, {
  capture = false
} = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT_DIR,
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit"
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}.`);
  }

  return capture ? String(result.stdout || "") : "";
}

function formatElapsedTime(elapsedMilliseconds = 0) {
  const elapsedSeconds = Math.max(0, Math.floor(Number(elapsedMilliseconds) / 1000));
  if (elapsedSeconds < 1) {
    return "under 1s";
  }
  if (elapsedSeconds < 60) {
    return `${elapsedSeconds}s`;
  }

  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function runWithProgress(command, args, {
  activity,
  progressIntervalMs = PROGRESS_INTERVAL_MS,
  step
} = {}) {
  const normalizedActivity = String(activity || `${command} ${args.join(" ")}`).trim();
  const normalizedStep = String(step || "Update").trim();
  const startedAt = Date.now();

  console.log(`[jskit:update] ${normalizedStep}: ${normalizedActivity}.`);

  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(command, args, {
      cwd: ROOT_DIR,
      shell: process.platform === "win32",
      stdio: "inherit"
    });
    const progressTimer = setInterval(() => {
      console.log(
        `[jskit:update] ${normalizedStep} is still running (${formatElapsedTime(Date.now() - startedAt)} elapsed): ${normalizedActivity}.`
      );
    }, progressIntervalMs);
    progressTimer.unref();

    function finish(error = null) {
      if (settled) {
        return;
      }
      settled = true;
      clearInterval(progressTimer);
      if (error) {
        reject(error);
        return;
      }
      console.log(
        `[jskit:update] ${normalizedStep} complete in ${formatElapsedTime(Date.now() - startedAt)}.`
      );
      resolve();
    }

    child.once("error", finish);
    child.once("close", (status, signal) => {
      if (status === 0) {
        finish();
        return;
      }
      const outcome = signal ? `signal ${signal}` : `exit code ${status}`;
      finish(new Error(`${command} ${args.join(" ")} failed with ${outcome}.`));
    });
  });
}

function parseFlagValue(args, name) {
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === name) {
      return String(args[index + 1] || "").trim();
    }
    if (value.startsWith(`${name}=`)) {
      return value.slice(name.length + 1).trim();
    }
  }
  return "";
}

function isDryRun(args) {
  return args.includes("--dry-run");
}

function npmRegistryArgs(args) {
  const registry = parseFlagValue(args, "--registry");
  return registry ? ["--registry", registry] : [];
}

function majorRangeFromRegistry(packageName, registryArgs) {
  const latest = run("npm", ["view", ...registryArgs, packageName, "version"], {
    capture: true
  });
  return majorRangeFromRaw(packageName, latest);
}

function majorRangeFromRaw(packageName, rawVersion) {
  const normalized = String(rawVersion || "").trim();
  const match = normalized.match(/^(\d+)\.\d+\.\d+(?:[.+-][0-9A-Za-z.-]+)?$/u);
  if (!match) {
    throw new Error(`Could not resolve latest major range for ${packageName}: ${normalized || "<empty>"}.`);
  }
  return `${match[1]}.x`;
}

function majorRangeFromSpec(packageName, rawSpec, registryArgs) {
  const spec = String(rawSpec || "").trim();
  const rangeMatch = spec.match(/^(\d+)\.x$/u);
  if (rangeMatch) {
    return spec;
  }
  const versionMatch = spec.match(/^[~^]?(\d+)\.\d+\.\d+(?:[.+-][0-9A-Za-z.-]+)?$/u);
  if (versionMatch) {
    return `${versionMatch[1]}.x`;
  }
  return majorRangeFromRegistry(packageName, registryArgs);
}

function collectRootJskitRanges(rootManifest, registryArgs) {
  const ranges = new Map();
  for (const sectionName of DEPENDENCY_SECTIONS) {
    const section = rootManifest[sectionName];
    if (!section || typeof section !== "object" || Array.isArray(section)) {
      continue;
    }
    for (const [packageName, spec] of Object.entries(section)) {
      if (!JSKIT_PACKAGE_PATTERN.test(packageName)) {
        continue;
      }
      ranges.set(packageName, majorRangeFromSpec(packageName, spec, registryArgs));
    }
  }
  return ranges;
}

function workspacePackageDirectories(rootManifest) {
  const rawWorkspaces = Array.isArray(rootManifest.workspaces)
    ? rootManifest.workspaces
    : rootManifest.workspaces?.packages;
  const workspaces = Array.isArray(rawWorkspaces) ? rawWorkspaces : [];
  const directories = [];

  for (const workspace of workspaces) {
    const pattern = String(workspace || "").trim();
    if (!pattern) {
      continue;
    }
    if (pattern.endsWith("/*") && !pattern.slice(0, -2).includes("*")) {
      const baseDirectory = path.join(ROOT_DIR, pattern.slice(0, -2));
      if (!fs.existsSync(baseDirectory)) {
        continue;
      }
      for (const entry of fs.readdirSync(baseDirectory, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
          continue;
        }
        const packageDirectory = path.join(baseDirectory, entry.name);
        if (fs.existsSync(path.join(packageDirectory, "package.json"))) {
          directories.push(packageDirectory);
        }
      }
      continue;
    }
    if (!pattern.includes("*")) {
      const packageDirectory = path.join(ROOT_DIR, pattern);
      if (fs.existsSync(path.join(packageDirectory, "package.json"))) {
        directories.push(packageDirectory);
      }
      continue;
    }
    throw new Error(`Unsupported workspace pattern for JSKIT package update: ${pattern}`);
  }

  return [...new Set(directories)].sort((left, right) => left.localeCompare(right));
}

function targetRangeForPackage(packageName, spec, rootRanges, registryArgs) {
  return rootRanges.get(packageName) || majorRangeFromSpec(packageName, spec, registryArgs);
}

function updateManifestJskitSpecs(manifest, rootRanges, registryArgs) {
  let changed = false;
  const updates = [];

  for (const sectionName of DEPENDENCY_SECTIONS) {
    const section = manifest[sectionName];
    if (!section || typeof section !== "object" || Array.isArray(section)) {
      continue;
    }
    for (const [packageName, spec] of Object.entries(section)) {
      if (!JSKIT_PACKAGE_PATTERN.test(packageName)) {
        continue;
      }
      const targetRange = targetRangeForPackage(packageName, spec, rootRanges, registryArgs);
      if (section[packageName] !== targetRange) {
        section[packageName] = targetRange;
        changed = true;
        updates.push(`${packageName}@${targetRange}`);
      }
    }
  }

  return {
    changed,
    updates
  };
}

function updateDescriptorJskitSpecs(source, rootRanges, registryArgs) {
  const updates = [];
  const nextSource = source.replace(
    /(["'])(@jskit-ai\/[a-z0-9._-]+)\1(\s*:\s*)(["'])([^"']+)\4/giu,
    (match, keyQuote, packageName, separator, valueQuote, spec) => {
      const targetRange = targetRangeForPackage(packageName, spec, rootRanges, registryArgs);
      if (spec === targetRange) {
        return match;
      }
      updates.push(`${packageName}@${targetRange}`);
      return `${keyQuote}${packageName}${keyQuote}${separator}${valueQuote}${targetRange}${valueQuote}`;
    }
  );

  return {
    changed: nextSource !== source,
    source: nextSource,
    updates
  };
}

function relativePath(filePath) {
  return path.relative(ROOT_DIR, filePath).replaceAll(path.sep, "/");
}

function updateWorkspacePackages({
  dryRun,
  registryArgs
}) {
  const rootPackagePath = path.join(ROOT_DIR, "package.json");
  const rootManifest = readJson(rootPackagePath);
  const rootRanges = collectRootJskitRanges(rootManifest, registryArgs);
  const packageDirectories = workspacePackageDirectories(rootManifest);
  const changedFiles = [];
  const workspaceJskitPackages = new Set();

  for (const packageDirectory of packageDirectories) {
    const packageJsonPath = path.join(packageDirectory, "package.json");
    const manifest = readJson(packageJsonPath);
    const manifestResult = updateManifestJskitSpecs(manifest, rootRanges, registryArgs);
    for (const packageName of jskitDependencyNames(manifest)) {
      workspaceJskitPackages.add(packageName);
    }
    if (manifestResult.changed) {
      changedFiles.push(relativePath(packageJsonPath));
      console.log(`[jskit:update] workspace manifest ${relativePath(packageJsonPath)} -> ${manifestResult.updates.join(", ")}`);
      if (!dryRun) {
        writeJson(packageJsonPath, manifest);
      }
    }

    const descriptorPath = path.join(packageDirectory, "package.descriptor.mjs");
    if (!fs.existsSync(descriptorPath)) {
      continue;
    }
    const descriptorSource = fs.readFileSync(descriptorPath, "utf8");
    const descriptorResult = updateDescriptorJskitSpecs(descriptorSource, rootRanges, registryArgs);
    if (descriptorResult.changed) {
      changedFiles.push(relativePath(descriptorPath));
      console.log(`[jskit:update] workspace descriptor ${relativePath(descriptorPath)} -> ${descriptorResult.updates.join(", ")}`);
      if (!dryRun) {
        fs.writeFileSync(descriptorPath, descriptorResult.source);
      }
    }
  }

  return {
    changedFiles,
    workspaceJskitPackages: [...workspaceJskitPackages].sort((left, right) => left.localeCompare(right))
  };
}

function jskitDependencyNames(manifest) {
  const names = new Set();
  for (const sectionName of DEPENDENCY_SECTIONS) {
    const section = manifest[sectionName];
    if (!section || typeof section !== "object" || Array.isArray(section)) {
      continue;
    }
    for (const packageName of Object.keys(section)) {
      if (JSKIT_PACKAGE_PATTERN.test(packageName)) {
        names.add(packageName);
      }
    }
  }
  return [...names].sort((left, right) => left.localeCompare(right));
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = isDryRun(args);
  const registryArgs = npmRegistryArgs(args);

  await runWithProgress("npx", ["jskit", "app", "update-packages", ...args], {
    activity: dryRun
      ? "checking root JSKIT package updates and managed migrations"
      : "updating root JSKIT packages and generating managed migrations",
    step: "Step 1/3"
  });

  console.log("[jskit:update] Step 2/3: aligning JSKIT ranges in workspace manifests and descriptors.");
  const { changedFiles, workspaceJskitPackages } = updateWorkspacePackages({
    dryRun,
    registryArgs
  });
  console.log(
    `[jskit:update] Step 2/3 complete: ${changedFiles.length} workspace files ${dryRun ? "would change" : "changed"}.`
  );

  if (dryRun) {
    console.log(
      `[jskit:update] Step 3/3 skipped in dry-run mode: ${workspaceJskitPackages.length} workspace JSKIT packages would be refreshed.`
    );
    console.log(
      `[jskit:update] dry-run mode: would update ${changedFiles.length} workspace files and refresh ${workspaceJskitPackages.length} workspace JSKIT packages.`
    );
    return;
  }

  if (workspaceJskitPackages.length > 0) {
    await runWithProgress(
      "npm",
      ["update", ...registryArgs, "--workspaces", ...workspaceJskitPackages],
      {
        activity: `refreshing ${workspaceJskitPackages.length} workspace JSKIT packages and updating the lockfile`,
        step: "Step 3/3"
      }
    );
  } else {
    console.log("[jskit:update] Step 3/3 skipped: no workspace JSKIT packages were found.");
  }

  console.log(
    `[jskit:update] updated ${changedFiles.length} workspace files and refreshed ${workspaceJskitPackages.length} workspace JSKIT packages.`
  );
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  await main();
}

export {
  formatElapsedTime,
  runWithProgress
};
