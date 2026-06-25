import assert from "node:assert/strict";
import test from "node:test";

import {
  readVibe64CapabilitySetupReadiness,
  readVibe64ProjectReadiness,
  readVibe64SessionReadiness,
  readVibe64SetupReadiness
} from "../../packages/vibe64-runtime/src/server/setupReadiness.js";

function serviceReady() {
  return {
    async getStatus() {
      return {
        ready: true
      };
    }
  };
}

function serviceBlocked(blockedReason = "") {
  return {
    async getStatus() {
      return {
        blockedReason,
        ready: false
      };
    }
  };
}

test("setup readiness checks automatic setup stages only", async () => {
  const readiness = await readVibe64SetupReadiness({
    connectionSetupService: serviceReady(),
    projectSetupService: serviceReady(),
    studioSetupService: serviceReady()
  });

  assert.equal(readiness.ready, true);
  assert.deepEqual(readiness.stages.map((stage) => stage.id), [
    "studio-setup",
    "project-setup"
  ]);
});

test("setup readiness reports Studio Setup as the first blocked automatic setup stage", async () => {
  const readiness = await readVibe64SetupReadiness({
    connectionSetupService: serviceBlocked("Connections missing."),
    projectSetupService: serviceReady(),
    studioSetupService: serviceBlocked("Studio missing.")
  });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.currentStage.id, "studio-setup");
  assert.equal(readiness.message, "Studio missing.");
  assert.deepEqual(readiness.stages.map((stage) => stage.id), ["studio-setup"]);
});

test("capability setup readiness skips uncached Project Setup without running diagnostics", async () => {
  let fullProjectSetupCalls = 0;
  const readiness = await readVibe64CapabilitySetupReadiness({
    projectSetupService: {
      async getStatus() {
        fullProjectSetupCalls += 1;
        throw new Error("Project Setup diagnostics should not run for capabilities.");
      }
    },
    studioSetupService: serviceReady()
  });

  assert.equal(readiness.ready, true);
  assert.equal(fullProjectSetupCalls, 0);
  assert.deepEqual(readiness.stages.map((stage) => stage.id), [
    "studio-setup",
    "project-setup"
  ]);
  assert.equal(readiness.stages[1].skipped, true);
});

test("capability setup readiness reuses cached Project Setup blockers", async () => {
  const readiness = await readVibe64CapabilitySetupReadiness({
    projectSetupService: {
      async getStatus() {
        throw new Error("Project Setup diagnostics should not run for capabilities.");
      },
      async getCachedStatus() {
        return {
          ready: false,
          stages: [
            {
              id: "dependencies",
              label: "Dependencies runnable",
              observed: "node_modules is missing.",
              status: "blocked"
            }
          ]
        };
      }
    },
    studioSetupService: serviceReady()
  });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.currentStage.id, "project-setup");
  assert.equal(readiness.message, "Dependencies runnable: node_modules is missing.");
  assert.equal(readiness.stages[1].cached, true);
});

test("project readiness checks human connections before automatic setup", async () => {
  const readiness = await readVibe64ProjectReadiness({
    connectionSetupService: serviceBlocked("Connections missing."),
    projectSetupService: serviceReady(),
    studioSetupService: serviceBlocked("Studio missing.")
  });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.currentStage.id, "connections");
  assert.equal(readiness.message, "Connections missing.");
  assert.deepEqual(readiness.stages.map((stage) => stage.id), ["connections"]);
});

test("project readiness forwards status input to every setup service", async () => {
  const seen = [];
  const service = (id) => ({
    async getStatus(input) {
      seen.push({
        id,
        input
      });
      return {
        ready: true
      };
    }
  });
  const input = {
    vibe64User: {
      email: "owner@example.com"
    }
  };

  const readiness = await readVibe64ProjectReadiness({
    connectionSetupService: service("connections"),
    projectSetupService: service("project-setup"),
    studioSetupService: service("studio-setup")
  }, {
    input
  });

  assert.equal(readiness.ready, true);
  assert.deepEqual(seen, [
    {
      id: "connections",
      input
    },
    {
      id: "studio-setup",
      input
    },
    {
      id: "project-setup",
      input
    }
  ]);
});

test("session readiness excludes project setup diagnostics", async () => {
  const seen = [];
  const service = (id) => ({
    async getStatus(input) {
      seen.push({
        id,
        input
      });
      return {
        ready: true
      };
    }
  });
  const input = {
    vibe64User: {
      email: "owner@example.com"
    }
  };

  const readiness = await readVibe64SessionReadiness({
    connectionSetupService: service("connections"),
    projectSetupService: {
      async getStatus() {
        throw new Error("Project setup should not gate session readiness.");
      }
    },
    studioSetupService: service("studio-setup")
  }, {
    input
  });

  assert.equal(readiness.ready, true);
  assert.deepEqual(readiness.stages.map((stage) => stage.id), [
    "connections",
    "studio-setup"
  ]);
  assert.deepEqual(seen, [
    {
      id: "connections",
      input
    },
    {
      id: "studio-setup",
      input
    }
  ]);
});

test("setup readiness message names the blocked nested project check", async () => {
  const readiness = await readVibe64SetupReadiness({
    projectSetupService: {
      async getStatus() {
        return {
          ready: false,
          stages: [
            {
              id: "directory",
              label: "Directory",
              status: "pass"
            },
            {
              id: "remote-ready",
              label: "Remote ready",
              observed: "GitHub CLI is not authenticated.",
              status: "hard-stop"
            }
          ]
        };
      }
    },
    studioSetupService: serviceReady()
  });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.currentStage.id, "project-setup");
  assert.equal(readiness.message, "Remote ready: GitHub CLI is not authenticated.");
});
