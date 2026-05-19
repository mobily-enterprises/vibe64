#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_REGISTRY = "https://registry.npmjs.org/";

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

function printHelp() {
  process.stdout.write([
    "Publish the current package version to npm.",
    "",
    "Usage:",
    "  npm run release",
    "  npm run release -- --dry-run",
    "  npm run release -- --tag next",
    "",
    "Auth:",
    "  Uses npm's normal auth: NODE_AUTH_TOKEN or an npm auth token in ~/.npmrc.",
    "  To create a token, open https://www.npmjs.com/settings/<npm-user>/tokens",
    "  and create an Automation token or a granular token with publish access.",
    "",
    "Notes:",
    "  Stock npm does not support `npm release`; use `npm run release`."
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

const packageJson = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
const registry = optionValue(args, "--registry") || DEFAULT_REGISTRY;
const packageSpec = `${packageJson.name}@${packageJson.version}`;

if (packageJson.private) {
  fail("package.json is private; refusing to publish.");
}

log(`preparing ${packageSpec}`);

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

if (!args.includes("--dry-run")) {
  const whoami = run("npm", ["whoami", "--registry", registry], {
    check: false,
    quiet: true
  });
  if (whoami.status !== 0) {
    fail(authHelp(registry));
  }
  log(`npm auth ok as ${String(whoami.stdout || "").trim()}`);
}

const publishedVersion = run("npm", ["view", packageSpec, "version", "--registry", registry], {
  check: false,
  quiet: true
});
if (publishedVersion.status === 0 && String(publishedVersion.stdout || "").trim()) {
  fail(`${packageSpec} is already published. Bump package.json with npm version patch|minor|major, commit it, then rerun release.`);
}
if (publishedVersion.status !== 0 && !String(publishedVersion.stderr || "").includes("E404")) {
  fail(`could not check whether ${packageSpec} is already published:\n${String(publishedVersion.stderr || "").trim()}`);
}

const publishArgs = [
  "publish",
  "--access",
  "public",
  "--registry",
  registry,
  ...args
];

run("npm", publishArgs);
log("published.");
