#!/usr/bin/env node
// Rebuilds and publishes a project's declared packages outside the editor, from
// the same Packaging section and building blocks Vibe64 uses, so the same saved
// commit gives the same files here as in Vibe64.
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";

const USAGE = `Usage: vibe64-publish <command> [options]

Commands:
  plan               Print the exact publish plan and its hash.
  build <package>    Build one package from the saved commit, without credentials,
                     and print its files and checksums.
  publish            Build every planned package once, then check (--dry-run) or
                     upload each target and read it back. A real publish asks you
                     to type the plan id in this terminal; nothing else confirms it.
  sign               Sign built artifacts (Android APK).

Options:
  --project <path>              Project root (default: the current directory).
  --commit <revision>           Saved commit to release (default: HEAD).
  --target <id>=<destination>:<package>[:<channel>]
  --version <package>=<x.y.z>   Release version of a package.
  --setting <target>.<name>=<value>
                                Target setting, such as sdk.registry=https://...
  --credential <id>=<file>      Read credential <id> (such as npm-userconfig,
                                pypi-token, github-token) from a private file.
  --result-store <path>         Where built files are kept
                                (default: ~/.cache/vibe64/publish-results).
  --dry-run                     Check every target without publishing.
  --json                        Print machine-readable JSON.
  -h, --help                    Show this help.
`;

function fail(message, code = 2) {
  process.stderr.write(`${message}\n`);
  process.exitCode = code;
}

function parseArguments(argv) {
  const options = {
    project: process.cwd(),
    commit: "HEAD",
    targets: [],
    versions: {},
    settings: {},
    credentials: {},
    resultStore: path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"), "vibe64", "publish-results"),
    positional: []
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined) throw new Error(`${argument} needs a value.`);
      index += 1;
      return next;
    };
    if (argument === "--project") options.project = path.resolve(value());
    else if (argument === "--commit") options.commit = value();
    else if (argument === "--result-store") options.resultStore = path.resolve(value());
    else if (argument === "--target") {
      const match = /^([^=]+)=([^:]+):([^:]+)(?::(.+))?$/u.exec(value());
      if (!match) throw new Error("--target takes <id>=<destination>:<package>[:<channel>].");
      options.targets.push({ id: match[1], destination: match[2], package: match[3], channel: match[4] || null });
    } else if (argument === "--version") {
      const match = /^([^=]+)=(.+)$/u.exec(value());
      if (!match) throw new Error("--version takes <package>=<x.y.z>.");
      options.versions[match[1]] = match[2];
    } else if (argument === "--setting") {
      const match = /^([^.=]+)\.([^=]+)=(.*)$/u.exec(value());
      if (!match) throw new Error("--setting takes <target>.<name>=<value>.");
      options.settings[match[1]] = { ...options.settings[match[1]], [match[2]]: match[3] };
    } else if (argument === "--credential") {
      const match = /^([^=]+)=(.+)$/u.exec(value());
      if (!match) throw new Error("--credential takes <id>=<file>.");
      options.credentials[match[1]] = path.resolve(match[2]);
    } else if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--json") options.json = true;
    else if (argument === "-h" || argument === "--help") options.help = true;
    else if (argument.startsWith("-")) throw new Error(`Unknown option ${argument}.`);
    else options.positional.push(argument);
  }
  return options;
}

function git(project, args) {
  return execFileSync("git", ["-C", project, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

// Packaging is read from the project folder, so its genesis/ folder must be
// exactly the released commit's.
async function loadProject(options) {
  const { inspectVibe64Packaging } = await import("@local/vibe64-genesis/server");
  const commit = git(options.project, ["rev-parse", "--verify", `${options.commit}^{commit}`]);
  if (git(options.project, ["status", "--porcelain", "--", "genesis"]) || git(options.project, ["diff", "--name-only", commit, "--", "genesis"])) {
    throw new Error(`genesis/ differs from ${commit.slice(0, 7)}; save it or release the commit you have checked out.`);
  }
  const packaging = await inspectVibe64Packaging({ projectRoot: options.project });
  if (packaging.status !== "ready") {
    throw new Error(`Packaging is ${packaging.status}${packaging.diagnostics?.length ? `: ${packaging.diagnostics.map((item) => item.message).join(" ")}` : "."}`);
  }
  return { commit, packaging };
}

function print(options, value, text) {
  process.stdout.write(options.json ? `${JSON.stringify(value, null, 2)}\n` : `${text}\n`);
}

function planInput(options, commit, packaging) {
  return {
    savedCommit: commit,
    packaging,
    versions: options.versions,
    targets: options.targets.map((target) => ({ ...target, settings: options.settings[target.id] }))
  };
}

async function plan(options) {
  const { createPublishPlan } = await import("../src/server/plan.js");
  const { commit, packaging } = await loadProject(options);
  const result = createPublishPlan(planInput(options, commit, packaging));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function filesText(artifacts) {
  return artifacts.manifest.files.map((file) => `  ${file.sha256}  ${file.path} (${file.size} bytes)`).join("\n");
}

async function build(options, packageId) {
  const { buildPackage } = await import("../src/server/release/buildPackage.js");
  const { commit, packaging } = await loadProject(options);
  const result = await buildPackage({
    projectRoot: options.project,
    commit,
    packaging,
    packageId,
    version: options.versions[packageId] || null,
    resultStore: options.resultStore
  });
  print(options, {
    package: packageId,
    commit,
    key: result.planHash,
    reused: result.artifacts.reused,
    directory: result.artifacts.directory,
    digest: result.artifacts.digest,
    files: result.artifacts.manifest.files
  }, `Built ${packageId} from ${commit.slice(0, 7)}${result.artifacts.reused ? " (already built)" : ""}:\n${filesText(result.artifacts)}`);
}

async function confirmInTerminal(displayId, summary) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Publishing needs you at an interactive terminal to confirm. Run it yourself, or use --dry-run.");
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    process.stdout.write(`${summary}\nThis cannot be undone. Type ${displayId} to publish: `);
    return (await prompt.question("")).trim() === displayId;
  } finally {
    prompt.close();
  }
}

async function publish(options) {
  const [{ createPublishPlan, publishPlanDisplayId }, { buildPackage }, { vibe64Destination }, { publishTarget, withStageCredentials }] = await Promise.all([
    import("../src/server/plan.js"),
    import("../src/server/release/buildPackage.js"),
    import("../src/server/destinations/index.js"),
    import("../src/server/stages.js")
  ]);
  const { commit, packaging } = await loadProject(options);
  const { plan: releasePlan, planHash } = createPublishPlan(planInput(options, commit, packaging));
  const obtainCredential = async (spec) => {
    const file = options.credentials[spec.id];
    if (!file) throw new Error(`${spec.label} is needed: pass --credential ${spec.id}=<file>.`);
    return readFile(file);
  };
  const built = new Map();
  for (const entry of releasePlan.packages) {
    built.set(entry.id, await buildPackage({
      projectRoot: options.project,
      commit,
      packaging,
      packageId: entry.id,
      version: entry.version,
      planHash,
      resultStore: options.resultStore
    }));
  }
  const targets = releasePlan.targets.map((target) => {
    const entry = releasePlan.packages.find((item) => item.id === target.package);
    return { target: { ...target, tag: entry.tag || undefined }, entry, destination: vibe64Destination(target.destination) };
  });
  if (options.dryRun) {
    const reports = [];
    for (const { target, entry, destination } of targets) {
      const specs = typeof destination.credentials === "function" ? destination.credentials(target) : destination.credentials;
      const available = specs.filter((spec) => options.credentials[spec.id]);
      reports.push({
        target: target.id,
        ...await withStageCredentials({ credentials: available, obtainCredential }, (credentials) => destination.dryRun({
          target,
          version: entry.version,
          artifacts: built.get(entry.id).artifacts,
          credentials
        }))
      });
    }
    print(options, { planHash, reports }, reports.map((report) => `${report.target}: ${report.alreadyPublished ? "already published" : "ready to publish"} ${report.version || ""}`).join("\n"));
    return;
  }
  const displayId = publishPlanDisplayId(planHash);
  const summary = targets.map(({ target, entry }) => `  ${entry.id} ${entry.version || ""} → ${target.destination}${target.channel ? ` (${target.channel})` : ""}`).join("\n");
  if (!await confirmInTerminal(displayId, `Plan ${displayId} from ${commit.slice(0, 7)}:\n${summary}`)) {
    fail("Not confirmed; nothing was published.", 1);
    return;
  }
  const results = [];
  for (const { target, entry, destination } of targets) {
    results.push(await publishTarget({ destination, target, version: entry.version, artifacts: built.get(entry.id).artifacts, obtainCredential }));
  }
  print(options, { planHash, results }, results.map((result) => `${result.target}: published ${result.version} and read back.`).join("\n"));
}

async function main(argv) {
  let options;
  try {
    options = parseArguments(argv);
  } catch (error) {
    fail(`${error.message}\n\n${USAGE}`);
    return;
  }
  const [command, ...rest] = options.positional;
  if (options.help || !command) {
    process.stdout.write(USAGE);
    if (!options.help) process.exitCode = 2;
    return;
  }
  if (command === "plan" && rest.length === 0) return plan(options);
  if (command === "build" && rest.length === 1) return build(options, rest[0]);
  if (command === "publish" && rest.length === 0) return publish(options);
  if (command === "sign") {
    fail("vibe64-publish sign is not available yet.", 3);
    return;
  }
  fail(`Unknown command ${[command, ...rest].join(" ")}.\n\n${USAGE}`);
}

main(process.argv.slice(2)).catch((error) => fail(error?.message || String(error), 1));
