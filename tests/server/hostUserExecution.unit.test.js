import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  HOST_USER_EXECUTION_DIRECT,
  HOST_USER_EXECUTION_HELPER,
  hostUserExecutionMode,
  realUserHomeEnv,
  runHostUserCommand
} from "../../packages/studio-terminal-core/src/server/hostUserExecution.js";

function currentUid() {
  return typeof process.getuid === "function" ? process.getuid() : 1000;
}

function currentGid() {
  return typeof process.getgid === "function" ? process.getgid() : 1000;
}

test("host user execution runs directly for the current OS user", async () => {
  const calls = [];
  const result = await runHostUserCommand("gh", ["api", "user"], {
    cwd: "/var/lib/vibe64/owner/projects/app",
    gid: currentGid(),
    home: "/home/owner",
    input: "direct-input",
    operation: "github-host-command",
    runCommand: async (command, args, options) => {
      calls.push({
        args,
        command,
        options
      });
      return {
        ok: true,
        output: "ok"
      };
    },
    uid: currentUid(),
    username: "owner"
  });

  assert.equal(result.ok, true);
  assert.equal(hostUserExecutionMode({
    gid: currentGid(),
    uid: currentUid()
  }).executionMode, HOST_USER_EXECUTION_DIRECT);
  assert.equal(calls[0].command, "gh");
  assert.deepEqual(calls[0].args, ["api", "user"]);
  assert.equal(calls[0].options.cwd, "/var/lib/vibe64/owner/projects/app");
  assert.equal(calls[0].options.env.HOME, "/home/owner");
  assert.equal(calls[0].options.input, "direct-input");
  assert.equal(calls[0].options.env.XDG_CONFIG_HOME, path.join("/home/owner", ".config"));
});

test("host user execution does not invent a credential home", () => {
  const env = realUserHomeEnv({
    env: {
      PATH: "/usr/bin"
    },
    home: "",
    username: "owner"
  });

  assert.equal(env.PATH, "/usr/bin");
  assert.equal(env.USER, "owner");
  assert.equal(env.HOME, undefined);
  assert.equal(env.XDG_CONFIG_HOME, undefined);
});

test("host user execution uses the helper for a different OS user", async () => {
  const calls = [];
  const result = await runHostUserCommand("gh", ["api", "user"], {
    gid: currentGid() + 1,
    helperPath: "/tmp/vibe64-exec-helper",
    home: "/home/member",
    input: Buffer.from("helper-input"),
    operation: "github-host-command",
    runCommand: async (command, args, options) => {
      calls.push({
        args,
        command,
        options
      });
      return {
        ok: true,
        output: "helper"
      };
    },
    uid: currentUid() + 1,
    username: "member"
  });

  assert.equal(result.ok, true);
  assert.equal(hostUserExecutionMode({
    gid: currentGid() + 1,
    uid: currentUid() + 1
  }).executionMode, HOST_USER_EXECUTION_HELPER);
  assert.equal(calls[0].command, "sudo");
  assert.deepEqual(calls[0].args, ["-n", "/tmp/vibe64-exec-helper", "execute"]);
  const payload = JSON.parse(calls[0].options.input);
  assert.equal(payload.command, "gh");
  assert.deepEqual(payload.args, ["api", "user"]);
  assert.equal(payload.home, "/home/member");
  assert.equal(Buffer.from(payload.inputBase64, "base64").toString("utf8"), "helper-input");
  assert.equal(payload.operation, "github-host-command");
  assert.equal(payload.username, "member");
  assert.equal(payload.env.HOME, "/home/member");
});
