import assert from "node:assert/strict";
import test from "node:test";

import {
  VIBE64_CONNECTION_PURPOSE_SESSION
} from "../../packages/vibe64-runtime/src/server/connectionReadiness.js";
import {
  normalizeSetupOptions,
  runtimeProfileRequiresStudioSetup,
  readVibe64CapabilitySetupReadiness,
  readVibe64ProjectReadiness,
  readVibe64SessionReadiness,
  readVibe64StudioReadiness,
  readVibe64SetupReadiness,
  setupOptionsForRuntimeProfile
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

test("setup readiness can omit Studio Setup for composed runtimes", async () => {
  let studioSetupCalls = 0;
  const readiness = await readVibe64SetupReadiness({
    projectSetupService: serviceReady(),
    studioSetupService: {
      async getStatus() {
        studioSetupCalls += 1;
        throw new Error("Studio Setup should not run.");
      }
    }
  }, {
    includeStudioSetup: false
  });

  assert.equal(readiness.ready, true);
  assert.equal(studioSetupCalls, 0);
  assert.deepEqual(readiness.stages.map((stage) => stage.id), ["project-setup"]);
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

test("connection readiness preserves the service error that blocked delivery", async () => {
  const readiness = await readVibe64SessionReadiness({
    connectionSetupService: {
      async getStatus() {
        return {
          code: "vibe64_os_user_required",
          error: "A Vibe64 OS username and real home are required for GitHub operations.",
          ok: false,
          ready: false
        };
      }
    }
  }, {
    includeStudioSetup: false
  });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.currentStage.id, "connections");
  assert.equal(
    readiness.message,
    "A Vibe64 OS username and real home are required for GitHub operations."
  );
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
      input: {
        ...input,
        connectionPurpose: VIBE64_CONNECTION_PURPOSE_SESSION,
        providerIds: ["codex"]
      }
    },
    {
      id: "studio-setup",
      input
    }
  ]);
});

test("session readiness does not let GitHub status block a Codex conversation", async () => {
  let connectionInput = null;
  const readiness = await readVibe64SessionReadiness({
    connectionSetupService: {
      async getStatus(input = {}) {
        connectionInput = input;
        const githubRequested = input.providerIds.includes("github");
        return {
          blockedReason: githubRequested ? "GitHub rejected the saved login." : "",
          ready: !githubRequested
        };
      }
    }
  }, {
    includeStudioSetup: false,
    input: {
      providerIds: ["codex", "github"],
      vibe64User: {
        github: {
          login: "ada"
        }
      }
    }
  });

  assert.equal(readiness.ready, true);
  assert.deepEqual(connectionInput.providerIds, ["codex"]);
});

test("session readiness can omit Studio Setup for composed runtimes", async () => {
  let studioSetupCalls = 0;
  const readiness = await readVibe64SessionReadiness({
    connectionSetupService: serviceReady(),
    studioSetupService: {
      async getStatus() {
        studioSetupCalls += 1;
        throw new Error("Studio Setup should not run.");
      }
    }
  }, {
    includeStudioSetup: false
  });

  assert.equal(readiness.ready, true);
  assert.equal(studioSetupCalls, 0);
  assert.deepEqual(readiness.stages.map((stage) => stage.id), ["connections"]);
});

test("Studio readiness is already satisfied when Studio Setup is not part of the runtime", async () => {
  let studioSetupCalls = 0;
  const readiness = await readVibe64StudioReadiness({
    studioSetupService: {
      async getStatus() {
        studioSetupCalls += 1;
        throw new Error("Studio Setup should not run.");
      }
    }
  }, {
    includeStudioSetup: false
  });

  assert.equal(readiness.ready, true);
  assert.equal(studioSetupCalls, 0);
  assert.deepEqual(readiness.stages, []);
});

test("runtime profile controls whether Studio Setup is required", () => {
  assert.equal(runtimeProfileRequiresStudioSetup(null), true);
  assert.equal(runtimeProfileRequiresStudioSetup({ local: true, mode: "local" }), true);
  assert.equal(runtimeProfileRequiresStudioSetup({ local: false, mode: "composed" }), false);
  assert.equal(runtimeProfileRequiresStudioSetup({ local: false, studioSetupEnabled: true }), true);
  assert.equal(runtimeProfileRequiresStudioSetup({ local: true, studioSetupEnabled: false }), false);
  assert.equal(runtimeProfileRequiresStudioSetup({ local: true, capabilities: { studioSetupEnabled: false } }), false);
  assert.deepEqual(setupOptionsForRuntimeProfile({ local: false, mode: "composed" }), {
    includeStudioSetup: false
  });
  assert.deepEqual(normalizeSetupOptions(null), {
    includeStudioSetup: true
  });
  assert.deepEqual(normalizeSetupOptions({
    includeStudioSetup: false
  }), {
    includeStudioSetup: false
  });
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
