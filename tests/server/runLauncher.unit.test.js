import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  isDirectCliExecution,
  quoteShellArg,
  serverShellCommand,
  serverWindowsCommand,
  targetNameFromCwd,
  terminalLaunchCandidates,
  terminalShellScript
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
  const symlinkPath = "/workspace/app/node_modules/.bin/ai-studio";
  const entrypointPath = "/workspace/app/node_modules/@vibe-armor/run/bin/run.js";
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
  assert.match(candidates[0].args[3], /finish_ai_studio_terminal "\$\?" "AI Studio server exited\."/u);
  assert.equal(candidates.some((candidate) => candidate.command === "x-terminal-emulator"), true);
});

test("run launcher shell script pauses before closing after server errors", () => {
  const script = terminalShellScript({
    cwd: "/workspace/example-app",
    nodePath: "/usr/bin/node",
    serverPath: "/pkg/bin/server.js",
    title: "AI Studio - example-app"
  });

  assert.match(script, /cd '\/workspace\/example-app'/u);
  assert.equal(script.includes("printf '\\033]0;%s\\007' 'AI Studio - example-app'"), true);
  assert.match(script, /'\/usr\/bin\/node' '\/pkg\/bin\/server\.js'/u);
  assert.match(script, /AI Studio server exited/u);
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
  assert.match(command, /AI Studio server exited with status !AI_STUDIO_STATUS!/u);
  assert.match(command, /set \/p AI_STUDIO_PAUSE=Press Enter to close this terminal/u);
  assert.match(command, /exit \/b !AI_STUDIO_STATUS!/u);
  assert.deepEqual(candidates[0].args.slice(0, 7), [
    "/c",
    "start",
    "AI Studio - example-app",
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
    title: "AI Studio - failing-app"
  });

  const result = spawnSync("bash", ["-lc", script], {
    encoding: "utf8",
    input: "\n"
  });

  assert.equal(result.status, 7);
  assert.match(result.stderr, /server failed/u);
  assert.match(result.stdout, /AI Studio server exited\. Exit status 7\. Press Enter to close this terminal/u);
});
