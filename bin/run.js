#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { release as osRelease } from "node:os";
import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildRuntimeLock,
  listRuntimePackages,
  readRuntimeLock,
  runtimeToolCommandArgs,
  validateRuntimeLock,
  writeRuntimeLock
} from "@local/vibe64-core/server/runtimeToolchain";
import {
  createVibe64AdapterRegistry
} from "@local/vibe64-adapters/server";
import {
  resolveVibe64Roots
} from "@local/vibe64-core/server/studioRoots";
import {
  jskitMariaDbDatabaseName,
  jskitManagedMysqlStartCommandArgs,
  stopJskitManagedMysqlRuntime
} from "@local/vibe64-adapters/server/adapters/jskit/setupMariaDbRuntime";

const RUNNER_ENTRYPOINT = fileURLToPath(import.meta.url);
const MODULE_DIR = path.dirname(RUNNER_ENTRYPOINT);
const SERVER_ENTRYPOINT = path.join(MODULE_DIR, "server.js");
const VIBE64_RUNTIME_CLI_COMMANDS = new Set(["doctor", "runtime"]);
const CLI_LOCAL_RUNTIME_PROFILE = Object.freeze({
  local: true,
  mode: "local"
});

function quoteShellArg(value = "") {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function quoteAppleScriptString(value = "") {
  return JSON.stringify(String(value));
}

function quoteWindowsArg(value = "") {
  const text = String(value);
  return `"${text.replaceAll('"', '\\"')}"`;
}

function windowsCommandLine(command = "", args = []) {
  return [
    quoteWindowsArg(command),
    ...args.map((arg) => quoteWindowsArg(arg))
  ].join(" ");
}

function realCliPath(filePath, realpath = realpathSync) {
  const resolvedPath = path.resolve(String(filePath || ""));
  try {
    return realpath(resolvedPath);
  } catch {
    return resolvedPath;
  }
}

function isDirectCliExecution({
  argv = process.argv,
  entrypointPath = RUNNER_ENTRYPOINT,
  realpath = realpathSync
} = {}) {
  const cliPath = argv[1];
  if (!cliPath) {
    return false;
  }
  return realCliPath(cliPath, realpath) === realCliPath(entrypointPath, realpath);
}

function targetNameFromCwd(cwd = process.cwd(), platform = process.platform) {
  const targetName = platform === "win32" ? path.win32.basename(cwd) : path.basename(cwd);
  return targetName || "target";
}

function isRuntimeCliCommand(args = []) {
  return VIBE64_RUNTIME_CLI_COMMANDS.has(String(args[0] || "").trim());
}

function cliProjectSharedRoot(cwd = process.cwd()) {
  return path.join(path.resolve(cwd), ".vibe64");
}

async function readCliProjectType(cwd = process.cwd()) {
  try {
    return String(await readFile(path.join(cliProjectSharedRoot(cwd), "project_type"), "utf8")).trim();
  } catch {
    return "";
  }
}

async function readCliProjectConfig(cwd = process.cwd()) {
  const configRoot = path.join(cliProjectSharedRoot(cwd), "config");
  let entries = [];
  try {
    entries = await readdir(configRoot, {
      withFileTypes: true
    });
  } catch {
    return {};
  }
  const values = {};
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    values[entry.name] = String(await readFile(path.join(configRoot, entry.name), "utf8")).trim();
  }
  return values;
}

async function writeCliProjectConfigValue(cwd = process.cwd(), key = "", value = "") {
  const configRoot = path.join(cliProjectSharedRoot(cwd), "config");
  await mkdir(configRoot, {
    recursive: true
  });
  await writeFile(path.join(configRoot, key), `${String(value || "").trim()}\n`, "utf8");
}

function cliServiceDataRoot(cwd = process.cwd()) {
  return resolveVibe64Roots({
    runtimeProfile: CLI_LOCAL_RUNTIME_PROFILE,
    targetRoot: cwd
  }).serviceDataRoot;
}

async function cliRuntimeContext(cwd = process.cwd()) {
  const projectType = await readCliProjectType(cwd);
  if (!projectType) {
    throw new Error("No .vibe64/project_type found. Choose a Vibe64 project type first.");
  }
  const adapterRegistry = createVibe64AdapterRegistry();
  const adapter = await adapterRegistry.createAdapter(projectType);
  const values = await readCliProjectConfig(cwd);
  const projectConfig = {
    projectType,
    values
  };
  const runtimeRequirements = typeof adapter.getRuntimeRequirements === "function"
    ? await adapter.getRuntimeRequirements({
        config: projectConfig,
        projectType: {
          projectType
        },
        targetRoot: cwd
      })
    : [];
  return {
    adapter,
    projectConfig,
    projectSharedRoot: cliProjectSharedRoot(cwd),
    projectType,
    runtimeRequirements,
    targetRoot: path.resolve(cwd)
  };
}

function printRuntimeOptions(stdout = process.stdout) {
  const byRole = new Map();
  for (const entry of listRuntimePackages()) {
    if (!byRole.has(entry.role)) {
      byRole.set(entry.role, []);
    }
    byRole.get(entry.role).push(entry);
  }
  for (const [role, entries] of [...byRole.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    stdout.write(`${role}\n`);
    for (const entry of entries.sort((left, right) => left.id.localeCompare(right.id))) {
      stdout.write(`  ${entry.id} ${entry.version || "system"} (${entry.provider})\n`);
    }
  }
}

async function realizeCliRuntime(cwd = process.cwd(), stdout = process.stdout) {
  const context = await cliRuntimeContext(cwd);
  const lock = buildRuntimeLock({
    adapterId: context.adapter.id,
    projectType: context.projectType,
    runtimeRequirements: context.runtimeRequirements
  });
  await writeRuntimeLock({
    lock,
    projectSharedRoot: context.projectSharedRoot
  });
  stdout.write(`Wrote .vibe64/runtime.lock.json for ${context.runtimeRequirements.map((entry) => entry.id).join(", ") || "no runtime packages"}.\n`);
  return lock;
}

async function runtimeStatus(cwd = process.cwd(), stdout = process.stdout) {
  const context = await cliRuntimeContext(cwd);
  const lock = await readRuntimeLock({
    projectSharedRoot: context.projectSharedRoot
  });
  if (!lock) {
    stdout.write("runtime lock: missing\n");
    return 1;
  }
  const validation = validateRuntimeLock(lock, {
    adapterId: context.adapter.id,
    projectType: context.projectType,
    runtimeRequirements: context.runtimeRequirements
  });
  stdout.write(`runtime lock: ${validation.ok ? "ready" : "stale"}\n`);
  stdout.write(`packages: ${(validation.expectedPackageIds || validation.observedPackageIds || []).join(", ") || "none"}\n`);
  if (!validation.ok) {
    stdout.write(`${validation.error}\n`);
    return 1;
  }
  return 0;
}

function runCliCommand(commandArgs = [], {
  commandLabel = "",
  cwd = process.cwd(),
  spawnSyncImpl = spawnSync,
  stdout = process.stdout
} = {}) {
  function writeCommandOutput(value = "") {
    const text = String(value || "");
    if (!text) {
      return;
    }
    stdout.write(text);
    if (!text.endsWith("\n")) {
      stdout.write("\n");
    }
  }

  const [command, ...args] = commandArgs;
  const result = spawnSyncImpl(command, args, {
    cwd,
    encoding: "utf8"
  });
  stdout.write(`${commandLabel || commandArgs.join(" ")}: ${result.status === 0 ? "ok" : "failed"}\n`);
  writeCommandOutput(result.stdout);
  writeCommandOutput(result.stderr);
  return result.status === 0 ? 0 : 1;
}

async function runCliDoctor({
  cwd = process.cwd(),
  spawnSyncImpl = spawnSync,
  stdout = process.stdout
} = {}) {
  let failed = 0;
  failed += runCliCommand(["nix", "--version"], {
    cwd,
    spawnSyncImpl,
    stdout
  });
  failed += runCliCommand(["nix", "--extra-experimental-features", "nix-command flakes", "eval", "--impure", "--raw", "--expr", "builtins.currentSystem"], {
    cwd,
    spawnSyncImpl,
    stdout
  });
  try {
    const context = await cliRuntimeContext(cwd);
    for (const requirement of context.runtimeRequirements) {
      const toolId = requirement.tool?.command === "mysqld" ? "mysqld" : requirement.tool?.command || "";
      failed += runCliCommand(runtimeToolCommandArgs(requirement.id, toolId), {
        cwd,
        spawnSyncImpl,
        stdout
      });
    }
    failed += await runtimeStatus(cwd, stdout);
  } catch (error) {
    stdout.write(`project runtime: ${error.message || error}\n`);
    failed += 1;
  }
  return failed === 0 ? 0 : 1;
}

async function runRuntimeUp(cwd = process.cwd(), {
  spawnSyncImpl = spawnSync,
  stdout = process.stdout
} = {}) {
  const context = await cliRuntimeContext(cwd);
  const needsMysql = context.runtimeRequirements.some((entry) => entry.id === "mysql-8.0");
  if (!needsMysql) {
    stdout.write("No managed runtime services selected.\n");
    return 0;
  }
  return runCliCommand(jskitManagedMysqlStartCommandArgs({
    databaseName: jskitMariaDbDatabaseName(cwd),
    serviceDataRoot: cliServiceDataRoot(cwd),
    targetRoot: cwd
  }), {
    commandLabel: "managed MySQL runtime start",
    cwd,
    spawnSyncImpl,
    stdout
  });
}

async function runRuntimeDown(cwd = process.cwd(), stdout = process.stdout) {
  const result = await stopJskitManagedMysqlRuntime({
    serviceDataRoot: cliServiceDataRoot(cwd),
    stdout,
    targetRoot: cwd
  });
  return result.ok ? 0 : 1;
}

async function runRuntimeSet(args = [], cwd = process.cwd(), stdout = process.stdout) {
  const [family = "", value = ""] = args;
  if (family === "node" && value === "22") {
    stdout.write("Node runtime is fixed to Vibe64-supported Node 22.\n");
    await realizeCliRuntime(cwd, stdout);
    return 0;
  }
  if (family === "database") {
    if (value === "mysql@8.0" || value === "mysql") {
      await writeCliProjectConfigValue(cwd, "jskit_database_runtime", "mysql");
      stdout.write("Selected database runtime mysql@8.0.\n");
      await realizeCliRuntime(cwd, stdout);
      return 0;
    }
    if (value === "none") {
      await writeCliProjectConfigValue(cwd, "jskit_database_runtime", "none");
      stdout.write("Selected database runtime none.\n");
      await realizeCliRuntime(cwd, stdout);
      return 0;
    }
  }
  stdout.write("Usage: vibe64 runtime set node 22 | vibe64 runtime set database mysql@8.0 | vibe64 runtime set database none\n");
  return 1;
}

async function runRuntimeCli({
  args = process.argv.slice(2),
  cwd = process.cwd(),
  spawnSyncImpl = spawnSync,
  stdout = process.stdout
} = {}) {
  const [command = "", subcommand = "", ...rest] = args;
  if (command === "doctor") {
    return runCliDoctor({
      cwd,
      spawnSyncImpl,
      stdout
    });
  }
  if (command !== "runtime") {
    return null;
  }
  if (subcommand === "options") {
    printRuntimeOptions(stdout);
    return 0;
  }
  if (subcommand === "status") {
    return runtimeStatus(cwd, stdout);
  }
  if (subcommand === "realize") {
    await realizeCliRuntime(cwd, stdout);
    return 0;
  }
  if (subcommand === "up") {
    return runRuntimeUp(cwd, {
      spawnSyncImpl,
      stdout
    });
  }
  if (subcommand === "down") {
    return runRuntimeDown(cwd, stdout);
  }
  if (subcommand === "set") {
    return runRuntimeSet(rest, cwd, stdout);
  }
  stdout.write("Usage: vibe64 doctor | vibe64 runtime options|status|realize|up|down|set\n");
  return 1;
}

function isWslEnvironment({
  env = process.env,
  osReleaseText = osRelease(),
  platform = process.platform
} = {}) {
  if (platform !== "linux") {
    return false;
  }

  if (String(env.WSL_DISTRO_NAME || env.WSL_INTEROP || "").trim()) {
    return true;
  }

  return /\bmicrosoft\b|\bwsl\b/iu.test(String(osReleaseText || ""));
}

function serverShellCommand({
  nodePath = process.execPath,
  serverPath = SERVER_ENTRYPOINT,
  serverArgs = []
} = {}) {
  return [
    quoteShellArg(nodePath),
    quoteShellArg(serverPath),
    ...serverArgs.map((arg) => quoteShellArg(arg))
  ].join(" ");
}

function serverWindowsCommand({
  cwd = process.cwd(),
  nodePath = process.execPath,
  serverPath = SERVER_ENTRYPOINT,
  serverArgs = []
} = {}) {
  const command = [
    quoteWindowsArg(nodePath),
    quoteWindowsArg(serverPath),
    ...serverArgs.map((arg) => quoteWindowsArg(arg))
  ].join(" ");
  return [
    `cd /d ${quoteWindowsArg(cwd)}`,
    "if errorlevel 1 (set VIBE64_STATUS=!ERRORLEVEL! & echo. & echo Vibe64 could not enter the target directory. Exit status !VIBE64_STATUS!. & set /p VIBE64_PAUSE=Press Enter to close this terminal... & exit /b !VIBE64_STATUS!)",
    command,
    "if errorlevel 1 (set VIBE64_STATUS=!ERRORLEVEL! & echo. & echo Vibe64 server exited with status !VIBE64_STATUS!. & set /p VIBE64_PAUSE=Press Enter to close this terminal... & exit /b !VIBE64_STATUS!)",
    "exit /b 0"
  ].join("\r\n");
}

function terminalShellScript({
  cwd = process.cwd(),
  nodePath = process.execPath,
  serverArgs = [],
  serverPath = SERVER_ENTRYPOINT,
  title = `Vibe64 - ${path.basename(process.cwd()) || "target"}`
} = {}) {
  return [
    "finish_vibe64_terminal() {",
    "  status=\"$1\"",
    "  message=\"$2\"",
    "  if [ \"$status\" -ne 0 ]; then",
    "    printf '\\n%s Exit status %s. Press Enter to close this terminal...' \"$message\" \"$status\"",
    "    IFS= read -r _",
    "  fi",
    "  exit \"$status\"",
    "}",
    `cd ${quoteShellArg(cwd)}`,
    "status=$?",
    "if [ \"$status\" -ne 0 ]; then",
    "  finish_vibe64_terminal \"$status\" \"Vibe64 could not enter the target directory.\"",
    "fi",
    `printf '\\033]0;%s\\007' ${quoteShellArg(title)}`,
    serverShellCommand({ nodePath, serverArgs, serverPath }),
    "finish_vibe64_terminal \"$?\" \"Vibe64 server exited.\""
  ].join("\n");
}

function encodedBashScriptCommand(shellScript = "") {
  const encodedScript = Buffer.from(String(shellScript || ""), "utf8").toString("base64");
  return `printf %s ${encodedScript} | base64 -d | bash`;
}

function wslServerCommandArgs({
  distroName = "",
  shellScript = ""
} = {}) {
  const normalizedDistroName = String(distroName || "").trim();
  return [
    ...(normalizedDistroName ? ["-d", normalizedDistroName] : []),
    "--",
    "bash",
    "-lc",
    encodedBashScriptCommand(shellScript)
  ];
}

function wslTerminalLaunchCandidates({
  cwd = process.cwd(),
  env = process.env,
  shellScript = "",
  title = `Vibe64 - ${targetNameFromCwd(cwd, "linux")}`
} = {}) {
  const wslArgs = wslServerCommandArgs({
    distroName: env.WSL_DISTRO_NAME,
    shellScript
  });
  return [
    {
      command: "wt.exe",
      args: ["new-window", "--title", title, "wsl.exe", ...wslArgs]
    },
    {
      command: "cmd.exe",
      args: [
        "/d",
        "/c",
        `start ${quoteWindowsArg(title)} ${windowsCommandLine("wsl.exe", wslArgs)}`
      ]
    }
  ];
}

function terminalLaunchCandidates({
  cwd = process.cwd(),
  env = process.env,
  nodePath = process.execPath,
  osReleaseText = osRelease(),
  platform = process.platform,
  serverArgs = [],
  serverPath = SERVER_ENTRYPOINT
} = {}) {
  const title = `Vibe64 - ${targetNameFromCwd(cwd, platform)}`;
  const shellScript = terminalShellScript({
    cwd,
    nodePath,
    serverArgs,
    serverPath,
    title
  });

  if (platform === "darwin") {
    const appleScript = [
      "tell application \"Terminal\"",
      "activate",
      `do script ${quoteAppleScriptString(shellScript)}`,
      "end tell"
    ].join("\n");
    return [
      {
        command: "osascript",
        args: ["-e", appleScript]
      }
    ];
  }

  if (platform === "win32") {
    return [
      {
        command: "cmd.exe",
        args: [
          "/c",
          "start",
          title,
          "cmd.exe",
          "/v:on",
          "/c",
          serverWindowsCommand({
            cwd,
            nodePath,
            serverArgs,
            serverPath
          })
        ]
      }
    ];
  }

  const linuxCandidates = [
    env.TERMINAL
      ? {
          command: env.TERMINAL,
          args: ["-e", "bash", "-lc", shellScript]
        }
      : null,
    {
      command: "x-terminal-emulator",
      args: ["-e", "bash", "-lc", shellScript]
    },
    {
      command: "gnome-terminal",
      args: ["--", "bash", "-lc", shellScript]
    },
    {
      command: "konsole",
      args: ["-e", "bash", "-lc", shellScript]
    },
    {
      command: "xfce4-terminal",
      args: ["--command", `bash -lc ${quoteShellArg(shellScript)}`]
    },
    {
      command: "xterm",
      args: ["-e", "bash", "-lc", shellScript]
    }
  ].filter(Boolean);

  if (isWslEnvironment({ env, osReleaseText, platform })) {
    return [
      ...wslTerminalLaunchCandidates({
        cwd,
        env,
        shellScript,
        title
      }),
      ...linuxCandidates
    ];
  }

  return linuxCandidates;
}

function spawnDetached(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      detached: true,
      stdio: "ignore"
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve(child);
    });
  });
}

async function launchInNewTerminal({
  cwd = process.cwd(),
  env = process.env,
  nodePath = process.execPath,
  osReleaseText = osRelease(),
  platform = process.platform,
  serverArgs = [],
  serverPath = SERVER_ENTRYPOINT
} = {}) {
  const candidates = terminalLaunchCandidates({
    cwd,
    env,
    nodePath,
    osReleaseText,
    platform,
    serverArgs,
    serverPath
  });
  const errors = [];

  for (const candidate of candidates) {
    try {
      await spawnDetached(candidate.command, candidate.args, {
        cwd,
        env
      });
      return candidate;
    } catch (error) {
      errors.push(error);
    }
  }

  throw new AggregateError(errors, "No supported terminal emulator could be started.");
}

async function runServerInCurrentTerminal({
  cwd = process.cwd(),
  env = process.env,
  nodePath = process.execPath,
  serverArgs = [],
  serverPath = SERVER_ENTRYPOINT
} = {}) {
  const child = spawn(nodePath, [serverPath, ...serverArgs], {
    cwd,
    env,
    stdio: "inherit"
  });

  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        resolve(1);
        return;
      }
      resolve(Number(code || 0));
    });
  });
}

async function runLauncher({
  cwd = process.cwd(),
  env = process.env,
  nodePath = process.execPath,
  osReleaseText = osRelease(),
  platform = process.platform,
  serverArgs = process.argv.slice(2),
  serverPath = SERVER_ENTRYPOINT
} = {}) {
  try {
    await launchInNewTerminal({
      cwd,
      env,
      nodePath,
      osReleaseText,
      platform,
      serverArgs,
      serverPath
    });
    console.log("Vibe64 is starting in a new terminal window.");
    return 0;
  } catch (error) {
    console.warn(`${error.message} Starting Vibe64 in this terminal instead.`);
    return runServerInCurrentTerminal({
      cwd,
      env,
      nodePath,
      serverArgs,
      serverPath
    });
  }
}

if (isDirectCliExecution()) {
  const cliArgs = process.argv.slice(2);
  const runner = isRuntimeCliCommand(cliArgs)
    ? runRuntimeCli({
        args: cliArgs
      })
    : runLauncher();
  runner.then((exitCode) => {
    process.exitCode = exitCode;
  }).catch((error) => {
    console.error("Failed to run Vibe64:", error);
    process.exitCode = 1;
  });
}

export {
  SERVER_ENTRYPOINT,
  isDirectCliExecution,
  isWslEnvironment,
  isRuntimeCliCommand,
  launchInNewTerminal,
  quoteShellArg,
  runLauncher,
  runRuntimeCli,
  serverShellCommand,
  serverWindowsCommand,
  targetNameFromCwd,
  terminalLaunchCandidates,
  terminalShellScript,
  wslServerCommandArgs,
  wslTerminalLaunchCandidates
};
