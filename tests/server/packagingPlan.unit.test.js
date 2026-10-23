import assert from "node:assert/strict";
import test from "node:test";

import { vibe64PackagingInspection } from "../../packages/vibe64-genesis/src/server/packaging.js";
import {
  createPublishPlan,
  publishPlanDisplayId,
  publishPlanHash,
  releaseTagName
} from "../../packages/vibe64-packaging/src/server/plan.js";
import { VIBE64_PACKERS } from "../../packages/vibe64-packaging/src/server/packers/index.js";
import { VIBE64_DESTINATIONS } from "../../packages/vibe64-packaging/src/server/destinations/index.js";
import { VIBE64_PACKAGING_PACKERS } from "../../packages/vibe64-genesis/src/server/packaging.js";

const COMMIT = "a".repeat(40);
const OTHER_COMMIT = "b".repeat(40);

function packaging(sectionLines) {
  return vibe64PackagingInspection({
    environment: { stackHash: "sha256:s", environmentDefaults: [] },
    section: { status: "ready", stackHash: "sha256:s", lines: sectionLines }
  });
}

const APP = packaging([
  "### Package `web`: Web",
  "- Packer: `web-bundle`",
  "- Build `Build`: `npm` `run` `build`",
  "- Output: `dist`",
  "### Package `app`: App",
  "- Packer: `capacitor`",
  "- Content: package `web`",
  "- Platforms: `android`",
  "- Id: `com.example.app`",
  "- Name: `App`",
  "- Icon: `icon.png`",
  "- Version from: `package.json`",
  "### Package `sdk`: SDK",
  "- Packer: `npm`",
  "- Version from: `package.json`"
]);
const LIBRARY = packaging(["### Package `lib`: Library", "- Packer: `npm`", "- Version from: `package.json`"]);

function input(overrides = {}) {
  return {
    savedCommit: COMMIT,
    packaging: APP,
    versions: { app: "1.5.0", sdk: "0.9.1" },
    targets: [
      { id: "sdk-npm", destination: "npm", package: "sdk", channel: "latest" },
      { id: "phone", destination: "android-sideload", package: "app" },
      { id: "app-release", destination: "github-releases", package: "app", channel: "latest" }
    ],
    toolchain: { node: "26.1.0", "@capacitor/cli": "8.0.2" },
    templates: { "capacitor-android": "1" },
    ...overrides
  };
}

test("registries cover exactly the Packaging contract's closed packer set", () => {
  assert.deepEqual(Object.keys(VIBE64_PACKERS).sort(), [...VIBE64_PACKAGING_PACKERS].sort());
  assert.deepEqual(Object.keys(VIBE64_DESTINATIONS).sort(), ["android-sideload", "github-releases", "npm", "pypi"]);
  for (const destination of Object.values(VIBE64_DESTINATIONS)) {
    for (const packer of destination.packers) assert.ok(VIBE64_PACKERS[packer], `${destination.id} ${packer}`);
  }
});

test("the plan builds each package once, fans out, and its hash is deterministic", () => {
  const { plan, planHash } = createPublishPlan(input());
  assert.equal(plan.contract, "vibe64.publish-plan.v1");
  assert.match(planHash, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(publishPlanHash(plan), planHash);
  assert.equal(publishPlanDisplayId(planHash), planHash.slice(7, 11));
  assert.deepEqual(plan.packages.map(({ id, version, tag }) => [id, version, tag]), [
    ["web", null, null],
    ["app", "1.5.0", "app@1.5.0"],
    ["sdk", "0.9.1", "sdk@0.9.1"]
  ]);
  assert.deepEqual(plan.targets.map(({ id }) => id), ["app-release", "phone", "sdk-npm"]);
  assert.deepEqual(plan.tags, ["app@1.5.0", "sdk@0.9.1"]);
  assert.deepEqual(plan.steps.filter(({ kind }) => kind === "build").map((step) => step.package), ["web", "app", "sdk"]);
  assert.equal(plan.steps.filter(({ kind }) => kind === "publish").length, 3);

  const reordered = input({
    targets: [...input().targets].reverse(),
    toolchain: { "@capacitor/cli": "8.0.2", node: "26.1.0" }
  });
  assert.equal(createPublishPlan(reordered).planHash, planHash);
  assert.equal(createPublishPlan(input()).planHash, planHash);
});

test("the hash changes with the commit, targets, versions, toolchain, templates and Packaging", () => {
  const { planHash } = createPublishPlan(input());
  const variants = [
    input({ savedCommit: OTHER_COMMIT }),
    input({ targets: input().targets.slice(0, 2) }),
    input({ targets: input().targets.map((target) => target.id === "app-release" ? { ...target, channel: "prerelease" } : target) }),
    input({ versions: { app: "1.5.1", sdk: "0.9.1" } }),
    input({ toolchain: { node: "26.2.0", "@capacitor/cli": "8.0.2" } }),
    input({ templates: { "capacitor-android": "2" } }),
    input({ packaging: packaging([
      "### Package `web`: Web", "- Packer: `web-bundle`", "- Build `Build`: `npm` `run` `build:mobile`", "- Output: `dist`",
      "### Package `app`: App", "- Packer: `capacitor`", "- Content: package `web`", "- Platforms: `android`",
      "- Id: `com.example.app`", "- Name: `App`", "- Icon: `icon.png`", "- Version from: `package.json`",
      "### Package `sdk`: SDK", "- Packer: `npm`", "- Version from: `package.json`"
    ]) })
  ];
  const hashes = new Set([planHash, ...variants.map((variant) => createPublishPlan(variant).planHash)]);
  assert.equal(hashes.size, variants.length + 1);
});

test("one versioned package tags v<version>; independent packages tag <package>@<version>", () => {
  const { plan } = createPublishPlan({
    savedCommit: COMMIT,
    packaging: LIBRARY,
    versions: { lib: "2.0.0-rc.1" },
    targets: [{ id: "npm", destination: "npm", package: "lib", channel: "next" }]
  });
  assert.deepEqual(plan.tags, ["v2.0.0-rc.1"]);
  assert.equal(releaseTagName({ packageId: "sdk", version: "1.0.0", independent: true }), "sdk@1.0.0");
});

test("invalid plans are refused", () => {
  const refuses = (overrides, pattern) => assert.throws(
    () => createPublishPlan(input(overrides)),
    (error) => error.code === "VIBE64_PUBLISH_PLAN_INVALID" && pattern.test(error.message),
    pattern.source
  );
  refuses({ savedCommit: "abc123" }, /full saved commit/u);
  refuses({ packaging: { ...APP, status: "blocked" } }, /ready Packaging/u);
  refuses({ targets: [] }, /at least one target/u);
  refuses({ targets: [{ id: "x", destination: "npm", package: "missing" }] }, /does not declare/u);
  refuses({ targets: [{ id: "x", destination: "npm", package: "app" }] }, /cannot publish a capacitor package/u);
  refuses({ targets: [{ id: "x", destination: "npm", package: "sdk", channel: "beta" }], versions: { sdk: "1.0.0" } }, /no channel beta/u);
  refuses({ targets: [input().targets[0], input().targets[0]] }, /appears twice/u);
  refuses({ versions: { app: "1.5", sdk: "0.9.1" } }, /needs its release version/u);
  refuses({ versions: { app: "1.5.0", sdk: "0.9.1", web: "1.0.0" } }, /does not publish/u);
  refuses({ toolchain: { node: "latest version" } }, /exact version/u);
  assert.throws(
    () => createPublishPlan(input({ targets: [{ id: "x", destination: "app-store", package: "app" }] })),
    (error) => error.code === "VIBE64_PUBLISH_DESTINATION_UNKNOWN"
  );
});

test("preflight blocks, warns and requires acknowledgements over the plan's facts", async () => {
  const {
    VIBE64_PREFLIGHT_CHECKS,
    assertPreflightAllowsRelease,
    definePreflightCheck,
    preflightAllowsRelease,
    runPreflight
  } = await import("../../packages/vibe64-packaging/src/server/preflight/index.js");
  const { plan } = createPublishPlan(input());
  const ready = { plan, packaging: APP, baseline: { saved: true, pushed: true, commit: COMMIT } };
  const passing = runPreflight(VIBE64_PREFLIGHT_CHECKS, ready);
  assert.deepEqual(passing.checks.map(({ id, ok }) => [id, ok]), [["baseline-saved-pushed", true], ["packaging-ready", true]]);
  assert.equal(preflightAllowsRelease(passing), true);

  const unpushed = runPreflight(VIBE64_PREFLIGHT_CHECKS, { ...ready, baseline: { ...ready.baseline, pushed: false } });
  assert.equal(unpushed.blocked, true);
  assert.throws(() => assertPreflightAllowsRelease(unpushed), (error) => error.code === "VIBE64_PUBLISH_PREFLIGHT_BLOCKED"
    && error.details.checks.includes("baseline-saved-pushed"));

  const toolsChanged = runPreflight(VIBE64_PREFLIGHT_CHECKS, { ...ready, previousRelease: { toolchain: { node: "26.0.0" } } });
  assert.deepEqual(toolsChanged.acknowledgementsNeeded, ["toolchain-unchanged"]);
  assert.match(toolsChanged.checks.at(-1).message, /node 26\.0\.0 → 26\.1\.0/u);
  assert.equal(preflightAllowsRelease(toolsChanged), false);
  assert.equal(preflightAllowsRelease(toolsChanged, ["toolchain-unchanged"]), true);
  assert.throws(() => assertPreflightAllowsRelease(toolsChanged), (error) => error.code === "VIBE64_PUBLISH_PREFLIGHT_UNACKNOWLEDGED");

  const warning = definePreflightCheck({ id: "remote-shell", label: "Remote content", severity: "warn", run: () => { throw new Error("cannot inspect"); } });
  const warned = runPreflight([warning], {});
  assert.deepEqual(warned.warnings, ["remote-shell"]);
  assert.equal(warned.checks[0].message, "cannot inspect");
  assert.equal(preflightAllowsRelease(warned), true);
  assert.throws(() => definePreflightCheck({ id: "x", label: "X", severity: "fatal", run() {} }), TypeError);
});
