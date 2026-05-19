#!/usr/bin/env node
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RUNNER_ENTRYPOINT = fileURLToPath(import.meta.url);
const MODULE_DIR = path.dirname(RUNNER_ENTRYPOINT);
const SERVER_ENTRYPOINT = path.join(MODULE_DIR, "server.js");

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
    "if errorlevel 1 (set AI_STUDIO_STATUS=!ERRORLEVEL! & echo. & echo AI Studio could not enter the target directory. Exit status !AI_STUDIO_STATUS!. & set /p AI_STUDIO_PAUSE=Press Enter to close this terminal... & exit /b !AI_STUDIO_STATUS!)",
    command,
    "if errorlevel 1 (set AI_STUDIO_STATUS=!ERRORLEVEL! & echo. & echo AI Studio server exited with status !AI_STUDIO_STATUS!. & set /p AI_STUDIO_PAUSE=Press Enter to close this terminal... & exit /b !AI_STUDIO_STATUS!)",
    "exit /b 0"
  ].join("\r\n");
}

function terminalShellScript({
  cwd = process.cwd(),
  nodePath = process.execPath,
  serverArgs = [],
  serverPath = SERVER_ENTRYPOINT,
  title = `AI Studio - ${path.basename(process.cwd()) || "target"}`
} = {}) {
  return [
    "finish_ai_studio_terminal() {",
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
    "  finish_ai_studio_terminal \"$status\" \"AI Studio could not enter the target directory.\"",
    "fi",
    `printf '\\033]0;%s\\007' ${quoteShellArg(title)}`,
    serverShellCommand({ nodePath, serverArgs, serverPath }),
    "finish_ai_studio_terminal \"$?\" \"AI Studio server exited.\""
  ].join("\n");
}

function terminalLaunchCandidates({
  cwd = process.cwd(),
  env = process.env,
  nodePath = process.execPath,
  platform = process.platform,
  serverArgs = [],
  serverPath = SERVER_ENTRYPOINT
} = {}) {
  const title = `AI Studio - ${targetNameFromCwd(cwd, platform)}`;
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

  const candidates = [
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
  ];
  return candidates.filter(Boolean);
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
  platform = process.platform,
  serverArgs = [],
  serverPath = SERVER_ENTRYPOINT
} = {}) {
  const candidates = terminalLaunchCandidates({
    cwd,
    env,
    nodePath,
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
  platform = process.platform,
  serverArgs = process.argv.slice(2),
  serverPath = SERVER_ENTRYPOINT
} = {}) {
  try {
    await launchInNewTerminal({
      cwd,
      env,
      nodePath,
      platform,
      serverArgs,
      serverPath
    });
    console.log("AI Studio is starting in a new terminal window.");
    return 0;
  } catch (error) {
    console.warn(`${error.message} Starting AI Studio in this terminal instead.`);
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
  runLauncher().then((exitCode) => {
    process.exitCode = exitCode;
  }).catch((error) => {
    console.error("Failed to start AI Studio:", error);
    process.exitCode = 1;
  });
}

export {
  SERVER_ENTRYPOINT,
  isDirectCliExecution,
  launchInNewTerminal,
  quoteShellArg,
  runLauncher,
  serverShellCommand,
  serverWindowsCommand,
  targetNameFromCwd,
  terminalLaunchCandidates,
  terminalShellScript
};
