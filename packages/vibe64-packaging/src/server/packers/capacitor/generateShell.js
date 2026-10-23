// Generates the throwaway Capacitor shell for a `capacitor` package. The shell is
// Vibe64's, never the project's: it holds exactly the native plugins installed in
// the Content package, at the versions in that package's lockfile, plus the
// pinned Capacitor runtime. Everything here is a pure function of its inputs, so
// the same saved commit always gives the same shell files.
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { canonicalJson } from "../../canonical.js";
import { publishError } from "../../errors.js";
import { androidPermissionNames } from "./permissions.js";
import { CAPACITOR_SHELL_TEMPLATE, SHELL_RUNTIME_PACKAGES, SHELL_TOOL_PACKAGES } from "./shellTemplate/index.js";

const SHELL_SPEC_FILE = "vibe64-shell.json";
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
// Capacitor's own platform and tool packages are the shell's, never plugins.
const CAPACITOR_PLATFORM_PACKAGES = new Set(["@capacitor/android", "@capacitor/ios", "@capacitor/cli", "@capacitor/core"]);
const MAX_VERSION_CODE = 2_100_000_000;

function shellError(message, details) {
  return publishError("VIBE64_PUBLISH_BUILD_INVALID", message, details);
}

function within(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

// The Content package's package.json and the nearest package-lock.json at or
// above it (a workspace keeps one lockfile at its root), never outside the source.
async function readContentDependencies({ sourceRoot, content }) {
  const root = path.resolve(sourceRoot, content.workdir || ".");
  if (!within(sourceRoot, root)) throw shellError(`Package ${content.id} Workdir leaves the project.`);
  const manifest = await readJson(path.join(root, "package.json"));
  let lockDirectory = root;
  let lockfile = null;
  while (within(sourceRoot, lockDirectory)) {
    lockfile = await readJson(path.join(lockDirectory, "package-lock.json"));
    if (lockfile) break;
    if (lockDirectory === path.resolve(sourceRoot)) break;
    lockDirectory = path.dirname(lockDirectory);
  }
  const workspaceKey = lockfile ? path.relative(lockDirectory, root).split(path.sep).join("/") : "";
  return { manifest, lockfile, workspaceKey };
}

function lockEntry(lockfile, workspaceKey, name) {
  const nested = workspaceKey ? lockfile.packages[`${workspaceKey}/node_modules/${name}`] : null;
  return nested || lockfile.packages[`node_modules/${name}`] || null;
}

// The native plugins the app really installed: its direct dependencies whose
// lockfile entry is a Capacitor plugin (it peers on @capacitor/core). Problems
// are reported, not repaired; preflight shows them and the packer refuses them.
function nativePlugins({ manifest, lockfile, workspaceKey = "" }) {
  const problems = [];
  if (!manifest || typeof manifest !== "object") {
    return { plugins: [], core: null, problems: [{ code: "content-manifest-missing", message: "The Content package has no readable package.json." }] };
  }
  if (!lockfile || typeof lockfile.packages !== "object" || lockfile.packages === null) {
    return { plugins: [], core: null, problems: [{ code: "lockfile-missing", message: "The Content package needs a package-lock.json (lockfile version 2 or later) so the app's native plugins have exact versions." }] };
  }
  const plugins = [];
  let core = null;
  for (const [name, wanted] of Object.entries(manifest.dependencies || {}).sort(([left], [right]) => left.localeCompare(right))) {
    const entry = lockEntry(lockfile, workspaceKey, name);
    if (!entry || typeof entry.version !== "string") {
      problems.push({ code: "lockfile-stale", package: name, message: `${name} is in package.json but not in package-lock.json. Install dependencies and save the lockfile.` });
      continue;
    }
    if (EXACT_VERSION.test(String(wanted)) && wanted !== entry.version) {
      problems.push({
        code: "lockfile-mismatch",
        package: name,
        message: `${name} is ${wanted} in package.json but ${entry.version} in package-lock.json. Install dependencies and save the lockfile.`
      });
      continue;
    }
    if (name === "@capacitor/core") {
      core = entry.version;
      continue;
    }
    if (CAPACITOR_PLATFORM_PACKAGES.has(name) || !entry.peerDependencies?.["@capacitor/core"]) continue;
    if (!EXACT_VERSION.test(entry.version)) {
      problems.push({ code: "plugin-version", package: name, message: `${name} has no exact registry version in package-lock.json.` });
      continue;
    }
    plugins.push({ name, version: entry.version });
  }
  return { plugins, core, problems };
}

function nextVersionCode(previous = null) {
  if (previous === null || previous === undefined) return 1;
  if (!Number.isInteger(previous) || previous < 1 || previous >= MAX_VERSION_CODE) {
    throw publishError("VIBE64_PUBLISH_TARGET_INVALID", "The previous Android build number must be a whole number below 2,100,000,000.");
  }
  return previous + 1;
}

function assertVersionCode(versionCode) {
  if (!Number.isInteger(versionCode) || versionCode < 1 || versionCode > MAX_VERSION_CODE) {
    throw shellError("An Android build needs its build number (versionCode), a whole number from 1 to 2,100,000,000.");
  }
}

// The shell's files as text, keyed by shell-relative path.
function shellFiles({ entry, plugins, version, versionCode }) {
  assertVersionCode(versionCode);
  if (!EXACT_VERSION.test(version || "")) throw shellError(`Package ${entry.id} needs its release version, such as 1.5.0.`);
  const pinned = CAPACITOR_SHELL_TEMPLATE.capacitor;
  const dependencies = Object.fromEntries([
    ...SHELL_RUNTIME_PACKAGES.map((name) => [name, pinned]),
    ...plugins.map(({ name, version: pluginVersion }) => [name, pluginVersion])
  ].sort(([left], [right]) => left.localeCompare(right)));
  const packageJson = {
    name: "vibe64-capacitor-shell",
    private: true,
    description: `Generated by Vibe64 for ${entry.application.id}. Disposable; never edit.`,
    dependencies,
    devDependencies: Object.fromEntries(SHELL_TOOL_PACKAGES.map((name) => [name, pinned]))
  };
  const config = {
    appId: entry.application.id,
    appName: entry.application.name,
    webDir: "www",
    loggingBehavior: "none"
  };
  const spec = {
    template: CAPACITOR_SHELL_TEMPLATE.id,
    package: entry.id,
    applicationId: entry.application.id,
    name: entry.application.name,
    version,
    versionCode,
    permissions: androidPermissionNames(entry.permissions),
    deepLinkScheme: entry.deepLinkScheme || null,
    appLinkDomains: [...(entry.appLinkDomains || [])].sort(),
    icon: "icon.png",
    output: `${entry.id}-${version}-unsigned.apk`
  };
  return {
    "package.json": `${JSON.stringify(packageJson, null, 2)}\n`,
    "capacitor.config.json": `${JSON.stringify(config, null, 2)}\n`,
    [SHELL_SPEC_FILE]: canonicalJson(spec)
  };
}

// Reads the source facts, refuses problems, and returns the shell files.
async function generateShell({ sourceRoot, entry, content, version, versionCode }) {
  if (entry?.packer !== "capacitor") throw shellError("Only a capacitor package has a native shell.");
  if (content?.packer !== "web-bundle" || content.id !== entry.content) throw shellError(`Package ${entry.id} needs its web-bundle Content package.`);
  const found = nativePlugins(await readContentDependencies({ sourceRoot, content }));
  if (found.problems.length) {
    throw shellError(found.problems.map(({ message }) => message).join(" "), { problems: found.problems });
  }
  return { files: shellFiles({ entry, plugins: found.plugins, version, versionCode }), plugins: found.plugins, core: found.core };
}

// Writes the shell into an empty throwaway folder: its files, the built web
// content as `www`, and the app icon.
async function writeShell({ shellRoot, files, webRoot, iconFile }) {
  await mkdir(shellRoot, { recursive: false });
  for (const [name, text] of Object.entries(files)) await writeFile(path.join(shellRoot, name), text, { flag: "wx" });
  await cp(webRoot, path.join(shellRoot, "www"), { recursive: true, errorOnExist: true, force: false });
  await cp(iconFile, path.join(shellRoot, "icon.png"), { errorOnExist: true, force: false });
}

export {
  SHELL_SPEC_FILE,
  generateShell,
  nativePlugins,
  nextVersionCode,
  readContentDependencies,
  shellFiles,
  writeShell
};
