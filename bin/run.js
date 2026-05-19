#!/usr/bin/env node
import { spawn } from "node:child_process";
import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
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
  return [
    `cd /d ${quoteWindowsArg(cwd)}`,
    [
      quoteWindowsArg(nodePath),
      quoteWindowsArg(serverPath),
      ...serverArgs.map((arg) => quoteWindowsArg(arg))
    ].join(" ")
  ].join(" && ");
}

function terminalShellScript({
  cwd = process.cwd(),
  nodePath = process.execPath,
  serverArgs = [],
  serverPath = SERVER_ENTRYPOINT,
  title = `AI Studio - ${path.basename(process.cwd()) || "target"}`
} = {}) {
  return [
    `cd ${quoteShellArg(cwd)}`,
    `printf '\\033]0;%s\\007' ${quoteShellArg(title)}`,
    `exec ${serverShellCommand({ nodePath, serverArgs, serverPath })}`
  ].join(" && ");
}

function terminalLaunchCandidates({
  cwd = process.cwd(),
  env = process.env,
  nodePath = process.execPath,
  platform = process.platform,
  serverArgs = [],
  serverPath = SERVER_ENTRYPOINT
} = {}) {
  const title = `AI Studio - ${path.basename(cwd) || "target"}`;
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runLauncher().then((exitCode) => {
    process.exitCode = exitCode;
  }).catch((error) => {
    console.error("Failed to start AI Studio:", error);
    process.exitCode = 1;
  });
}

export {
  SERVER_ENTRYPOINT,
  launchInNewTerminal,
  quoteShellArg,
  runLauncher,
  serverShellCommand,
  terminalLaunchCandidates,
  terminalShellScript
};
