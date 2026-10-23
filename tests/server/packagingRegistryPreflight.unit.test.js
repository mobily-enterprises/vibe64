import assert from "node:assert/strict";
import test from "node:test";

import { runPreflight, preflightAllowsRelease } from "../../packages/vibe64-packaging/src/server/preflight/index.js";
import { VIBE64_REGISTRY_PREFLIGHT_CHECKS, gatherCredentialFacts } from "../../packages/vibe64-packaging/src/server/preflight/registries.js";

const COMMIT = "a".repeat(40);
const OTHER = "b".repeat(40);
const HASH = `sha256:${"d".repeat(64)}`;
const plan = {
  savedCommit: COMMIT,
  packagingHash: HASH,
  tags: ["v1.5.0"],
  targets: [{ id: "sdk-npm", destination: "npm" }, { id: "client-pypi", destination: "pypi" }],
  toolchain: { node: "26.5.0", npm: "11.6.0" }
};

function facts(overrides = {}) {
  return {
    plan,
    baseline: { saved: true, pushed: true, commit: COMMIT },
    packaging: { contract: "vibe64.packaging.v1", status: "ready", packagingHash: HASH, packages: [{}, {}] },
    tags: [],
    verification: { commit: COMMIT, status: "passed" },
    credentials: { "sdk-npm": { ok: true }, "client-pypi": { ok: true, verified: false } },
    previousRelease: { toolchain: { node: "26.5.0", npm: "11.6.0" } },
    ...overrides
  };
}

const result = (overrides) => runPreflight(VIBE64_REGISTRY_PREFLIGHT_CHECKS, facts(overrides));
const failed = (outcome) => outcome.checks.filter((check) => !check.ok).map(({ id }) => id);

test("a saved, verified, signed-in release with free tags passes and says what it will do", () => {
  const outcome = result();
  assert.deepEqual(failed(outcome), []);
  assert.equal(preflightAllowsRelease(outcome), true);
  const messages = Object.fromEntries(outcome.checks.map(({ id, message }) => [id, message]));
  assert.match(messages["release-tags-free"], /Will tag v1\.5\.0/u);
  assert.match(messages["credentials-valid"], /client-pypi can only be proven by the upload/u);
});

test("a tag on another commit, unverified commit or broken sign-in blocks the release", () => {
  assert.deepEqual(failed(result({ tags: [{ tag: "v1.5.0", commit: OTHER }] })), ["release-tags-free"]);
  // The same tag on the saved commit is a resumed release, not a conflict.
  assert.deepEqual(failed(result({ tags: [{ tag: "v1.5.0", commit: COMMIT }] })), []);
  assert.deepEqual(failed(result({ verification: { commit: OTHER, status: "passed" } })), ["verification-passed"]);
  assert.deepEqual(failed(result({ verification: { commit: COMMIT, status: "failed" } })), ["verification-passed"]);
  assert.deepEqual(failed(result({ verification: null })), ["verification-passed"]);
  const signIn = result({ credentials: { "sdk-npm": { ok: false, message: "The npm registry did not accept the sign-in (401)." } } });
  assert.deepEqual(failed(signIn), ["credentials-valid"]);
  assert.match(signIn.checks.find(({ id }) => id === "credentials-valid").message, /401.*client-pypi has no working sign-in/u);
  assert.equal(signIn.blocked, true);
});

test("a changed toolchain needs the person's acknowledgement, not a block", () => {
  const outcome = result({ previousRelease: { toolchain: { node: "24.1.0", npm: "11.6.0" } } });
  assert.equal(outcome.blocked, false);
  assert.deepEqual(outcome.acknowledgementsNeeded, ["toolchain-unchanged"]);
  assert.equal(preflightAllowsRelease(outcome), false);
  assert.equal(preflightAllowsRelease(outcome, ["toolchain-unchanged"]), true);
});

test("credential facts come from each destination's read-only check and never throw", async () => {
  const seen = [];
  const gathered = await gatherCredentialFacts({
    targets: [
      { id: "sdk-npm", destination: "npm", settings: { registry: "http://127.0.0.1:9/" } },
      { id: "client-pypi", destination: "pypi" },
      { id: "phone", destination: "android-sideload" }
    ],
    obtainCredential: async (spec) => {
      seen.push(spec.id);
      return spec.id === "pypi-token" ? "pypi-AgEtoken" : "//127.0.0.1:9/:_authToken=abcdefgh\n";
    }
  });
  assert.deepEqual(seen, ["npm-userconfig", "pypi-token", "android-sideload-keystore", "android-sideload-key-password"]);
  assert.equal(gathered["sdk-npm"].ok, false);
  assert.match(gathered["sdk-npm"].message, /Could not reach 127\.0\.0\.1:9/u);
  assert.deepEqual([gathered["client-pypi"].ok, gathered["client-pypi"].verified], [true, false]);
  assert.equal(gathered.phone.ok, false);
  assert.match(gathered.phone.message, /Android SDK|Java home/u);
  const missing = await gatherCredentialFacts({ targets: [{ id: "client-pypi", destination: "pypi" }] });
  assert.equal(missing["client-pypi"].ok, false);
});
