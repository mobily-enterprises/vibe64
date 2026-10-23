import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  isDirectCliExecution,
  isWslEnvironment,
  launcherProblem,
  quoteShellArg,
  serverShellCommand,
  serverWindowsCommand,
  targetNameFromCwd,
  terminalLaunchCandidates,
  terminalShellScript,
  wslServerCommandArgs
} from "../../bin/run.js";

test("run launcher shell quoting keeps arguments as single values", () => {
  assert.equal(quoteShellArg("plain"), "'plain'");
  assert.equal(quoteShellArg("has space"), "'has space'");
  assert.equal(quoteShellArg("can't"), "'can'\\''t'");
});

test("run launcher builds a direct server command instead of recursing through the package bin", () => {
  assert.equal(
    serverShellCommand({
      nodePath: "/usr/bin/node",
      serverPath: "/pkg/bin/server.js",
      serverArgs: ["--flag", "two words"]
    }),
    "'/usr/bin/node' '/pkg/bin/server.js' '--flag' 'two words'"
  );
});

test("run launcher treats an npm bin symlink as direct CLI execution", () => {
  const symlinkPath = "/workspace/app/node_modules/.bin/vibe64";
  const entrypointPath = "/workspace/app/node_modules/vibe64/bin/run.js";
  const realpath = (filePath) => filePath === symlinkPath ? entrypointPath : filePath;

  assert.equal(isDirectCliExecution({
    argv: ["/usr/bin/node", symlinkPath],
    entrypointPath,
    realpath
  }), true);
});

test("run launcher derives target names using the launch platform path rules", () => {
  assert.equal(targetNameFromCwd("/workspace/example-app", "linux"), "example-app");
  assert.equal(targetNameFromCwd("C:\\workspace\\example-app", "win32"), "example-app");
});

test("run launcher detects WSL only for linux WSL environments", () => {
  assert.equal(isWslEnvironment({
    env: { WSL_DISTRO_NAME: "Ubuntu" },
    osReleaseText: "6.8.0-generic",
    platform: "linux"
  }), true);
  assert.equal(isWslEnvironment({
    env: {},
    osReleaseText: "5.15.90.1-microsoft-standard-WSL2",
    platform: "linux"
  }), true);
  assert.equal(isWslEnvironment({
    env: {},
    osReleaseText: "6.8.0-generic",
    platform: "linux"
  }), false);
  assert.equal(isWslEnvironment({
    env: { WSL_DISTRO_NAME: "Ubuntu" },
    osReleaseText: "10.0.22631",
    platform: "win32"
  }), false);
});

test("run launcher opens the foreground server in a linux terminal", () => {
  const candidates = terminalLaunchCandidates({
    cwd: "/workspace/example-app",
    env: {
      TERMINAL: "custom-terminal"
    },
    nodePath: "/usr/bin/node",
    platform: "linux",
    serverArgs: ["--example"],
    serverPath: "/pkg/bin/server.js"
  });

  assert.equal(candidates[0].command, "custom-terminal");
  assert.deepEqual(candidates[0].args.slice(0, 3), ["-e", "bash", "-lc"]);
  assert.match(candidates[0].args[3], /cd '\/workspace\/example-app'/u);
  assert.match(candidates[0].args[3], /'\/usr\/bin\/node' '\/pkg\/bin\/server\.js' '--example'/u);
  assert.match(candidates[0].args[3], /finish_vibe64_terminal "\$\?" "Vibe64 server exited\."/u);
  assert.equal(candidates.some((candidate) => candidate.command === "x-terminal-emulator"), true);
});

test("run launcher opens WSL through Windows terminal before linux terminal fallbacks", () => {
  const candidates = terminalLaunchCandidates({
    cwd: "/home/merc/example-app",
    env: {
      WSL_DISTRO_NAME: "Ubuntu"
    },
    nodePath: "/usr/bin/node",
    osReleaseText: "5.15.90.1-microsoft-standard-WSL2",
    platform: "linux",
    serverArgs: ["--example"],
    serverPath: "/pkg/bin/server.js"
  });

  assert.equal(candidates[0].command, "wt.exe");
  assert.deepEqual(candidates[0].args.slice(0, 5), [
    "new-window",
    "--title",
    "Vibe64 - example-app",
    "wsl.exe",
    "-d"
  ]);
  assert.equal(candidates[0].args[5], "Ubuntu");
  assert.deepEqual(candidates[0].args.slice(6, 10), ["--", "bash", "-lc", candidates[0].args[9]]);
  assert.match(candidates[0].args[9], /^printf %s [A-Za-z0-9+/=]+ \| base64 -d \| bash$/u);

  assert.equal(candidates[1].command, "cmd.exe");
  assert.deepEqual(candidates[1].args.slice(0, 2), ["/d", "/c"]);
  assert.match(candidates[1].args[2], /^start "Vibe64 - example-app" "wsl\.exe"/u);
  assert.match(candidates[1].args[2], /"-d" "Ubuntu" "--" "bash" "-lc"/u);
  assert.equal(candidates.some((candidate) => candidate.command === "x-terminal-emulator"), true);
});

test("run launcher encodes WSL shell scripts instead of passing raw shell through Windows", () => {
  const args = wslServerCommandArgs({
    distroName: "Ubuntu",
    shellScript: "printf '\\033]0;%s\\007' 'Vibe64'\nexit 7"
  });

  assert.deepEqual(args.slice(0, 5), ["-d", "Ubuntu", "--", "bash", "-lc"]);
  assert.match(args[5], /^printf %s [A-Za-z0-9+/=]+ \| base64 -d \| bash$/u);
});

test("run launcher shell script pauses before closing after server errors", () => {
  const script = terminalShellScript({
    cwd: "/workspace/example-app",
    nodePath: "/usr/bin/node",
    serverPath: "/pkg/bin/server.js",
    title: "Vibe64 - example-app"
  });

  assert.match(script, /cd '\/workspace\/example-app'/u);
  assert.equal(script.includes("printf '\\033]0;%s\\007' 'Vibe64 - example-app'"), true);
  assert.match(script, /'\/usr\/bin\/node' '\/pkg\/bin\/server\.js'/u);
  assert.match(script, /Vibe64 server exited/u);
  assert.match(script, /IFS= read -r _/u);
  assert.doesNotMatch(script, /\bexec\b/u);
});

test("run launcher windows command pauses before closing after server errors", () => {
  const command = serverWindowsCommand({
    cwd: "C:\\workspace\\example-app",
    nodePath: "C:\\node\\node.exe",
    serverPath: "C:\\pkg\\bin\\server.js"
  });
  const candidates = terminalLaunchCandidates({
    cwd: "C:\\workspace\\example-app",
    nodePath: "C:\\node\\node.exe",
    platform: "win32",
    serverPath: "C:\\pkg\\bin\\server.js"
  });

  assert.match(command, /if errorlevel 1/u);
  assert.match(command, /Vibe64 server exited with status !VIBE64_STATUS!/u);
  assert.match(command, /set \/p VIBE64_PAUSE=Press Enter to close this terminal/u);
  assert.match(command, /exit \/b !VIBE64_STATUS!/u);
  assert.deepEqual(candidates[0].args.slice(0, 7), [
    "/c",
    "start",
    "Vibe64 - example-app",
    "cmd.exe",
    "/v:on",
    "/c",
    command
  ]);
});

test("run launcher shell script preserves failed server output until enter", () => {
  const script = terminalShellScript({
    cwd: "/tmp",
    nodePath: "/bin/sh",
    serverArgs: ["printf 'server failed\\n' >&2; exit 7"],
    serverPath: "-c",
    title: "Vibe64 - failing-app"
  });

  const result = spawnSync("bash", ["-lc", script], {
    encoding: "utf8",
    input: "\n"
  });

  assert.equal(result.status, 7);
  assert.match(result.stderr, /server failed/u);
  assert.match(result.stdout, /Vibe64 server exited\. Exit status 7\. Press Enter to close this terminal/u);
});

test("run launcher stops with plain words on Windows and on the wrong Node.js", () => {
  const windows = launcherProblem({ platform: "win32", nodeVersion: "26.1.0", requiredMajor: "26" });
  assert.match(windows, /^Vibe64 runs on Windows inside WSL2/u);
  assert.match(windows, /docs\/colleague-usage\/set-up-windows\.md$/u);
  const old = launcherProblem({ platform: "linux", nodeVersion: "24.22.1", requiredMajor: "26" });
  assert.match(old, /^Vibe64 needs Node\.js 26; this is Node\.js 24\.22\.1\./u);
  assert.match(old, /curl -fsSL https:\/\/mise\.run \| sh && ~\/\.local\/bin\/mise use -g node@26/u);
  assert.match(old, /set-up-linux\.md#nodejs-and-mise$/u);
  assert.match(launcherProblem({ platform: "darwin", nodeVersion: "24.1.0", requiredMajor: "26" }), /set-up-macos\.md#nodejs-and-mise$/u);
  assert.equal(launcherProblem({ platform: "darwin", nodeVersion: "26.12.1", requiredMajor: "26" }), "");
  assert.equal(launcherProblem({ platform: "linux", nodeVersion: "26.0.0" }), "", "this package declares Node.js 26");
});
