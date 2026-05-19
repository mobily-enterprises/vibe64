import assert from "node:assert/strict";
import test from "node:test";

import {
  quoteShellArg,
  serverShellCommand,
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
  assert.match(candidates[0].args[3], /exec '\/usr\/bin\/node' '\/pkg\/bin\/server\.js' '--example'/u);
  assert.equal(candidates.some((candidate) => candidate.command === "x-terminal-emulator"), true);
});

test("run launcher shell script uses exec so the terminal owns the server process", () => {
  const script = terminalShellScript({
    cwd: "/workspace/example-app",
    nodePath: "/usr/bin/node",
    serverPath: "/pkg/bin/server.js",
    title: "AI Studio - example-app"
  });

  assert.match(script, /^cd '\/workspace\/example-app' &&/u);
  assert.equal(script.includes("printf '\\033]0;%s\\007' 'AI Studio - example-app'"), true);
  assert.match(script, /&& exec '\/usr\/bin\/node' '\/pkg\/bin\/server\.js'$/u);
});
