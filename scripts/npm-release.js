#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_BUMP_TYPE = "patch";
const DEFAULT_REGISTRY = "https://registry.npmjs.org/";
const VALID_BUMP_TYPES = new Set(["major", "minor", "patch"]);

function log(message) {
  process.stdout.write(`[release] ${message}\n`);
}

function fail(message) {
  process.stderr.write(`[release] ${message}\n`);
  process.exit(1);
}

function run(command, args, {
  check = true,
  quiet = false
} = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit"
  });
  if (check && result.status !== 0) {
    process.exit(result.status || 1);
  }
  return result;
}

function optionValue(args, optionName) {
  const inlinePrefix = `${optionName}=`;
  const inline = args.find((arg) => arg.startsWith(inlinePrefix));
  if (inline) {
    return inline.slice(inlinePrefix.length).trim();
  }
  const index = args.indexOf(optionName);
  return index >= 0 ? String(args[index + 1] || "").trim() : "";
}

function withoutReleaseOptions(args) {
  const filtered = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--bump") {
      index += 1;
      continue;
    }
    if (arg.startsWith("--bump=") || arg === "--no-bump") {
      continue;
    }
    filtered.push(arg);
  }
  return filtered;
}

function readPackageJson() {
  return JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
}

function packageSpec(packageJson) {
  return `${packageJson.name}@${packageJson.version}`;
}

function versionExists(spec, registry) {
  const publishedVersion = run("npm", ["view", spec, "version", "--registry", registry], {
    check: false,
    quiet: true
  });
  if (publishedVersion.status === 0 && String(publishedVersion.stdout || "").trim()) {
    return true;
  }
  if (publishedVersion.status !== 0 && !String(publishedVersion.stderr || "").includes("E404")) {
    fail(`could not check whether ${spec} is already published:\n${String(publishedVersion.stderr || "").trim()}`);
  }
  return false;
}

function printHelp() {
  process.stdout.write([
    "Publish the current package version to npm.",
    "",
    "Usage:",
    "  npm run release",
    "  npm run release -- --dry-run",
    "  npm run release -- --tag next",
    "  npm run release -- --bump minor",
    "",
    "Auth:",
    "  Uses npm's normal auth: NODE_AUTH_TOKEN or an npm auth token in ~/.npmrc.",
    "  To create a token, open https://www.npmjs.com/settings/<npm-user>/tokens",
    "  and create an Automation token or a granular token with publish access.",
    "",
    "Notes:",
    "  Stock npm does not support `npm release`; use `npm run release`.",
    "  If the current package version is already published, release bumps patch by default.",
    "  Pass --bump patch|minor|major to choose the automatic bump type."
  ].join("\n"));
  process.stdout.write("\n");
}

function authHelp(registry) {
  return [
    `npm auth is not ready for ${registry}.`,
    "Create an npm access token at https://www.npmjs.com/settings/<npm-user>/tokens.",
    "Use an Automation token, or a granular token with publish access to this package.",
    "Then either:",
    "  export NODE_AUTH_TOKEN=npm_xxx",
    `  npm config set //${new URL(registry).host}/:_authToken npm_xxx`
  ].join("\n");
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("help")) {
  printHelp();
  process.exit(0);
}

let packageJson = readPackageJson();
const registry = optionValue(args, "--registry") || DEFAULT_REGISTRY;
const bumpType = optionValue(args, "--bump") || DEFAULT_BUMP_TYPE;
const dryRun = args.includes("--dry-run");
const noBump = args.includes("--no-bump");

if (!VALID_BUMP_TYPES.has(bumpType)) {
  fail(`invalid --bump value "${bumpType}". Use patch, minor, or major.`);
}

if (packageJson.private) {
  fail("package.json is private; refusing to publish.");
}

log(`preparing ${packageSpec(packageJson)}`);

const gitRoot = run("git", ["rev-parse", "--show-toplevel"], {
  check: false,
  quiet: true
});
if (gitRoot.status === 0) {
  const status = run("git", ["status", "--porcelain"], {
    quiet: true
  });
  if (String(status.stdout || "").trim()) {
    fail("worktree is not clean. Commit or stash changes before publishing.");
  }

  const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    quiet: true
  });
  if (String(branch.stdout || "").trim() !== "main") {
    fail(`current branch is "${String(branch.stdout || "").trim()}". Switch to main before publishing.`);
  }
}

if (!dryRun) {
  const whoami = run("npm", ["whoami", "--registry", registry], {
    check: false,
    quiet: true
  });
  if (whoami.status !== 0) {
    fail(authHelp(registry));
  }
  log(`npm auth ok as ${String(whoami.stdout || "").trim()}`);
}

if (versionExists(packageSpec(packageJson), registry)) {
  if (noBump) {
    fail(`${packageSpec(packageJson)} is already published.`);
  }

  if (dryRun) {
    log(`${packageSpec(packageJson)} is already published; dry-run mode would bump ${bumpType} before publishing.`);
  } else {
    log(`${packageSpec(packageJson)} is already published; bumping ${bumpType} version.`);
    run("npm", ["version", bumpType, "--no-git-tag-version"]);
    packageJson = readPackageJson();
    log(`bumped to ${packageSpec(packageJson)}`);
    if (versionExists(packageSpec(packageJson), registry)) {
      fail(`${packageSpec(packageJson)} is already published after bumping. Bump again or choose --bump minor|major.`);
    }
  }
}

const publishArgs = [
  "publish",
  "--access",
  "public",
  "--registry",
  registry,
  ...withoutReleaseOptions(args)
];

run("npm", publishArgs);
log(`published ${packageSpec(packageJson)}.`);
