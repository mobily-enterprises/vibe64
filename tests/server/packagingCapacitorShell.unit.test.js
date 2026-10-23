// The generated Capacitor shell: byte-reproducible from the saved commit, holding
// exactly the lockfile's native plugins (a mismatch blocks), patched with checked
// anchors, built through the credential-free Stage 1 without touching the project.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { generateShell, nativePlugins, nextVersionCode, shellFiles } from "../../packages/vibe64-packaging/src/server/packers/capacitor/generateShell.js";
import { inspectPng, iconProblems } from "../../packages/vibe64-packaging/src/server/packers/capacitor/icons.js";
import {
  patchAppBuildGradle,
  patchManifest,
  patchStrings,
  patchWrapperProperties,
  variablesGradle
} from "../../packages/vibe64-packaging/src/server/packers/capacitor/shellPatch.js";
import { CAPACITOR_SHELL_TEMPLATE } from "../../packages/vibe64-packaging/src/server/packers/capacitor/shellTemplate/index.js";
import { buildPackage } from "../../packages/vibe64-packaging/src/server/release/buildPackage.js";
import { canaryFiles, fakeToolchains, lockfile, packagingFor, pngBytes } from "./packagingAndroidTestTools.js";
import { gitProject, temporaryFolder } from "./packagingRegistryTestTools.js";

const run = promisify(execFile);
const sha = (value) => createHash("sha256").update(value).digest("hex");

async function writeTree(root, files) {
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), content);
  }
}

async function snapshot(root, prefix = "") {
  const result = {};
  for (const entry of (await readdir(path.join(root, prefix), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(result, await snapshot(root, relative));
    else result[relative] = sha(await readFile(path.join(root, relative)));
  }
  return result;
}

function appEntries(packaging) {
  return {
    app: packaging.packages.find(({ id }) => id === "app"),
    web: packaging.packages.find(({ id }) => id === "web")
  };
}

test("the shell holds exactly the lockfile's native plugins and the pinned Capacitor", async (t) => {
  const source = await temporaryFolder(t, "vibe64-shell-source-");
  await writeTree(source, canaryFiles({ dependencies: { "@capacitor/core": "8.5.3", "@capacitor/haptics": "^8.0.0", "left-pad": "1.3.0" }, locked: { "@capacitor/haptics": "8.0.2" } }));
  const { app, web } = appEntries(packagingFor());
  const first = await generateShell({ sourceRoot: source, entry: app, content: web, version: "1.4.2", versionCode: 7 });
  const second = await generateShell({ sourceRoot: source, entry: app, content: web, version: "1.4.2", versionCode: 7 });
  assert.deepEqual(first.files, second.files);
  assert.deepEqual(first.plugins, [{ name: "@capacitor/haptics", version: "8.0.2" }]);
  assert.equal(first.core, "8.5.3");
  const manifest = JSON.parse(first.files["package.json"]);
  assert.deepEqual(manifest.dependencies, {
    "@capacitor/android": CAPACITOR_SHELL_TEMPLATE.capacitor,
    "@capacitor/core": CAPACITOR_SHELL_TEMPLATE.capacitor,
    "@capacitor/haptics": "8.0.2"
  });
  assert.deepEqual(manifest.devDependencies, { "@capacitor/cli": CAPACITOR_SHELL_TEMPLATE.capacitor });
  assert.deepEqual(JSON.parse(first.files["capacitor.config.json"]), {
    appId: "dev.vibe64.canary.notes",
    appName: "Notes",
    webDir: "www",
    loggingBehavior: "none"
  });
  const spec = JSON.parse(first.files["vibe64-shell.json"]);
  assert.equal(spec.versionCode, 7);
  assert.equal(spec.output, "app-1.4.2-unsigned.apk");
  assert.deepEqual(spec.permissions, ["android.permission.CAMERA", "android.permission.INTERNET"]);
  const bumped = await generateShell({ sourceRoot: source, entry: app, content: web, version: "1.4.2", versionCode: 8 });
  assert.notEqual(bumped.files["vibe64-shell.json"], first.files["vibe64-shell.json"]);
  assert.equal(bumped.files["package.json"], first.files["package.json"]);
});

test("a lockfile that disagrees with package.json, or none at all, blocks the shell", async (t) => {
  const { app, web } = appEntries(packagingFor());
  const refuses = async (files, pattern) => {
    const source = await temporaryFolder(t, "vibe64-shell-mismatch-");
    await writeTree(source, files);
    await assert.rejects(
      generateShell({ sourceRoot: source, entry: app, content: web, version: "1.4.2", versionCode: 1 }),
      (error) => error.code === "VIBE64_PUBLISH_BUILD_INVALID" && pattern.test(error.message),
      pattern.source
    );
  };
  await refuses(canaryFiles({ dependencies: { "@capacitor/core": "8.5.3", "@capacitor/haptics": "8.0.3" }, locked: { "@capacitor/haptics": "8.0.2" } }), /8\.0\.3 in package\.json but 8\.0\.2 in package-lock\.json/u);
  const stale = lockfile();
  delete stale.packages["node_modules/@capacitor/preferences"];
  await refuses(canaryFiles({ lock: stale }), /@capacitor\/preferences is in package\.json but not in package-lock\.json/u);
  const files = canaryFiles();
  delete files["package-lock.json"];
  await refuses(files, /needs a package-lock\.json/u);

  assert.deepEqual(nativePlugins({ manifest: { dependencies: {} }, lockfile: lockfile() }).plugins, []);
  assert.throws(() => shellFiles({ entry: app, plugins: [], version: "1.4.2", versionCode: 0 }), /build number/u);
  assert.equal(nextVersionCode(null), 1);
  assert.equal(nextVersionCode(41), 42);
  assert.throws(() => nextVersionCode(2_100_000_000), /below 2,100,000,000/u);
});

test("the Android project patch sets the app's facts and fails loudly on template drift", () => {
  const spec = {
    applicationId: "dev.vibe64.canary.notes",
    name: "Bob's \"Notes\" & more",
    version: "1.4.2",
    versionCode: 12,
    permissions: ["android.permission.CAMERA", "android.permission.INTERNET"],
    deepLinkScheme: "notes",
    appLinkDomains: ["notes.example.com"]
  };
  const gradle = patchAppBuildGradle("defaultConfig {\n        versionCode 1\n        versionName \"1.0\"\n    }\n    release {\n            minifyEnabled false\n", spec);
  assert.match(gradle, /versionCode 12\n/u);
  assert.match(gradle, /versionName "1\.4\.2"/u);
  const strings = patchStrings([
    "<resources>",
    "    <string name=\"app_name\">x</string>",
    "    <string name=\"title_activity_main\">x</string>",
    "    <string name=\"package_name\">x</string>",
    "    <string name=\"custom_url_scheme\">x</string>",
    "</resources>"
  ].join("\n"), spec);
  assert.match(strings, /<string name="app_name">Bob\\'s \\"Notes\\" &amp; more<\/string>/u);
  assert.match(strings, /<string name="custom_url_scheme">notes<\/string>/u);
  const manifest = patchManifest([
    "<manifest>",
    "        <activity android:name=\".MainActivity\">",
    "            <intent-filter>",
    "                <action android:name=\"android.intent.action.MAIN\" />",
    "                <category android:name=\"android.intent.category.LAUNCHER\" />",
    "            </intent-filter>",
    "        </activity>",
    "    <!-- Permissions -->",
    "",
    "    <uses-permission android:name=\"android.permission.INTERNET\" />",
    "</manifest>"
  ].join("\n"), spec);
  assert.equal((manifest.match(/<uses-permission /gu) || []).length, 2);
  assert.match(manifest, /android\.permission\.CAMERA/u);
  assert.match(manifest, /<data android:scheme="notes" \/>/u);
  assert.match(manifest, /<intent-filter android:autoVerify="true">[\s\S]*<data android:host="notes\.example\.com" \/>/u);
  const wrapper = patchWrapperProperties("distributionBase=GRADLE_USER_HOME\ndistributionUrl=https\\://example.invalid/gradle.zip\n");
  assert.match(wrapper, new RegExp(`distributionSha256Sum=${CAPACITOR_SHELL_TEMPLATE.gradle.distributionSha256Sum}\\n$`, "u"));
  assert.match(variablesGradle(), /targetSdkVersion = 36\n/u);
  assert.throws(() => patchAppBuildGradle("android {}", spec), /template changed: app\/build\.gradle has no versionCode/u);
  assert.throws(() => patchManifest("<manifest></manifest>", spec), /template changed/u);
});

test("icons must be 1024x1024 PNGs without transparency", () => {
  assert.deepEqual(iconProblems(pngBytes()), []);
  assert.equal(inspectPng(pngBytes()).colorType, 2);
  assert.match(iconProblems(pngBytes({ alpha: true })).join(" "), /transparency/u);
  assert.match(iconProblems(pngBytes({ width: 512, height: 512 })).join(" "), /512x512; it must be 1024x1024/u);
  assert.deepEqual(iconProblems(Buffer.from("not a png")), ["The icon is not a PNG file."]);
});

test("an app build runs Stage 1 once per package, in throwaway folders, without credentials, leaving the project clean", async (t) => {
  const project = await gitProject(t, canaryFiles());
  const toolchains = await fakeToolchains(await temporaryFolder(t, "vibe64-fake-tools-"));
  const packaging = packagingFor();
  const shells = [];
  const calls = [];
  const runCommand = async ({ command, args, cwd, env }) => {
    calls.push({ command, args, cwd, env });
    if (args.includes("build") && args[0] === "run") {
      await mkdir(path.join(cwd, "dist"), { recursive: true });
      await writeFile(path.join(cwd, "dist", "index.html"), "<h1>Notes</h1>\n");
    }
    if (args[0] === "install" && command === "npm") shells.push(await snapshot(cwd));
    if (args.at(-2) === "collect") {
      const spec = JSON.parse(await readFile(path.join(cwd, "vibe64-shell.json"), "utf8"));
      await mkdir(path.join(cwd, "out"), { recursive: true });
      await writeFile(path.join(cwd, "out", spec.output), Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("apk")]));
    }
    return { ok: true, exitCode: 0, stdout: "", stderr: "" };
  };
  const build = async (store) => buildPackage({
    projectRoot: project.root,
    commit: project.commit,
    packaging,
    packageId: "app",
    versionCode: 3,
    toolchains,
    resultStore: store,
    cacheDirectory: path.join(store, "cache")
  }, { runCommand });

  const first = await build(await temporaryFolder(t, "vibe64-app-store-"));
  assert.deepEqual(first.artifacts.manifest.files.map(({ path: file }) => file), ["app-1.4.2-unsigned.apk"]);
  assert.equal(first.check.apk, "app-1.4.2-unsigned.apk");
  const labels = calls.map(({ command, args }) => `${path.basename(command)} ${args.slice(0, 2).join(" ")}`);
  assert.deepEqual(labels.slice(0, 2), ["npm ci", "npm run build"]);
  const appCalls = calls.slice(2);
  assert.equal(appCalls.length, 6);
  assert.ok(appCalls.some(({ args }) => args.join(" ") === "--no-daemon --console=plain --quiet assembleRelease"));
  for (const call of calls) {
    assert.ok(!call.cwd.startsWith(project.root), "no build step runs in the project");
    assert.ok(!Object.keys(call.env).some((name) => /TOKEN|SECRET|PASSWORD|KEY_PASS|CREDENTIAL/u.test(name)));
  }
  assert.equal(appCalls[0].env.JAVA_HOME, toolchains.javaHome);
  assert.equal(appCalls[0].env.ANDROID_HOME, toolchains.androidHome);
  assert.match(appCalls[0].env.GRADLE_USER_HOME, /cache\/gradle$/u);
  const { stdout } = await run("git", ["-C", project.root, "status", "--porcelain", "--ignored"]);
  assert.equal(stdout, "");

  const again = await build(path.dirname(path.dirname(first.artifacts.directory)));
  assert.equal(again.artifacts.reused, true);
  assert.equal(calls.length, 8, "a finished build is reused, not rebuilt");

  await build(await temporaryFolder(t, "vibe64-app-store-"));
  assert.equal(shells.length, 2);
  assert.deepEqual(shells[0], shells[1], "the same saved commit gives byte-identical shells");
  assert.ok(shells[0]["www/index.html"] && shells[0]["icon.png"]);
});
