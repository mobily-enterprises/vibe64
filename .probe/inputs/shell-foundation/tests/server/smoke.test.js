import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "../../server.js";
import { resolveRuntimeEnv } from "../../server/lib/runtimeEnv.js";

test("GET /api/health reports the installed runtime's health checks", async (context) => {
  const app = await createServer({ runtimeEnv: resolveRuntimeEnv() });
  context.after(() => app.close());
  const response = await app.inject({
    method: "GET",
    url: "/api/health"
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { ok: true, checks: {}, app: "reading-room" });
});
