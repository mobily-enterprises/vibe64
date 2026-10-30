import assert from "node:assert/strict";
import { test } from "node:test";

import { createSession, listSessions } from "../packages/sessions/src/server/service.js";

test("lists created sessions", async () => {
  await createSession({ id: "1", title: " First " });
  assert.deepEqual(await listSessions(), [{ id: "1", title: "First" }]);
});
