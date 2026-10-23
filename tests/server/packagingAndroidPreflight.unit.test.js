// Android preflight: facts gathered from the saved source and toolchains, then
// pure checks — target API, icon, permissions and plugin match block; developer
// verification warns.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { createPublishPlan } from "../../packages/vibe64-packaging/src/server/plan.js";
import { VIBE64_ANDROID_PREFLIGHT_CHECKS, gatherAndroidFacts } from "../../packages/vibe64-packaging/src/server/preflight/android.js";
import { preflightAllowsRelease, runPreflight } from "../../packages/vibe64-packaging/src/server/preflight/index.js";
import { PACKAGING_LINES, canaryFiles, fakeToolchains, packagingFor, pngBytes } from "./packagingAndroidTestTools.js";
import { temporaryFolder } from "./packagingRegistryTestTools.js";

const COMMIT = "c".repeat(40);

async function sourceWith(t, files) {
  const root = await temporaryFolder(t, "vibe64-android-preflight-");
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), content);
  }
  return root;
}

function context(packaging, android) {
  const { plan } = createPublishPlan({
    savedCommit: COMMIT,
    packaging,
    versions: { app: "1.4.2" },
    buildNumbers: { app: 4 },
    targets: [{ id: "phone", destination: "android-sideload", package: "app" }]
  });
  return { plan, packaging, baseline: { saved: true, pushed: true, commit: COMMIT }, android };
}

function failed(result) {
  return result.checks.filter(({ ok }) => !ok).map(({ id }) => id);
}

test("a ready Android app passes every Block and shows the developer-verification notice", async (t) => {
  const packaging = packagingFor();
  const toolchains = await fakeToolchains(await temporaryFolder(t, "vibe64-fake-tools-"));
  const sourceRoot = await sourceWith(t, canaryFiles());
  const android = await gatherAndroidFacts({ sourceRoot, packaging, toolchains });
  const result = runPreflight(VIBE64_ANDROID_PREFLIGHT_CHECKS, context(packaging, android));
  assert.deepEqual(failed(result), ["android-developer-verification"]);
  assert.deepEqual(result.warnings, ["android-developer-verification"]);
  assert.equal(result.blocked, false);
  assert.equal(preflightAllowsRelease(result), true);
  assert.match(result.checks.find(({ id }) => id === "android-target-sdk").message, /API 36/u);
  assert.match(result.checks.find(({ id }) => id === "android-developer-verification").message, /Brazil, Indonesia, Singapore and Thailand/u);
  const registered = runPreflight(VIBE64_ANDROID_PREFLIGHT_CHECKS, context(packaging, { ...android, developerVerification: "registered" }));
  assert.deepEqual(failed(registered), []);
});

test("bad icons, unknown permissions, stale lockfiles, old Capacitor and missing tools block", async (t) => {
  const lines = PACKAGING_LINES.map((line) => line.startsWith("- Permission") ? "- Permission `teleport`: Move." : line);
  const packaging = packagingFor(lines);
  const sourceRoot = await sourceWith(t, canaryFiles({
    icon: pngBytes({ alpha: true }),
    dependencies: { "@capacitor/core": "7.4.0", "@capacitor/haptics": "8.0.3" },
    locked: { "@capacitor/haptics": "8.0.2" }
  }));
  const android = await gatherAndroidFacts({ sourceRoot, packaging, toolchains: {} });
  const result = runPreflight(VIBE64_ANDROID_PREFLIGHT_CHECKS, context(packaging, android));
  assert.equal(result.blocked, true);
  assert.deepEqual(failed(result).sort(), [
    "android-developer-verification", "android-icon", "android-permissions", "android-plugins", "android-toolchain"
  ]);
  const message = (id) => result.checks.find((check) => check.id === id).message;
  assert.match(message("android-icon"), /^app: The icon has transparency/u);
  assert.match(message("android-permissions"), /teleport is not one Vibe64 knows/u);
  assert.match(message("android-permissions"), /needs a reason a person would understand/u);
  assert.match(message("android-plugins"), /8\.0\.3 in package\.json but 8\.0\.2 in package-lock\.json/u);
  assert.match(message("android-plugins"), /@capacitor\/core 7\.4\.0; Vibe64 builds with Capacitor 8\.5\.3/u);
  assert.match(message("android-toolchain"), /No Java home given/u);

  const lowTarget = { ...android, packages: android.packages.map((entry) => ({ ...entry, targetSdk: 35, icon: [], permissions: [], plugins: [] })) };
  assert.ok(failed(runPreflight(VIBE64_ANDROID_PREFLIGHT_CHECKS, context(packaging, lowTarget))).includes("android-target-sdk"));
});

test("Android checks do not apply to releases without an app package", async (t) => {
  const packaging = packagingFor(["### Package `sdk`: SDK", "- Packer: `npm`", "- Version from: `package.json`"]);
  assert.equal(await gatherAndroidFacts({ sourceRoot: await sourceWith(t, {}), packaging }), null);
  const { plan } = createPublishPlan({
    savedCommit: COMMIT,
    packaging,
    versions: { sdk: "1.0.0" },
    targets: [{ id: "npm", destination: "npm", package: "sdk" }]
  });
  const result = runPreflight(VIBE64_ANDROID_PREFLIGHT_CHECKS, { plan, packaging, baseline: { saved: true, pushed: true, commit: COMMIT }, android: null });
  assert.deepEqual(result.checks.map(({ id }) => id), ["baseline-saved-pushed", "packaging-ready"]);
});
