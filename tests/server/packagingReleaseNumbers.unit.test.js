// Release facts every publishing flow shares: Android build numbers that only
// grow yet stay put when an unfinished release is retried, and the registry
// addresses each destination owns.
import assert from "node:assert/strict";
import test from "node:test";

import { vibe64Destination } from "../../packages/vibe64-packaging/src/server/destinations/index.js";
import { pypiSettingsForAddress } from "../../packages/vibe64-packaging/src/server/destinations/pypi/index.js";
import { nextBuildNumbers } from "../../packages/vibe64-packaging/src/server/release/buildNumbers.js";

const COMMIT = "a".repeat(40);
const app = { id: "app", packer: "capacitor", version: "1.2.0" };
const sdk = { id: "sdk", packer: "npm", version: "1.2.0" };

test("each app package gets one above every build number a release used; libraries get none", () => {
  assert.deepEqual(nextBuildNumbers({ packages: [app, sdk], savedCommit: COMMIT }), { app: 1 });
  const releases = [
    { kind: "release", status: "succeeded", savedCommit: "b".repeat(40), versions: { app: "1.1.0" }, buildNumbers: { app: 4 } },
    { kind: "dry-run", status: "succeeded", savedCommit: COMMIT, versions: { app: "1.2.0" }, buildNumbers: { app: 40 } }
  ];
  assert.deepEqual(nextBuildNumbers({ releases, packages: [app], savedCommit: COMMIT }), { app: 5 }, "a dry run uses no build number");
});

test("retrying an unfinished release of the same commit and version keeps its build number", () => {
  for (const status of ["failed", "partial", "interrupted"]) {
    const releases = [
      { kind: "release", status, savedCommit: COMMIT, versions: { app: "1.2.0" }, buildNumbers: { app: 5 } },
      { kind: "release", status: "succeeded", savedCommit: "b".repeat(40), versions: { app: "1.1.0" }, buildNumbers: { app: 4 } }
    ];
    assert.deepEqual(nextBuildNumbers({ releases, packages: [app], savedCommit: COMMIT }), { app: 5 }, status);
    assert.deepEqual(nextBuildNumbers({ releases, packages: [{ ...app, version: "1.2.1" }], savedCommit: COMMIT }), { app: 6 }, "another version grows");
  }
  const done = [{ kind: "release", status: "succeeded", savedCommit: COMMIT, versions: { app: "1.2.0" }, buildNumbers: { app: 5 } }];
  assert.deepEqual(nextBuildNumbers({ releases: done, packages: [app], savedCommit: COMMIT }), { app: 6 }, "a finished release's number is never reused");
});

test("build numbers stop at Android's upper bound", () => {
  const releases = [{ kind: "release", status: "succeeded", savedCommit: "b".repeat(40), buildNumbers: { app: 2_100_000_000 } }];
  assert.throws(() => nextBuildNumbers({ releases, packages: [app], savedCommit: COMMIT }), { code: "VIBE64_PUBLISH_TARGET_INVALID" });
});

test("destinations own their registry addresses", () => {
  assert.equal(vibe64Destination("npm").defaultRegistry, "https://registry.npmjs.org/");
  assert.equal(vibe64Destination("pypi").instances.pypi.repository, "https://upload.pypi.org/legacy/");
  assert.equal(vibe64Destination("pypi").instances.testpypi.repository, "https://test.pypi.org/legacy/");
  assert.deepEqual(pypiSettingsForAddress(""), { instance: "pypi" });
  assert.deepEqual(pypiSettingsForAddress("https://upload.pypi.org/legacy"), { instance: "pypi" });
  assert.deepEqual(pypiSettingsForAddress("https://test.pypi.org/legacy/"), { instance: "testpypi" });
  assert.deepEqual(pypiSettingsForAddress("https://pypi.example.com/upload.pypi.org/legacy/"), {
    repository: "https://pypi.example.com/upload.pypi.org/legacy/",
    index: "https://pypi.example.com/upload.pypi.org/simple/"
  }, "another index is never mistaken for PyPI");
});
