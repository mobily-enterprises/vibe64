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

test("workflow driver records the first owner and rebinds the same user after reload", async () => {
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

  const rebound = await claimSessionWorkflowDriver(runtime, "session-1", {
    originId: "tab-tony-reloaded",
    reason: "session-advance",
    vibe64User: {
      email: "tonymobily@gmail.com"
    }
  });

  assert.equal(rebound.claimed, true);
  assert.equal(rebound.rebound, true);
  assert.equal(rebound.previousOriginId, "tab-tony");
  assert.equal(metadata.workflow_driver_origin_id, "tab-tony-reloaded");
  assert.equal(metadata.workflow_driver_email, "tonymobily@gmail.com");
  assert.equal(workflowDriverFromSession(rebound.session).originId, "tab-tony-reloaded");
});

test("workflow driver lets another authenticated tenant member rebind the browser origin", async () => {
  const {
    metadata,
    runtime
  } = createWorkflowDriverRuntime();

  await claimSessionWorkflowDriver(runtime, "session-1", {
    originId: "tab-tony",
    reason: "session-create",
    vibe64User: {
      email: "tonymobily@gmail.com"
    }
  });

  const result = await claimSessionWorkflowDriver(runtime, "session-1", {
    originId: "tab-dave",
    reason: "session-advance",
    vibe64User: {
      email: "dave.guard@gmail.com"
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.rebound, true);
  assert.equal(result.previousOriginId, "tab-tony");
  assert.equal(metadata.workflow_driver_origin_id, "tab-dave");
  assert.equal(metadata.workflow_driver_email, "dave.guard@gmail.com");
  assert.equal(metadata.workflow_driver_user_key, "dave.guard@gmail.com");
});

test("workflow driver lets another authenticated tenant member use the same origin", async () => {
  const {
    metadata,
    runtime
  } = createWorkflowDriverRuntime();

  await claimSessionWorkflowDriver(runtime, "session-1", {
    originId: "tab-tony",
    reason: "session-create",
    vibe64User: {
      email: "tonymobily@gmail.com"
    }
  });

  const result = await claimSessionWorkflowDriver(runtime, "session-1", {
    originId: "tab-tony",
    reason: "session-advance",
    vibe64User: {
      email: "dave.guard@gmail.com"
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.rebound, false);
  assert.equal(metadata.workflow_driver_origin_id, "tab-tony");
  assert.equal(metadata.workflow_driver_email, "dave.guard@gmail.com");
  assert.equal(metadata.workflow_driver_user_key, "dave.guard@gmail.com");
});

test("workflow driver lets authenticated users rebind legacy ownerless origins", async () => {
  const {
    metadata,
    runtime
  } = createWorkflowDriverRuntime();

  metadata.workflow_driver_origin_id = "tab-unknown-owner";

  const result = await claimSessionWorkflowDriver(runtime, "session-1", {
    originId: "tab-tony",
    reason: "session-advance",
    vibe64User: {
      email: "tonymobily@gmail.com"
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.rebound, true);
  assert.equal(result.previousOriginId, "tab-unknown-owner");
  assert.equal(metadata.workflow_driver_origin_id, "tab-tony");
  assert.equal(metadata.workflow_driver_email, "tonymobily@gmail.com");
  assert.equal(metadata.workflow_driver_user_key, "tonymobily@gmail.com");
});

test("workflow driver preserves an existing owner when same-origin calls omit a user", async () => {
  const {
    metadata,
    runtime
  } = createWorkflowDriverRuntime();

  await claimSessionWorkflowDriver(runtime, "session-1", {
    originId: "tab-tony",
    reason: "session-create",
    vibe64User: {
      email: "tonymobily@gmail.com"
    }
  });
  const sameOrigin = await claimSessionWorkflowDriver(runtime, "session-1", {
    originId: "tab-tony",
    reason: "internal-refresh"
  });

  assert.equal(sameOrigin.rebound, false);
  assert.equal(metadata.workflow_driver_origin_id, "tab-tony");
  assert.equal(metadata.workflow_driver_email, "tonymobily@gmail.com");
  assert.equal(metadata.workflow_driver_user_key, "tonymobily@gmail.com");
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
