import assert from "node:assert/strict";
import test from "node:test";

import {
  runDefaultGithubToolchain
} from "../../server/lib/githubProjectService.js";

test("GitHub project toolchain prepares the target runtime network before Docker", async () => {
  const calls = [];
  const targetRoot = "/workspace/new-project";

  const result = await runDefaultGithubToolchain(["git", "init", "-b", "main"], {
    ensureRuntimeNetwork: async (receivedTargetRoot) => {
      calls.push({
        targetRoot: receivedTargetRoot,
        type: "network"
      });
    },
    runCommand: async (command, args, options) => {
      calls.push({
        args,
        command,
        options,
        type: "docker"
      });
      return {
        ok: true,
        output: ""
      };
    },
    targetRoot,
    timeout: 12_345,
    toolHomeSource: "/tmp/vibe64-gh-home"
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], {
    targetRoot,
    type: "network"
  });
  assert.equal(calls[1].type, "docker");
  assert.equal(calls[1].command, "docker");
  assert.deepEqual(calls[1].options, {
    timeout: 12_345
  });
  assert.ok(calls[1].args.includes("--network"));
  assert.ok(calls[1].args.includes("-v"));
  assert.ok(calls[1].args.includes(`${targetRoot}:/workspace`));
  assert.ok(calls[1].args.indexOf("--network") < calls[1].args.indexOf("ghcr.io/mobily-enterprises/vibe64-base-toolchain:0.1.0"));
});
