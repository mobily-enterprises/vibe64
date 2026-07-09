import assert from "node:assert/strict";
import test from "node:test";

import {
  repairManagedSourcePermissions
} from "@local/vibe64-execution/server";

test("managed source permission repair is skipped outside hosted workspace daemons", async () => {
  const calls = [];
  const result = await repairManagedSourcePermissions(["/var/lib/vibe64/dave/projects/app"], {
    env: {},
    runHelper: async (...args) => {
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
    runHelper: async (payload, options) => {
      calls.push({
        payload,
        options
      });
      return {
        ok: true,
        output: ""
      };
    }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls.map((call) => call.options.helperPath), [
    "/tmp/vibe64-exec-helper"
  ]);
  assert.deepEqual(calls[0].payload, {
    operation: "repair-managed-project-permissions",
    path: "/var/lib/vibe64/dave/projects/app/source",
    schema: "vibe64.exec-helper.payload",
    schemaVersion: 1
  });
});
