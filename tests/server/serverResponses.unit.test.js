import assert from "node:assert/strict";
import test from "node:test";

import {
  vibe64StatusCode
} from "../../packages/vibe64-core/src/server/serverResponses.js";

test("project readiness failures are workflow conflicts", () => {
  assert.equal(vibe64StatusCode({
    code: "vibe64_project_not_ready",
    ok: false
  }), 409);
});
