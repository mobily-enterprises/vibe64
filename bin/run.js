#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { release as osRelease } from "node:os";
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

function targetNameFromCwd(cwd = process.cwd()) {
  return path.basename(cwd) || "target";
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
  title = `Vibe64 - ${targetNameFromCwd(cwd)}`
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
  const title = `Vibe64 - ${targetNameFromCwd(cwd)}`;
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

// The Node.js major in package.json's engines field ("26.x" → "26").
function requiredNodeMajor(packagePath = path.join(MODULE_DIR, "..", "package.json")) {
  try {
    return /^\D*(\d+)/u.exec(String(JSON.parse(readFileSync(packagePath, "utf8")).engines?.node || ""))?.[1] || "";
  } catch {
    return "";
  }
}

function setupGuideUrl(platform = process.platform) {
  const guide = platform === "darwin" ? "set-up-macos" : "set-up-linux";
  return `https://github.com/mobily-enterprises/vibe64/blob/main/docs/colleague-usage/${guide}.md`;
}

/**
 * Why Vibe64 cannot start here, in plain words, or "". Vibe64 runs commands
 * through a POSIX shell, so Windows uses it inside WSL2; and it needs the
 * Node.js major its package declares.
 */
function launcherProblem({
  platform = process.platform,
  nodeVersion = process.versions.node,
  requiredMajor = requiredNodeMajor()
} = {}) {
  if (platform === "win32") {
    return [
      "Vibe64 runs on Windows inside WSL2 (Ubuntu), not in PowerShell or Command Prompt.",
      "Step by step: https://github.com/mobily-enterprises/vibe64/blob/main/docs/colleague-usage/set-up-windows.md"
    ].join("\n");
  }
  const major = String(nodeVersion || "").split(".")[0];
  if (requiredMajor && major !== requiredMajor) {
    return [
      `Vibe64 needs Node.js ${requiredMajor}; this is Node.js ${nodeVersion}.`,
      `To install it with mise, run: curl -fsSL https://mise.run | sh && ~/.local/bin/mise use -g node@${requiredMajor}`,
      "Then add mise to your shell, open a new terminal and run npx vibe64 again:",
      `${setupGuideUrl(platform)}#nodejs-and-mise`
    ].join("\n");
  }
  return "";
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
  const subcommands = {
    spec: () => import("../server/lib/agentSpecCli.js").then(({ runAgentSpecCli }) => runAgentSpecCli(process.argv.slice(3))),
    training: () => import("@local/vibe64-training/server/cli").then(({ runTrainingCli }) => runTrainingCli(process.argv.slice(3)))
  };
  const problem = launcherProblem();
  if (problem) {
    console.error(problem);
    process.exit(1);
  }
  const command = Object.hasOwn(subcommands, process.argv[2]) ? subcommands[process.argv[2]]() : runLauncher();
  command.then((exitCode) => {
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
  launchInNewTerminal,
  launcherProblem,
  quoteShellArg,
  runLauncher,
  serverShellCommand,
  targetNameFromCwd,
  terminalLaunchCandidates,
  terminalShellScript,
  wslServerCommandArgs,
  wslTerminalLaunchCandidates
};
