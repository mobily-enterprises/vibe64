import assert from "node:assert/strict";
import test from "node:test";

import {
  formatElapsedTime,
  runWithProgress
} from "../../tooling/update-jskit-packages.mjs";

test("formatElapsedTime keeps updater progress concise", () => {
  assert.equal(formatElapsedTime(0), "under 1s");
  assert.equal(formatElapsedTime(19_900), "19s");
  assert.equal(formatElapsedTime(60_000), "1m");
  assert.equal(formatElapsedTime(125_000), "2m 5s");
});

test("runWithProgress reports start, heartbeat, and completion", async () => {
  const messages = [];
  const originalConsoleLog = console.log;
  console.log = (...values) => {
    messages.push(values.join(" "));
  };

  try {
    await runWithProgress(
      process.execPath,
      ["-e", "setTimeout(() => {}, 50)"],
      {
        activity: "testing a long update",
        progressIntervalMs: 10,
        step: "Step 1/3"
      }
    );
  } finally {
    console.log = originalConsoleLog;
  }

  assert.equal(messages[0], "[jskit:update] Step 1/3: testing a long update.");
  assert.ok(messages.some((message) => message.includes("Step 1/3 is still running")));
  assert.match(messages.at(-1), /^\[jskit:update\] Step 1\/3 complete in /u);
});

test("runWithProgress preserves command failures", async () => {
  const originalConsoleLog = console.log;
  console.log = () => {};

  try {
    await assert.rejects(
      runWithProgress(process.execPath, ["-e", "process.exit(7)"], {
        activity: "testing a failed update",
        progressIntervalMs: 10,
        step: "Step 3/3"
      }),
      /failed with exit code 7/u
    );
  } finally {
    console.log = originalConsoleLog;
  }
});
