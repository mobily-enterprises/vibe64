import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  isDirectCliExecution,
  isRuntimeCliCommand,
  isWslEnvironment,
  quoteShellArg,
  runRuntimeCli,
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

test("run launcher detects runtime CLI subcommands", () => {
  assert.equal(isRuntimeCliCommand(["doctor"]), true);
  assert.equal(isRuntimeCliCommand(["runtime", "status"]), true);
  assert.equal(isRuntimeCliCommand(["--project", "."]), false);
});

test("runtime CLI realizes and validates the source-owned lock", async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "v64-runtime-cli-"));
  const output = [];
  const stdout = {
    write(value) {
      output.push(String(value));
    }
  };
  try {
    await mkdir(path.join(targetRoot, ".vibe64", "config"), {
      recursive: true
    });
    await writeFile(path.join(targetRoot, ".vibe64", "project_type"), "jskit\n", "utf8");
    await writeFile(path.join(targetRoot, ".vibe64", "config", "jskit_database_runtime"), "mysql\n", "utf8");

    assert.equal(await runRuntimeCli({
      args: ["runtime", "realize"],
      cwd: targetRoot,
      stdout
    }), 0);
    const lock = JSON.parse(await readFile(path.join(targetRoot, ".vibe64", "runtime.lock.json"), "utf8"));
    assert.deepEqual(lock.selected.services.map((entry) => entry.id), ["mysql-8.0"]);

    assert.equal(await runRuntimeCli({
      args: ["runtime", "status"],
      cwd: targetRoot,
      stdout
    }), 0);
    assert.match(output.join(""), /runtime lock: ready/u);
  } finally {
    await rm(targetRoot, {
      force: true,
      recursive: true
    });
  }
});

test("runtime CLI set writes the shared JSKIT database config", async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "v64-runtime-cli-set-"));
  const stdout = {
    write() {}
  };
  try {
    await mkdir(path.join(targetRoot, ".vibe64"), {
      recursive: true
    });
    await writeFile(path.join(targetRoot, ".vibe64", "project_type"), "jskit\n", "utf8");

    assert.equal(await runRuntimeCli({
      args: ["runtime", "set", "database", "none"],
      cwd: targetRoot,
      stdout
    }), 0);
    assert.equal(await readFile(path.join(targetRoot, ".vibe64", "config", "jskit_database_runtime"), "utf8"), "none\n");
    const lock = JSON.parse(await readFile(path.join(targetRoot, ".vibe64", "runtime.lock.json"), "utf8"));
    assert.deepEqual(lock.selected.services, []);
  } finally {
    await rm(targetRoot, {
      force: true,
      recursive: true
    });
  }
});

test("runtime CLI doctor uses Nix commands and project lock validation", async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "v64-runtime-cli-doctor-"));
  const calls = [];
  const stdout = {
    write() {}
  };
  try {
    await mkdir(path.join(targetRoot, ".vibe64", "config"), {
      recursive: true
    });
    await writeFile(path.join(targetRoot, ".vibe64", "project_type"), "jskit\n", "utf8");
    await writeFile(path.join(targetRoot, ".vibe64", "config", "jskit_database_runtime"), "none\n", "utf8");
    await runRuntimeCli({
      args: ["runtime", "realize"],
      cwd: targetRoot,
      stdout
    });

    const status = await runRuntimeCli({
      args: ["doctor"],
      cwd: targetRoot,
      spawnSyncImpl(command, args) {
        calls.push([command, ...args]);
        return {
          status: 0,
          stderr: "",
          stdout: command === "nix" && args.includes("--version") ? "nix (Nix) 2.18.1\n" : "ok\n"
        };
      },
      stdout
    });
    assert.equal(status, 0);
    assert.ok(calls.some((call) => call.includes("eval")));
    assert.ok(calls.some((call) => call.some((arg) => String(arg).includes("#nodejs_22"))));
  } finally {
    await rm(targetRoot, {
      force: true,
      recursive: true
    });
  }
});

test("runtime CLI up does not print generated MySQL script secrets", async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "v64-runtime-cli-up-"));
  const output = [];
  const calls = [];
  const stdout = {
    write(value) {
      output.push(String(value));
    }
  };
  try {
    await mkdir(path.join(targetRoot, ".vibe64", "config"), {
      recursive: true
    });
    await writeFile(path.join(targetRoot, ".vibe64", "project_type"), "jskit\n", "utf8");
    await writeFile(path.join(targetRoot, ".vibe64", "config", "jskit_database_runtime"), "mysql\n", "utf8");

    const status = await runRuntimeCli({
      args: ["runtime", "up"],
      cwd: targetRoot,
      spawnSyncImpl(command, args) {
        calls.push([command, ...args]);
        return {
          status: 0,
          stderr: "",
          stdout: "[studio] JSKIT MySQL is ready.\n"
        };
      },
      stdout
    });

    const text = output.join("");
    assert.equal(status, 0);
    assert.match(text, /managed MySQL runtime start: ok/u);
    assert.doesNotMatch(text, /vibe64_jskit_root/u);
    assert.doesNotMatch(text, /app_password/u);
    assert.doesNotMatch(text, /grant_sql/u);
    const commandText = calls.flat().map((arg) => String(arg)).join("\n");
    assert.match(commandText, /\/services\/mysql-8\.0/u);
    assert.doesNotMatch(commandText, /\.vibe64-demon\/services\/mysql-8\.0/u);
  } finally {
    await rm(targetRoot, {
      force: true,
      recursive: true
    });
  }
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
