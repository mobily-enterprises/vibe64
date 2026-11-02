import assert from "node:assert/strict";
import test from "node:test";

import {
  vibe64StatusCode
} from "../../packages/vibe64-core/src/server/serverResponses.js";

test("requests that conflict with current operational state return conflict", () => {
  assert.equal(vibe64StatusCode({
    code: "vibe64_project_not_ready",
    ok: false
  }), 409);
  assert.equal(vibe64StatusCode({
    code: "vibe64_workspace_setup_running",
    ok: false
  }), 409);
  assert.equal(vibe64StatusCode({
    code: "vibe64_workspace_setup_retry_not_available",
    ok: false
  }), 409);
  assert.equal(vibe64StatusCode({
    code: "vibe64_development_database_scope_busy",
    ok: false
  }), 409);
  assert.equal(vibe64StatusCode({
    code: "vibe64_project_session_policy_lock_timeout",
    ok: false
  }), 409);
  assert.equal(vibe64StatusCode({
    code: "vibe64_project_source_lock_timeout",
    ok: false
  }), 409);
  assert.equal(vibe64StatusCode({
    code: "vibe64_session_creation_limit",
    ok: false
  }), 409);
});
