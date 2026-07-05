import assert from "node:assert/strict";
import test from "node:test";

import {
  repairManagedSourcePermissions
} from "../../packages/studio-terminal-core/src/server/managedSourcePermissions.js";

test("managed source permission repair is skipped outside hosted workspace daemons", async () => {
  const calls = [];
  const result = await repairManagedSourcePermissions(["/var/lib/vibe64/dave/projects/app"], {
    env: {},
    runCommand: async (...args) => {
      calls.push(args);
      return {
        ok: true
      };
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.deepEqual(calls, []);
});

test("hosted managed source permission repair calls the narrow sudo helper operation", async () => {
  const calls = [];
  const result = await repairManagedSourcePermissions([
    "/var/lib/vibe64/dave/projects/app/source",
    "/var/lib/vibe64/dave/projects/app/source/."
  ], {
    env: {
      VIBE64_HOST_USER_EXEC_HELPER_PATH: "/tmp/vibe64-exec-helper",
      VIBE64_WORKSPACE: "dave",
      VIBE64_WORKSPACE_DAEMON_USER: "v64d_dave"
    },
    runCommand: async (command, args, options) => {
      calls.push({
        args,
        command,
        options
      });
      return {
        ok: true,
        output: ""
      };
    }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls.map((call) => [call.command, ...call.args]), [
    ["sudo", "-n", "/tmp/vibe64-exec-helper", "execute"]
  ]);
  assert.deepEqual(JSON.parse(calls[0].options.input), {
    operation: "repair-managed-project-permissions",
    path: "/var/lib/vibe64/dave/projects/app/source"
  });
});
