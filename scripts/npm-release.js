#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_ACCESS = "public";
const DEFAULT_BUMP = "patch";
const DEFAULT_REGISTRY = "https://registry.npmjs.org";
const DEFAULT_TAG = "latest";
const VALID_BUMPS = new Set(["major", "minor", "patch"]);

function log(message) {
  process.stdout.write(`[release] ${message}\n`);
}

function fail(message) {
  process.stderr.write(`[release] ${message}\n`);
  process.exit(1);
}

function run(command, args, { check = true, quiet = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: quiet ? ["ignore", "pipe", "pipe"] : ["ignore", "inherit", "inherit"]
  });

  if (check && result.status !== 0) {
    process.exit(result.status || 1);
  }

  return result;
}

function readPackageJson() {
  return JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
}

function readPackageLock() {
  return JSON.parse(readFileSync(path.join(ROOT, "package-lock.json"), "utf8"));
}

function packageSpec(packageJson) {
  return `${packageJson.name}@${packageJson.version}`;
}

function normalizeRegistryUrl(registry) {
  const value = String(registry || "").trim();
  const withScheme = /^[a-z]+:\/\//iu.test(value) ? value : `https://${value}`;
  return withScheme.replace(/\/+$/u, "");
}

function parseValueArg(argv, index, optionName) {
  const value = String(argv[index + 1] || "").trim();
  if (!value) {
    throw new Error(`${optionName} requires a value.`);
  }
  return value;
}

function parseArgs(argv) {
  const options = {
    access: DEFAULT_ACCESS,
    bump: DEFAULT_BUMP,
    dryRun: false,
    help: false,
    registry: DEFAULT_REGISTRY,
    tag: DEFAULT_TAG
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "help") {
      options.help = true;
      continue;
    }

    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg === "--access") {
      options.access = parseValueArg(argv, index, "--access");
      index += 1;
      continue;
    }

    if (arg.startsWith("--access=")) {
      options.access = arg.slice("--access=".length).trim();
      continue;
    }

    if (arg === "--bump") {
      options.bump = parseValueArg(argv, index, "--bump");
      index += 1;
      continue;
    }

    if (arg.startsWith("--bump=")) {
      options.bump = arg.slice("--bump=".length).trim();
      continue;
    }

    if (arg === "--registry") {
      options.registry = parseValueArg(argv, index, "--registry");
      index += 1;
      continue;
    }

    if (arg.startsWith("--registry=")) {
      options.registry = arg.slice("--registry=".length).trim();
      continue;
    }

    if (arg === "--tag") {
      options.tag = parseValueArg(argv, index, "--tag");
      index += 1;
      continue;
    }

    if (arg.startsWith("--tag=")) {
      options.tag = arg.slice("--tag=".length).trim();
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  options.registry = normalizeRegistryUrl(options.registry);
  if (!options.access) {
    throw new Error("Missing --access value.");
  }
  if (!VALID_BUMPS.has(options.bump)) {
    throw new Error(`Invalid --bump value "${options.bump}". Use patch, minor, or major.`);
  }
  if (!options.tag) {
    throw new Error("Missing --tag value.");
  }

  return options;
}

function packageScope(packageName) {
  const match = /^(@[^/]+)\//u.exec(String(packageName || ""));
  return match?.[1] || "";
}

function createNpmUserConfig({ packageName, registry, token }) {
  const normalizedToken = String(token || "").trim();
  if (!normalizedToken) {
    fail(authHelp(registry));
  }

  const registryUrl = new URL(registry);
  const registryWithSlash = `${registryUrl.origin}${registryUrl.pathname}`.replace(/\/+$/u, "/");
  const authHost = `${registryUrl.host}${registryUrl.pathname}`.replace(/\/+$/u, "");
  const scope = packageScope(packageName);
  const directory = mkdtempSync(path.join(os.tmpdir(), "vibe64-npmrc-"));
  const configPath = path.join(directory, "npmrc");
  const lines = [
    scope ? `${scope}:registry=${registryWithSlash}` : "",
    `registry=${registryWithSlash}`,
    `//${authHost}/:_authToken=${normalizedToken}`
  ].filter(Boolean);

  writeFileSync(configPath, `${lines.join("\n")}\n`, {
    encoding: "utf8",
    mode: 0o600
  });

  return {
    cleanup() {
      rmSync(directory, {
        force: true,
        recursive: true
      });
    },
    path: configPath
  };
}

function npmToken() {
  return String(process.env.VIBE64_NPM_TOKEN || process.env.NPM_TOKEN || "").trim();
}

function authHelp(registry) {
  return [
    `VIBE64_NPM_TOKEN or NPM_TOKEN is required to publish to ${registry}.`,
    "Create a granular npm token with read/write access to this package.",
    "Enable the token's Bypass 2FA option so npm publish cannot prompt for OTP.",
    "Then run:",
    "  export VIBE64_NPM_TOKEN=npm_xxx",
    "  npm run release"
  ].join("\n");
}

function printHelp() {
  process.stdout.write([
    "Bump the package version and publish to npm.",
    "",
    "Usage:",
    "  npm run release",
    "  npm run release -- --dry-run",
    "  npm run release -- --tag next",
    "  npm run release -- --bump minor",
    "",
    "Auth:",
    "  Requires VIBE64_NPM_TOKEN or NPM_TOKEN.",
    "  Create a granular npm token with read/write package access.",
    "  Enable the token's Bypass 2FA option to avoid npm's interactive publish prompt.",
    "  VIBE64_NPM_TOKEN is preferred when both variables are set.",
    "",
    "Notes:",
    "  Stock npm does not support `npm release`; use `npm run release`.",
    "  Release bumps patch by default before publishing.",
    "  Pass --bump patch|minor|major to choose the bump type."
  ].join("\n"));
  process.stdout.write("\n");
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return value.map(stableJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort((left, right) => left.localeCompare(right))
        .map((key) => [key, stableJson(value[key])])
    );
  }
  return value;
}

function readJsonFromGit(refPath) {
  const result = run("git", ["show", `HEAD:${refPath}`], {
    check: false,
    quiet: true
  });
  return result.status === 0 ? JSON.parse(result.stdout) : null;
}

function changedFiles() {
  const status = run("git", ["status", "--porcelain"], {
    quiet: true
  });
  return String(status.stdout || "")
    .split(/\r?\n/u)
    .map((line) => line.slice(3).trim())
    .filter(Boolean)
    .map((line) => line.replace(/^"|"$/gu, ""));
}

function normalizePackageJsonForVersionCompare(value) {
  return {
    ...value,
    version: ""
  };
}

function normalizePackageLockForVersionCompare(value) {
  return {
    ...value,
    packages: {
      ...value.packages,
      "": {
        ...value.packages?.[""],
        version: ""
      }
    },
    version: ""
  };
}

function onlyVersionFilesChanged(files) {
  const allowed = new Set(["package.json", "package-lock.json"]);
  return files.length > 0 && files.every((file) => allowed.has(file));
}

function onlyVersionValuesChanged() {
  const headPackageJson = readJsonFromGit("package.json");
  const headPackageLock = readJsonFromGit("package-lock.json");
  if (!headPackageJson || !headPackageLock) {
    return false;
  }
  return JSON.stringify(stableJson(normalizePackageJsonForVersionCompare(headPackageJson))) ===
      JSON.stringify(stableJson(normalizePackageJsonForVersionCompare(readPackageJson()))) &&
    JSON.stringify(stableJson(normalizePackageLockForVersionCompare(headPackageLock))) ===
      JSON.stringify(stableJson(normalizePackageLockForVersionCompare(readPackageLock())));
}

function releaseWorktreeState() {
  const gitRoot = run("git", ["rev-parse", "--show-toplevel"], {
    check: false,
    quiet: true
  });
  if (gitRoot.status !== 0) {
    return {
      shouldBump: true
    };
  }

  const dirtyFiles = changedFiles();
  if (dirtyFiles.length === 0) {
    return {
      shouldBump: true
    };
  }

  if (onlyVersionFilesChanged(dirtyFiles) && onlyVersionValuesChanged()) {
    return {
      shouldBump: false
    };
  }

  fail("worktree is not clean. Commit or stash changes before releasing; only a pending package version bump may be retried.");
}

function bumpPackageVersion(bump) {
  log(`bumping ${bump} version.`);
  run("npm", ["version", bump, "--no-git-tag-version"]);
  return readPackageJson();
}

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

if (options.help) {
  printHelp();
  process.exit(0);
}

let packageJson = readPackageJson();
if (packageJson.private) {
  fail("package.json is private; refusing to publish.");
}

log(`preparing ${packageSpec(packageJson)}`);
if (options.dryRun) {
  log(`dry-run mode would bump ${options.bump} version and publish to ${options.registry} with tag ${options.tag}.`);
  log("dry-run complete. No files changed or published.");
  process.exit(0);
}

const worktreeState = releaseWorktreeState();

const npmConfig = createNpmUserConfig({
  packageName: packageJson.name,
  registry: options.registry,
  token: npmToken()
});

try {
  if (worktreeState.shouldBump) {
    packageJson = bumpPackageVersion(options.bump);
  } else {
    log("continuing with existing local package version bump.");
  }
  run("npm", [
    "publish",
    "--access",
    options.access,
    "--registry",
    options.registry,
    "--tag",
    options.tag,
    "--userconfig",
    npmConfig.path
  ]);
  log(`published ${packageSpec(packageJson)}.`);
} finally {
  npmConfig.cleanup();
}
