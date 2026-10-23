// Android toolchains: the SDK licence is shown, never accepted on the person's
// behalf; installs refuse without their recorded acceptance of the current text;
// downloads keep nothing that fails its pinned checksum.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  androidSdkLicence,
  describeAndroidSdk,
  installAndroidSdk,
  licenceFromRepository
} from "../../packages/vibe64-packaging/src/server/toolchains/androidSdk.js";
import { downloadVerified } from "../../packages/vibe64-packaging/src/server/toolchains/download.js";
import { describeJdk, findJdk } from "../../packages/vibe64-packaging/src/server/toolchains/jdk.js";
import { fakeToolchains } from "./packagingAndroidTestTools.js";
import { temporaryFolder } from "./packagingRegistryTestTools.js";

const LICENCE = "Terms &amp; Conditions\n\n1. You &lt;must&gt; read this.\n";
const REPOSITORY = `<?xml version="1.0"?><repo><license id="android-sdk-license" type="text">${LICENCE}</license>`
  + "<license id=\"android-sdk-preview-license\" type=\"text\">Preview</license></repo>";

function fetchStub(routes, seen = []) {
  return async (url) => {
    seen.push(url);
    const body = routes[url];
    if (body === undefined) return new Response("missing", { status: 404 });
    return new Response(body, { status: 200 });
  };
}

test("the SDK licence is the repository's exact text with a stable hash", async () => {
  const licence = licenceFromRepository(REPOSITORY);
  assert.equal(licence.id, "android-sdk-license");
  assert.equal(licence.text, "Terms & Conditions\n\n1. You <must> read this.");
  assert.equal(licence.hash, `sha256:${createHash("sha256").update(licence.text).digest("hex")}`);
  assert.deepEqual(licence.packages, ["platforms;android-36", "build-tools;35.0.0"]);
  assert.equal(licence.termsUrl, "https://developer.android.com/studio/terms");
  const fetched = await androidSdkLicence({ fetchImpl: fetchStub({ "https://repo.invalid/r.xml": REPOSITORY }), repositoryUrl: "https://repo.invalid/r.xml" });
  assert.deepEqual(fetched, licence);
  assert.throws(() => licenceFromRepository("<repo/>"), /has no android-sdk-license text/u);
});

test("installing the SDK refuses without the person's acceptance of the current text, before downloading anything", async (t) => {
  const directory = await temporaryFolder(t, "vibe64-sdk-");
  const javaHome = (await fakeToolchains(await temporaryFolder(t, "vibe64-fake-tools-"))).javaHome;
  const { hash } = licenceFromRepository(REPOSITORY);
  const attempt = async (acceptance) => {
    const seen = [];
    await assert.rejects(
      installAndroidSdk({ directory, javaHome, acceptance, repositoryUrl: "https://repo.invalid/r.xml" }, {
        fetchImpl: fetchStub({ "https://repo.invalid/r.xml": REPOSITORY }, seen),
        runCommand: async () => { throw new Error("no tool may run"); }
      }),
      (error) => error.code === "VIBE64_PUBLISH_LICENCE_NOT_ACCEPTED"
    );
    assert.deepEqual(seen, ["https://repo.invalid/r.xml"], "only the licence was fetched");
  };
  await attempt(undefined);
  await attempt({ id: "android-sdk-license", hash: "sha256:" + "0".repeat(64), acceptedBy: "ada", acceptedAt: "2026-10-23T00:00:00Z" });
  await attempt({ id: "android-sdk-preview-license", hash, acceptedBy: "ada", acceptedAt: "2026-10-23T00:00:00Z" });
  await attempt({ id: "android-sdk-license", hash, acceptedBy: "", acceptedAt: "2026-10-23T00:00:00Z" });
  assert.deepEqual(await readdir(directory), []);
});

test("downloads land only when their pinned checksum matches", async (t) => {
  const directory = await temporaryFolder(t, "vibe64-downloads-");
  const bytes = Buffer.from("toolchain bytes");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const fetchImpl = fetchStub({ "https://dl.invalid/tool.zip": bytes });
  await assert.rejects(
    downloadVerified({ url: "https://dl.invalid/tool.zip", file: "tool.zip", sha256: "f".repeat(64) }, directory, { fetchImpl }),
    (error) => error.code === "VIBE64_PUBLISH_TOOLCHAIN_FAILED" && /does not match its pinned checksum/u.test(error.message)
  );
  assert.deepEqual(await readdir(directory), []);
  await assert.rejects(
    downloadVerified({ url: "https://dl.invalid/tool.zip", file: "tool.zip", sha256, size: 3 }, directory, { fetchImpl }),
    /larger than expected/u
  );
  assert.deepEqual(await readdir(directory), []);
  const file = await downloadVerified({ url: "https://dl.invalid/tool.zip", file: "tool.zip", sha256, size: bytes.length }, directory, { fetchImpl });
  assert.equal(file, path.join(directory, "tool.zip"));
  assert.equal((await stat(file)).size, bytes.length);
  assert.equal(await downloadVerified({ url: "https://dl.invalid/gone", file: "tool.zip", sha256 }, directory, { fetchImpl: fetchStub({}) }), file);
});

test("toolchain descriptions say what is missing", async (t) => {
  const { javaHome, androidHome } = await fakeToolchains(await temporaryFolder(t, "vibe64-fake-tools-"));
  assert.deepEqual(await describeJdk({ javaHome }), { ok: true, javaHome, version: "21.0.9", major: 21, message: "Java 21.0.9." });
  assert.equal((await describeJdk({ javaHome: path.join(javaHome, "missing") })).ok, false);
  assert.equal((await findJdk({ directory: null, baseEnvironment: { JAVA_HOME: javaHome, PATH: "/nonexistent" } })).javaHome, javaHome);
  assert.equal((await describeAndroidSdk({ androidHome })).ok, true);
  const empty = await describeAndroidSdk({ androidHome: path.join(androidHome, "none") });
  assert.deepEqual(empty.missing, ["platforms;android-36", "build-tools;35.0.0"]);
});
