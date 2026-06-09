import assert from "node:assert/strict";
import test from "node:test";

import {
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
    accountSetupService: serviceReady(),
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
    accountSetupService: serviceBlocked("Accounts missing."),
    projectSetupService: serviceReady(),
    studioSetupService: serviceBlocked("Studio missing.")
  });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.currentStage.id, "studio-setup");
  assert.equal(readiness.message, "Studio missing.");
  assert.deepEqual(readiness.stages.map((stage) => stage.id), ["studio-setup"]);
});

test("project readiness checks human connections before automatic setup", async () => {
  const readiness = await readVibe64ProjectReadiness({
    accountSetupService: serviceBlocked("Accounts missing."),
    projectSetupService: serviceReady(),
    studioSetupService: serviceBlocked("Studio missing.")
  });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.currentStage.id, "accounts");
  assert.equal(readiness.message, "Accounts missing.");
  assert.deepEqual(readiness.stages.map((stage) => stage.id), ["accounts"]);
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
    accountSetupService: service("accounts"),
    projectSetupService: service("project-setup"),
    studioSetupService: service("studio-setup")
  }, {
    input
  });

  assert.equal(readiness.ready, true);
  assert.deepEqual(seen, [
    {
      id: "accounts",
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
    accountSetupService: service("accounts"),
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
    "accounts",
    "studio-setup"
  ]);
  assert.deepEqual(seen, [
    {
      id: "accounts",
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
