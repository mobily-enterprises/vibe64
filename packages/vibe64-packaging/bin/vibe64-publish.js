#!/usr/bin/env node
// Rebuilds and publishes a project's declared packages outside the editor, from
// the same Packaging section and building blocks Vibe64 uses.
import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const USAGE = `Usage: vibe64-publish <command> [options]

Commands:
  plan --target <id>=<destination>:<package>[:<channel>] ... [--version <package>=<x.y.z>] ...
                     Print the exact publish plan and its hash for the current commit.
  build <package>    Build one package without credentials into the result store.
  sign               Sign built artifacts (Android APK).
  publish            Upload built artifacts and read them back.

Options:
  --project <path>   Project root (default: the current directory).
  -h, --help         Show this help.
`;

function fail(message, code = 2) {
  process.stderr.write(`${message}\n`);
  process.exitCode = code;
}

function parseArguments(argv) {
  const options = { project: process.cwd(), targets: [], versions: {}, positional: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined) throw new Error(`${argument} needs a value.`);
      index += 1;
      return next;
    };
    if (argument === "--project") options.project = path.resolve(value());
    else if (argument === "--target") {
      const match = /^([^=]+)=([^:]+):([^:]+)(?::(.+))?$/u.exec(value());
      if (!match) throw new Error("--target takes <id>=<destination>:<package>[:<channel>].");
      options.targets.push({ id: match[1], destination: match[2], package: match[3], channel: match[4] || null });
    } else if (argument === "--version") {
      const match = /^([^=]+)=(.+)$/u.exec(value());
      if (!match) throw new Error("--version takes <package>=<x.y.z>.");
      options.versions[match[1]] = match[2];
    } else if (argument === "-h" || argument === "--help") options.help = true;
    else if (argument.startsWith("-")) throw new Error(`Unknown option ${argument}.`);
    else options.positional.push(argument);
  }
  return options;
}

async function plan(options) {
  const [{ inspectVibe64Packaging }, { createPublishPlan }] = await Promise.all([
    import("@local/vibe64-genesis/server"),
    import("../src/server/plan.js")
  ]);
  const packaging = await inspectVibe64Packaging({ projectRoot: options.project });
  const savedCommit = execFileSync("git", ["rev-parse", "--verify", "HEAD^{commit}"], {
    cwd: options.project,
    encoding: "utf8"
  }).trim();
  const result = createPublishPlan({ savedCommit, packaging, versions: options.versions, targets: options.targets });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
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
  if (command === "plan" && rest.length === 0) {
    await plan(options);
    return;
  }
  if (["build", "sign", "publish"].includes(command)) {
    fail(`vibe64-publish ${command} is not available yet.`, 3);
    return;
  }
  fail(`Unknown command ${[command, ...rest].join(" ")}.\n\n${USAGE}`);
}

main(process.argv.slice(2)).catch((error) => fail(error?.message || String(error), 1));
