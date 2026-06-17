import assert from "node:assert/strict";
import test from "node:test";

import {
  VIBE64_CONNECTIONS_SERVICE,
  createLocalConnectionSetupService,
  resolveConnectionSetupService
} from "@local/vibe64-runtime/server/connectionReadiness";

test("connection setup fallback reports local connections ready", async () => {
  const service = createLocalConnectionSetupService();
  const status = await service.getStatus();

  assert.equal(status.ok, true);
  assert.equal(status.ready, true);
  assert.deepEqual(status.connections.map((connection) => connection.id), ["codex", "github"]);
});

test("connection setup resolver uses the registered accounts-backed service", async () => {
  const accountsBackedService = {
    async getStatus() {
      return {
        connections: [
          {
            connected: false,
            id: "github",
            ready: false
          }
        ],
        ok: true,
        ready: false
      };
    }
  };
  const scope = {
    has(token) {
      return token === VIBE64_CONNECTIONS_SERVICE;
    },
    make(token) {
      assert.equal(token, VIBE64_CONNECTIONS_SERVICE);
      return accountsBackedService;
    }
  };

  assert.equal(resolveConnectionSetupService(scope), accountsBackedService);
});
