import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { playwrightChildEnvironment } from "./playwrightChildEnvironment.js";

// Where the inherited browsers are: any folder of the test's own, never one in a system location.
const BROWSERS = path.join(os.tmpdir(), "vibe64-test-playwright-browsers");

test("a Playwright child's environment drops every Playwright and JSKIT browser-test setting it inherits, keeps the browsers, and takes its own", () => {
  const parent = {
    HOME: "/home/tester",
    PATH: "/usr/bin",
    // A test host's lane and an outer suite's settings, and ones no Playwright or JSKIT has yet.
    PLAYWRIGHT_PORT: "4173",
    PLAYWRIGHT_WORKER_TARGETS: JSON.stringify([{ baseURL: "http://127.0.0.1:4173" }]),
    PLAYWRIGHT_BASE_URL: "http://127.0.0.1:4173",
    PLAYWRIGHT_FUTURE_X: "1",
    JSKIT_BROWSER_FUTURE_X: "1",
    PLAYWRIGHT_BROWSERS_PATH: BROWSERS
  };
  assert.deepEqual(playwrightChildEnvironment({ PLAYWRIGHT_BASE_URL: "http://127.0.0.1:5000", OWN: "1" }, parent), {
    HOME: "/home/tester",
    PATH: "/usr/bin",
    PLAYWRIGHT_BROWSERS_PATH: BROWSERS,
    PLAYWRIGHT_BASE_URL: "http://127.0.0.1:5000",
    OWN: "1"
  });
  // The child's own browsers win over the inherited ones; without either, it names none.
  assert.equal(playwrightChildEnvironment({ PLAYWRIGHT_BROWSERS_PATH: "/own" }, parent).PLAYWRIGHT_BROWSERS_PATH, "/own");
  assert.equal(Object.hasOwn(playwrightChildEnvironment({}, { PATH: "/usr/bin" }), "PLAYWRIGHT_BROWSERS_PATH"), false);
  // By default it starts from this process's environment.
  assert.equal(playwrightChildEnvironment().PATH, process.env.PATH);
});
