import assert from "node:assert/strict";
import { test } from "node:test";

import { mergePrependEnvironment } from "@local/vibe64-usage-recording/server/tracers";

test("prepended tracer variables join an existing value with exactly one separator", () => {
  const ours = { PYTHONPATH: "/vibe64/python", PHP_INI_SCAN_DIR: "/vibe64/php:" };
  assert.deepEqual(mergePrependEnvironment(ours, {}, ":"), ours);
  assert.deepEqual(mergePrependEnvironment(ours, { PYTHONPATH: "", PHP_INI_SCAN_DIR: "" }, ":"), ours);
  assert.deepEqual(mergePrependEnvironment(ours, { PYTHONPATH: "/app/lib", PHP_INI_SCAN_DIR: "/etc/php/extra" }, ":"), {
    PYTHONPATH: "/vibe64/python:/app/lib",
    PHP_INI_SCAN_DIR: "/vibe64/php:/etc/php/extra"
  });
  assert.deepEqual(mergePrependEnvironment(ours, { PYTHONPATH: ":/extra", PHP_INI_SCAN_DIR: ":/extra" }, ":"), {
    PYTHONPATH: "/vibe64/python:/extra",
    PHP_INI_SCAN_DIR: "/vibe64/php:/extra"
  });
  assert.deepEqual(mergePrependEnvironment({ PATH: "C:\\ours" }, { PATH: "C:\\theirs" }, ";"), { PATH: "C:\\ours;C:\\theirs" });
  assert.deepEqual(mergePrependEnvironment({}, { PYTHONPATH: "/app" }), {});
});
