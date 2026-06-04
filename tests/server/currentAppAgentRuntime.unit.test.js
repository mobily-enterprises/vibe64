import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createService
} from "../../packages/current-app/src/server/service.js";

function readyService() {
  return {
    async getStatus() {
      return {
        ready: true
      };
    }
  };
}

test("current-app capabilities read the selected AI runtime from account status", async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-current-app-"));
  try {
    const service = createService({
      appRoot: targetRoot,
      projectService: {
        createRuntime() {
          return {};
        }
      },
      setupServices: {
        accountSetupService: {
          async getStatus() {
            return {
              accounts: [
                {
                  connected: false,
                  id: "codex",
                  label: "Codex",
                  required: false,
                  status: "not_connected"
                },
                {
                  connected: true,
                  id: "github",
                  label: "GitHub",
                  required: true,
                  status: "connected"
                }
              ],
              agentRuntimes: [
                {
                  default: true,
                  id: "opencode",
                  label: "OpenCode",
                  mode: "free",
                  ready: true,
                  runtime: "opencode",
                  status: "available"
                },
                {
                  id: "codex",
                  label: "Codex",
                  mode: "optional",
                  ready: false,
                  runtime: "codex",
                  status: "not_connected"
                }
              ],
              ai: {
                defaultRuntimeId: "opencode",
                ready: true
              },
              ready: true
            };
          }
        },
        adapterSetupService: readyService(),
        projectSetupService: readyService(),
        studioSetupService: readyService()
      }
    });

    const capabilities = await service.inspectCapabilities();

    assert.equal(capabilities.ok, true);
    assert.equal(capabilities.connections.ai.ready, true);
    assert.equal(capabilities.connections.ai.selectedRuntimeId, "opencode");
    assert.equal(capabilities.connections.ai.selectedProviderId, "opencode");
    assert.equal(capabilities.connections.github.ready, true);
    assert.equal(capabilities.capabilities.createSession.enabled, true);
  } finally {
    await rm(targetRoot, {
      force: true,
      recursive: true
    });
  }
});
