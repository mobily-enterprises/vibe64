#!/usr/bin/env node
// Builds the PHP usage recorder module for one PHP and makes it the one a
// recorded process loads.
//
//   node build.mjs [--php-config=/path/to/php-config] [--force]
//
// It needs phpize and php-config (your PHP's development package, for example
// php8.3-dev) plus make and a C compiler. Without --php-config it builds for
// the php-config on PATH. A module already built for the same PHP API version
// and source is reused unless --force is given.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  PHP_EXTENSION_DIRECTORY,
  PHP_EXTENSION_SOURCES,
  PHP_USAGE_INI_NAME,
  PHP_USAGE_MODULE_NAME,
  phpUsageModuleCache,
  phpUsageModulePath,
  phpUsageScanDirectory
} from "./module.js";

const DEVELOPMENT_PACKAGE_HINT = "Install your PHP's development package (for example php8.3-dev), which provides phpize and php-config.";

function findOnPath(command, env) {
  for (const directory of String(env.PATH || "").split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(directory, command);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Not in this directory.
    }
  }
  return "";
}

// The build never runs inside a recording, so the recorder stays inert in it.
function buildEnvironment(env) {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !name.startsWith("VIBE64_USAGE_")));
}

function run(command, args, { cwd, env }) {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error) {
    throw new Error(`${path.basename(command)} could not run: ${result.error.message}`);
  }
  return { ok: result.status === 0, output: `${result.stdout || ""}${result.stderr || ""}` };
}

function writeAtomically(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  if (Buffer.isBuffer(content)) {
    fs.writeFileSync(temporary, content);
  } else {
    fs.writeFileSync(temporary, content, "utf8");
  }
  fs.renameSync(temporary, filePath);
}

function compile({ phpConfig, phpize, cacheRoot, env }) {
  fs.mkdirSync(cacheRoot, { recursive: true });
  const buildDirectory = fs.mkdtempSync(path.join(cacheRoot, ".build-"));
  try {
    for (const name of PHP_EXTENSION_SOURCES) {
      fs.copyFileSync(path.join(PHP_EXTENSION_DIRECTORY, name), path.join(buildDirectory, name));
    }
    const steps = [
      [phpize, []],
      ["./configure", ["--enable-vibe64-usage", `--with-php-config=${phpConfig}`]],
      ["make", []]
    ];
    let log = "";
    for (const [command, args] of steps) {
      const step = run(command, args, { cwd: buildDirectory, env });
      log += `$ ${[command, ...args].join(" ")}\n${step.output}\n`;
      if (!step.ok) {
        const logPath = path.join(cacheRoot, "build.log");
        fs.writeFileSync(logPath, log, "utf8");
        throw new Error(`${path.basename(command)} failed. Full log: ${logPath}\n${step.output.trim().split("\n").slice(-15).join("\n")}`);
      }
    }
    return fs.readFileSync(path.join(buildDirectory, "modules", PHP_USAGE_MODULE_NAME));
  } finally {
    fs.rmSync(buildDirectory, { recursive: true, force: true });
  }
}

function buildPhpUsageModule({ phpConfig = "", force = false, env = process.env } = {}) {
  const childEnv = buildEnvironment(env);
  const config = phpConfig ? path.resolve(phpConfig) : findOnPath("php-config", env);
  if (!config) {
    throw new Error(`php-config was not found on PATH. ${DEVELOPMENT_PACKAGE_HINT}`);
  }
  const besideConfig = path.join(path.dirname(config), path.basename(config).replace("php-config", "phpize"));
  const phpize = fs.existsSync(besideConfig) ? besideConfig : findOnPath("phpize", env);
  if (!phpize) {
    throw new Error(`phpize was not found next to ${config} or on PATH. ${DEVELOPMENT_PACKAGE_HINT}`);
  }
  const compiler = String(env.CC || "").trim() || ["cc", "gcc", "clang"].find((name) => findOnPath(name, env));
  if (!findOnPath("make", env) || !compiler) {
    throw new Error("make and a C compiler are needed on PATH. Install them (for example build-essential).");
  }
  const phpBinary = run(config, ["--php-binary"], { env: childEnv }).output.trim();
  const info = phpBinary ? run(phpBinary, ["-n", "-i"], { env: childEnv }) : null;
  // A module must match the binary's extension build, for example API20230831,NTS.
  const phpVersion = /^PHP Version => (\S+)$/mu.exec(info?.output || "")?.[1] || "";
  const build = /^PHP Extension Build => API([0-9]+),(NTS|TS)(,debug)?$/mu.exec(info?.output || "");
  if (!build) {
    throw new Error(`${config} names PHP binary "${phpBinary}", which did not report its extension build.`);
  }
  if (build[2] !== "NTS") {
    throw new Error(`PHP ${phpVersion} at ${phpBinary} is thread-safe (ZTS). The usage recorder supports non-thread-safe PHP only.`);
  }
  const phpApi = `${build[1]}-nts${build[3] ? "-debug" : ""}`;

  const cacheRoot = phpUsageModuleCache(env);
  const modulePath = phpUsageModulePath(phpApi, env);
  const cached = !force && fs.existsSync(modulePath);
  if (!cached) {
    writeAtomically(modulePath, compile({ phpConfig: config, phpize, cacheRoot, env: childEnv }));
  }
  const check = run(phpBinary, ["-n", "-d", `extension=${modulePath}`, "-m"], { env: childEnv });
  if (!check.ok || !check.output.split("\n").includes("vibe64_usage")) {
    throw new Error(`PHP ${phpVersion} did not load ${modulePath}:\n${check.output.trim()}`);
  }
  const scanDirectory = phpUsageScanDirectory(env);
  writeAtomically(path.join(scanDirectory, PHP_USAGE_INI_NAME), [
    "; Written by Vibe64. Loads the usage recorder into recorded processes only.",
    `extension="${modulePath}"`,
    ""
  ].join("\n"));
  return { cached, modulePath, phpApi, phpBinary, phpVersion, scanDirectory };
}

function main(argv) {
  const force = argv.includes("--force");
  const phpConfig = argv.find((argument) => argument.startsWith("--php-config="))?.slice("--php-config=".length) || "";
  try {
    const result = buildPhpUsageModule({ force, phpConfig });
    process.stdout.write([
      `PHP usage recorder ${result.cached ? "already built" : "built"} for PHP ${result.phpVersion} (${result.phpApi}).`,
      `Module: ${result.modulePath}`,
      `Recorded processes load it from: ${result.scanDirectory}`,
      ""
    ].join("\n"));
  } catch (error) {
    process.stderr.write(`PHP usage recorder was not built: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}

export { buildPhpUsageModule };
