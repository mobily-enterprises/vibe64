// "Install on my phone", end to end with real tools: a Vite canary with two
// Capacitor plugins is built once into an unsigned APK by the credential-free
// Stage 1 (Gradle in a throwaway shell), signed in Stage 2 with a sideload key
// generated for this test, verified by apksigner, re-run idempotently, refused
// with the wrong key, and rebuilt by the CLI to the same bytes. Opt-in, because
// it downloads Gradle dependencies and runs two Android builds:
//   VIBE64_TEST_ANDROID=1
//   VIBE64_TEST_ANDROID_TOOLCHAINS=<folder for the pinned JDK> (default ~/.cache/vibe64-publish-spike/toolchains)
//   VIBE64_TEST_ANDROID_HOME=<an installed SDK with platform 36 and build-tools 35>
//   VIBE64_TEST_ANDROID_CACHE=<Gradle and npm cache> (default ~/.cache/vibe64-publish-spike/cache)
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { androidSideloadDestination, generateSideloadKey } from "../../packages/vibe64-packaging/src/server/destinations/androidSideload/index.js";
import { buildPackage } from "../../packages/vibe64-packaging/src/server/release/buildPackage.js";
import { publishTarget, spawnCommand } from "../../packages/vibe64-packaging/src/server/stages.js";
import { findAndroidSdk } from "../../packages/vibe64-packaging/src/server/toolchains/androidSdk.js";
import { installJdk } from "../../packages/vibe64-packaging/src/server/toolchains/jdk.js";
import { inspectVibe64Packaging } from "../../packages/vibe64-genesis/src/server/index.js";
import { canaryFiles } from "./packagingAndroidTestTools.js";
import { commitFiles, temporaryFolder } from "./packagingRegistryTestTools.js";

const run = promisify(execFile);
const CLI = fileURLToPath(new URL("../../packages/vibe64-packaging/bin/vibe64-publish.js", import.meta.url));
const SPIKE = path.join(os.homedir(), ".cache", "vibe64-publish-spike");
const TOOLCHAINS = process.env.VIBE64_TEST_ANDROID_TOOLCHAINS || path.join(SPIKE, "toolchains");
const CACHE = process.env.VIBE64_TEST_ANDROID_CACHE || path.join(SPIKE, "cache");
const TEMP_PREFIXES = ["vibe64-sideload-key-", "vibe64-credentials-", "vibe64-publish-tool-", "vibe64-release-source-", "vibe64-build-home-"];

async function leftovers() {
  return (await readdir(os.tmpdir())).filter((name) => TEMP_PREFIXES.some((prefix) => name.startsWith(prefix))).sort();
}

// The canary, with a real lockfile resolved by npm, committed as the saved commit.
async function canaryProject(t) {
  const root = await temporaryFolder(t, "vibe64-android-canary-");
  await run("git", ["init", "-q", "-b", "main", root]);
  const files = canaryFiles();
  delete files["package-lock.json"];
  await writeFile(path.join(root, "package.json"), files["package.json"]);
  await run("npm", ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: root, timeout: 300_000 });
  files["package-lock.json"] = await readFile(path.join(root, "package-lock.json"), "utf8");
  files[".gitignore"] = "node_modules/\ndist/\n";
  return { root, ...await commitFiles(root, files, "Notes canary") };
}

test("an APK is built without credentials, signed with the sideload key, verified, and rebuilt identically", {
  skip: process.env.VIBE64_TEST_ANDROID === "1" ? false : "set VIBE64_TEST_ANDROID=1 to run the Android build",
  timeout: 1_800_000
}, async (t) => {
  const before = await leftovers();
  const { javaHome } = await installJdk({ directory: TOOLCHAINS });
  const sdk = await findAndroidSdk({ directory: process.env.VIBE64_TEST_ANDROID_HOME || path.join(TOOLCHAINS, "android-sdk") });
  assert.ok(sdk.ok, `${sdk.message} Set VIBE64_TEST_ANDROID_HOME to an SDK installed after accepting its licence.`);
  const toolchains = { javaHome, androidHome: sdk.androidHome };
  const project = await canaryProject(t);
  const packaging = await inspectVibe64Packaging({ projectRoot: project.root });
  assert.equal(packaging.status, "ready", JSON.stringify(packaging.diagnostics));

  // The sideload key exists before the build, so the build provably never sees it.
  const keyFolder = await temporaryFolder(t, "vibe64-test-keys-");
  const keys = {};
  const keyFor = (name) => generateSideloadKey({
    javaHome,
    commonName: "Notes",
    sink: async ({ keystore, password, certificateSha256 }) => {
      const files = { keystore: path.join(keyFolder, `${name}.p12`), password: path.join(keyFolder, `${name}.password`) };
      await writeFile(files.keystore, keystore, { mode: 0o600 });
      await writeFile(files.password, password, { mode: 0o600 });
      keys[name] = { ...files, certificateSha256, passwordText: password.toString("utf8") };
    }
  });
  const key = await keyFor("main");
  assert.equal(key.certificateSha256, keys.main.certificateSha256);
  assert.match(key.certificateSha256, /^[0-9a-f]{64}$/u);

  const stage1 = [];
  const recordingRunCommand = (options) => {
    stage1.push(options);
    return spawnCommand(options);
  };
  const store = await temporaryFolder(t, "vibe64-android-results-");
  const started = Date.now();
  const built = await buildPackage({
    projectRoot: project.root,
    commit: project.commit,
    packaging,
    packageId: "app",
    versionCode: 1,
    toolchains,
    resultStore: store,
    cacheDirectory: CACHE
  }, { runCommand: recordingRunCommand });
  t.diagnostic(`editor build: ${Math.round((Date.now() - started) / 1000)} s`);
  assert.deepEqual(built.artifacts.manifest.files.map(({ path: file }) => file), ["app-1.4.2-unsigned.apk"]);
  const everything = JSON.stringify(stage1.map(({ command, args, env, cwd }) => ({ command, args, env, cwd })));
  assert.ok(!everything.includes(keyFolder), "Stage 1 never sees the key folder");
  assert.ok(!everything.includes(keys.main.passwordText), "Stage 1 never sees the key password");
  assert.ok(stage1.every(({ cwd }) => !cwd.startsWith(project.root)), "Stage 1 never runs in the project");
  const { stdout: status } = await run("git", ["-C", project.root, "status", "--porcelain"]);
  assert.equal(status, "");

  const target = { id: "phone", destination: "android-sideload", package: "app", settings: { certificateSha256: key.certificateSha256 } };
  const credentialsFor = (name) => async (spec) => readFile(spec.id === "android-sideload-keystore" ? keys[name].keystore : keys[name].password);
  const published = await publishTarget({
    destination: androidSideloadDestination,
    target,
    version: "1.4.2",
    artifacts: built.artifacts,
    obtainCredential: credentialsFor("main"),
    toolchains
  });
  assert.equal(published.status, "proven");
  assert.equal(published.alreadyPublished, false);
  assert.equal(published.proof.certificateSha256, key.certificateSha256);
  assert.equal(published.proof.applicationId, "dev.vibe64.canary.notes");
  assert.equal(published.proof.versionName, "1.4.2");
  assert.equal(published.proof.versionCode, 1);
  assert.ok((await stat(published.proof.file)).size > 1_000_000);
  const aapt2 = path.join(sdk.androidHome, "build-tools", "35.0.0", "aapt2");
  const { stdout: badging } = await run(aapt2, ["dump", "badging", published.proof.file]);
  assert.match(badging, /uses-permission: name='android.permission.CAMERA'/u);
  assert.match(badging, /targetSdkVersion:'36'/u);
  assert.match(badging, /application-label:'Notes'/u);
  t.diagnostic(`signed APK ${published.proof.fileName}: ${published.proof.size} bytes, ${published.proof.sha256}`);

  const again = await publishTarget({
    destination: androidSideloadDestination,
    target,
    version: "1.4.2",
    artifacts: built.artifacts,
    obtainCredential: credentialsFor("main"),
    toolchains
  });
  assert.equal(again.alreadyPublished, true);
  assert.equal(again.proof.sha256, published.proof.sha256);

  await keyFor("other");
  await assert.rejects(publishTarget({
    destination: androidSideloadDestination,
    target: { ...target, id: "phone-other-key" },
    version: "1.4.2",
    artifacts: built.artifacts,
    obtainCredential: credentialsFor("other"),
    toolchains
  }), (error) => error.code === "VIBE64_PUBLISH_KEY_MISMATCH");

  // Outside the editor, the CLI builds the same unsigned bytes from the same commit.
  const cliStore = await temporaryFolder(t, "vibe64-android-cli-results-");
  const { stdout } = await run(process.execPath, [
    CLI, "build", "app",
    "--project", project.root,
    "--build-number", "app=1",
    "--java-home", javaHome,
    "--android-home", sdk.androidHome,
    "--cache", CACHE,
    "--result-store", cliStore,
    "--json"
  ], { cwd: project.root, timeout: 1_200_000, maxBuffer: 16 * 1024 * 1024 });
  const cli = JSON.parse(stdout);
  assert.equal(cli.reused, false);
  assert.deepEqual(cli.files, built.artifacts.manifest.files, "the CLI build gives the same unsigned APK checksum");
  t.diagnostic(`unsigned APK ${cli.files[0].sha256} from both the editor and the CLI`);

  await rm(keyFolder, { recursive: true, force: true });
  assert.equal(await stat(keyFolder).catch(() => null), null, "the test keys are deleted");
  assert.deepEqual(await leftovers(), before, "no key, credential or build folder is left behind");
});
