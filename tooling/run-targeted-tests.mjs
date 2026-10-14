import { statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { runSourceDevelopment, sourceDevelopmentSelected } from "./development/run.mjs";

const TEST_FILE_PATTERN = /\.test\.(?:c|m)?js$/u;

export function targetedTestArguments(cliArguments) {
  const positionalArguments = cliArguments.filter((argument) => !argument.startsWith("-"));
  const [target] = positionalArguments;

  if (positionalArguments.length !== 1 || !TEST_FILE_PATTERN.test(target || "")) {
    throw new Error([
      "Refusing to run an untargeted test command.",
      "Pass exactly one test file, for example:",
      "  npm test -- tests/server/example.unit.test.js",
      "Write Node test options as --option=value."
    ].join("\n"));
  }

  const requestedConcurrency = cliArguments.find((argument) => (
    argument === "--test-concurrency" || argument.startsWith("--test-concurrency=")
  ));
  if (requestedConcurrency && requestedConcurrency !== "--test-concurrency=1") {
    throw new Error("Test file concurrency is fixed at 1 for machine safety.");
  }

  const runnerOptions = cliArguments
    .filter((argument) => (
      argument.startsWith("-")
      && argument !== "--"
      && argument !== "--runInBand"
      && argument !== "--test-concurrency=1"
    ));

  return ["--test-concurrency=1", ...runnerOptions, target];
}

async function run() {
  const testArguments = targetedTestArguments(process.argv.slice(2));
  const target = testArguments.at(-1);

  if (!statSync(target).isFile()) {
    throw new Error(`Targeted test path is not a file: ${target}`);
  }

  if (sourceDevelopmentSelected()) {
    process.exitCode = await runSourceDevelopment({
      publicRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
      command: process.execPath, args: ["--test", ...testArguments]
    });
    return;
  }

  const result = spawnSync(process.execPath, ["--test", ...testArguments], {
    stdio: "inherit"
  });

  if (result.error) {
    throw result.error;
  }

  process.exitCode = result.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await run();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
