import { statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { runSourceDevelopment, sourceDevelopmentSelected } from "./development/run.mjs";

const TEST_FILE_PATTERN = /\.test\.(?:c|m)?js$/u;
const HOST_PATH_GUARD = new URL("./test-host-path-guard.mjs", import.meta.url).href;
const SKIP_DISK_FLUSH = new URL("./test-skip-disk-flush.mjs", import.meta.url).href;

// Adds the module to NODE_OPTIONS once, so the process and each Node child it starts load it.
export function withPreload(env, moduleUrl) {
  const option = `--import=${moduleUrl}`;
  const current = String(env.NODE_OPTIONS || "");
  return { ...env, NODE_OPTIONS: current.includes(option) ? current : `${current} ${option}`.trim() };
}

// Every test process, and each Node child it starts, loads the host path guard.
export function withHostPathGuard(env = process.env) {
  return withPreload(env, HOST_PATH_GUARD);
}

// Every server test process returns from a file flush without waiting for the disk (test-skip-disk-flush.mjs).
export function withSkippedDiskFlush(env = process.env) {
  return withPreload(env, SKIP_DISK_FLUSH);
}

// Tests run as APP_ENV=test, as `jskit test` runs them, whatever the shell says (a Vibe64 session's commands carry
// development): no test sends real email or acts as a deployed server, and JSKIT starts no server without APP_ENV. A
// shell whose APP_ENV is staging or production is a deployed server's, where no test runs.
export function withTestAppEnvironment(env = process.env) {
  const appEnv = String(env.APP_ENV ?? "").trim();
  if (["staging", "production"].includes(appEnv)) {
    throw new Error(
      `Vibe64's tests run with APP_ENV=test, and APP_ENV is ${appEnv} here: tests never run on a staging or `
      + "production server. Run them where APP_ENV is unset, development or test."
    );
  }
  return { ...env, APP_ENV: "test" };
}

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

  const runnerOptions = cliArguments
    .filter((argument) => (
      argument.startsWith("-")
      && argument !== "--"
      && argument !== "--runInBand"
    ));

  return [...runnerOptions, target];
}

async function run() {
  const testArguments = targetedTestArguments(process.argv.slice(2));
  const target = testArguments.at(-1);

  if (!statSync(target).isFile()) {
    throw new Error(`Targeted test path is not a file: ${target}`);
  }

  const env = withTestAppEnvironment(withSkippedDiskFlush(withHostPathGuard()));
  if (sourceDevelopmentSelected()) {
    process.exitCode = await runSourceDevelopment({
      publicRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
      command: process.execPath, args: ["--test", ...testArguments], env
    });
    return;
  }

  const result = spawnSync(process.execPath, ["--test", ...testArguments], {
    env,
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
