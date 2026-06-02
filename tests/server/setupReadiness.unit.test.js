import assert from "node:assert/strict";
import test from "node:test";

import {
  readVibe64WorkspaceReadiness,
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
    adapterSetupService: serviceReady(),
    projectSetupService: serviceReady(),
    studioSetupService: serviceReady()
  });

  assert.equal(readiness.ready, true);
  assert.deepEqual(readiness.stages.map((stage) => stage.id), [
    "studio-setup",
    "adapter-setup",
    "project-setup"
  ]);
});

test("setup readiness reports Studio Setup as the first blocked automatic setup stage", async () => {
  const readiness = await readVibe64SetupReadiness({
    accountSetupService: serviceBlocked("Accounts missing."),
    adapterSetupService: serviceReady(),
    projectSetupService: serviceReady(),
    studioSetupService: serviceBlocked("Studio missing.")
  });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.currentStage.id, "studio-setup");
  assert.equal(readiness.message, "Studio missing.");
  assert.deepEqual(readiness.stages.map((stage) => stage.id), ["studio-setup"]);
});

test("workspace readiness checks human connections before automatic setup", async () => {
  const readiness = await readVibe64WorkspaceReadiness({
    accountSetupService: serviceBlocked("Accounts missing."),
    adapterSetupService: serviceReady(),
    projectSetupService: serviceReady(),
    studioSetupService: serviceBlocked("Studio missing.")
  });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.currentStage.id, "accounts");
  assert.equal(readiness.message, "Accounts missing.");
  assert.deepEqual(readiness.stages.map((stage) => stage.id), ["accounts"]);
});
