import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSessionWorkflowDriverOrigin,
  claimSessionWorkflowDriver,
  workflowDriverFromSession
} from "@local/vibe64-core/server/sessionWorkflowDriver";

function createWorkflowDriverRuntime() {
  const metadata = {};
  return {
    metadata,
    runtime: {
      async getSession(sessionId) {
        return {
          metadata: {
            ...metadata
          },
          sessionId
        };
      },
      store: {
        async mutateSession(_sessionId, operation) {
          return operation();
        },
        async writeMetadataValue(_sessionId, name, value) {
          metadata[name] = String(value || "");
        }
      }
    }
  };
}

test("workflow driver requires an explicit browser tab origin", () => {
  assert.throws(
    () => assertSessionWorkflowDriverOrigin(""),
    {
      code: "vibe64_workflow_driver_origin_required",
      statusCode: 400
    }
  );
});

test("workflow driver records the first owner and rejects another browser tab", async () => {
  const {
    metadata,
    runtime
  } = createWorkflowDriverRuntime();

  const first = await claimSessionWorkflowDriver(runtime, "session-1", {
    originId: "tab-tony",
    reason: "session-create",
    vibe64User: {
      email: "tonymobily@gmail.com"
    }
  });
  const second = await claimSessionWorkflowDriver(runtime, "session-1", {
    originId: "tab-tony",
    reason: "session-advance",
    vibe64User: {
      email: "tonymobily@gmail.com"
    }
  });

  assert.equal(first.claimed, true);
  assert.equal(second.claimed, true);
  assert.equal(metadata.workflow_driver_origin_id, "tab-tony");
  assert.equal(metadata.workflow_driver_email, "tonymobily@gmail.com");
  assert.equal(workflowDriverFromSession(second.session).originId, "tab-tony");

  await assert.rejects(
    () => claimSessionWorkflowDriver(runtime, "session-1", {
      originId: "tab-dave",
      reason: "session-advance",
      vibe64User: {
        email: "dave.guard@gmail.com"
      }
    }),
    {
      code: "vibe64_workflow_driver_origin_mismatch",
      requestedOriginId: "tab-dave",
      statusCode: 409,
      workflowDriverOriginId: "tab-tony"
    }
  );
  assert.equal(metadata.workflow_driver_origin_id, "tab-tony");
  assert.equal(metadata.workflow_driver_email, "tonymobily@gmail.com");
});

test("workflow driver requires real session metadata storage", async () => {
  await assert.rejects(
    () => claimSessionWorkflowDriver({
      async getSession(sessionId) {
        return {
          sessionId
        };
      }
    }, "session-1", {
      originId: "tab-tony"
    }),
    {
      code: "vibe64_workflow_driver_store_required",
      statusCode: 500
    }
  );
});
