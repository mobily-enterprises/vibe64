import assert from "node:assert/strict";
import { test } from "node:test";

import { mergePrependEnvironment } from "@local/vibe64-usage-recording/server/tracers";

test("prepended tracer variables keep both values' segments", () => {
  const merge = (value, existing) => mergePrependEnvironment({ NAME: value },
    existing === undefined ? {} : { NAME: existing }, ":").NAME;
  assert.equal(merge("/ours:", undefined), "/ours:");
  assert.equal(merge("/ours:", ""), "/ours:");
  assert.equal(merge("/ours:", ":/extra"), "/ours::/extra");
  assert.equal(merge("/ours:", "/x"), "/ours:/x");
  assert.equal(merge("/py", "/a"), "/py:/a");
  assert.equal(merge("/py", ":/a"), "/py::/a");
  assert.equal(merge("/py", undefined), "/py");
  assert.deepEqual(mergePrependEnvironment({ PATH: "C:\\ours" }, { PATH: "C:\\theirs" }, ";"), { PATH: "C:\\ours;C:\\theirs" });
  assert.deepEqual(mergePrependEnvironment({}, { PYTHONPATH: "/app" }), {});
});
