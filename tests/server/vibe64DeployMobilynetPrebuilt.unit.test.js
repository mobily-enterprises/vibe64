import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createMobilynetClient } from "../../packages/vibe64-deploy/src/adapters/mobilynet/client.js";
import { ENGINE_SCOPES } from "../../packages/vibe64-deploy/src/adapters/mobilynet/standIn.js";
import {
  MACHINE_SCOPES, OLD_VERSION, machineWorld, prebuiltDeclaration, prebuiltRelease, releaseKey, sha256
} from "./vibe64DeployPrebuiltHelpers.js";
import { AT, plainTarOf, settle } from "./vibe64DeployStandInHelpers.js";

// The mobilynet adapter's side of a signed release: one prebuilt release of an app a machine of the mobilynet project
// runs, sent as mobilynet's mn sends it (a plain tar of manifest.json, manifest.sig and output.tar, in that order, with
// MobilyNet-Release: prebuilt and the output's SHA-256), the machine's apps and the project's release keys read for a
// host's picker, and the stand-in taking such a release only when one of the project's release keys signed its
// manifest and the output is the one the manifest names, refusing anything else under its field in mobilynet's words.

/** A folder of its own for the test's files, removed when the test ends. */
function folderFor(t) {
  const folder = mkdtempSync(path.join(tmpdir(), "vibe64-prebuilt-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return folder;
}

/** A prebuilt release's output written to a file, as a build leaves it: `{ path, sha256, bytes }` for the adapter. */
function outputFile(folder, release) {
  const file = path.join(folder, `output-${release.outputSha256.slice(0, 8)}.tar`);
  writeFileSync(file, release.output);
  return { path: file, sha256: release.outputSha256, bytes: release.output.length };
}

/** Awaits a release the stand-in must refuse, answering the adapter's refusal. */
async function refusedRelease(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return assert.fail("the stand-in took a release it should refuse");
}

test("a prebuilt release is one plain tar of manifest.json, manifest.sig and output.tar, in mn's order, with MobilyNet-Release: prebuilt and the output's SHA-256", async (t) => {
  const asked = [];
  const fetch = async (url, init) => {
    const parts = [];
    for await (const chunk of init.body) parts.push(Buffer.from(chunk));
    asked.push({ url: new URL(String(url)), init, body: Buffer.concat(parts) });
    return new Response(JSON.stringify({
      release: { version: "20261120-1234567", state: "active" },
      build: { id: "bld_1", state: "queued" },
      app: { name: "shop", version: OLD_VERSION, wantedVersion: "20261120-1234567", state: "running" }
    }), { status: 202 });
  };
  const client = createMobilynetClient({ baseUrl: "https://api.mobilynet.test", credential: "mnk_test", fetch });
  const key = releaseKey();
  const release = prebuiltRelease({ key: key.fingerprint });
  const signature = key.sign(release.manifest);
  const output = outputFile(folderFor(t), release);

  const answer = await client.releasePrebuilt("vps_1", "shop", { manifest: release.manifest, signature: ` ${signature}\n`, output });
  assert.equal(answer.release.version, "20261120-1234567");
  assert.equal(asked.length, 1, "one request, never tried again by the client");
  const [{ url, init, body }] = asked;
  assert.deepEqual([init.method, url.pathname, url.search], ["POST", "/v1/vps/vps_1/apps/shop/releases", ""]);
  assert.equal(init.headers["content-type"], "application/x-tar");
  assert.equal(init.headers["mobilynet-release"], "prebuilt");
  assert.equal(init.headers["mobilynet-content-sha256"], release.outputSha256, "the output's SHA-256, the manifest's");
  assert.equal(init.headers.authorization, "Bearer mnk_test");
  assert.equal(init.headers["idempotency-key"], undefined, "mn sends none: the same output answers the release it made");
  assert.equal(init.redirect, "manual");
  // The bytes mn's tarMember writes for each member, in its order, the signature as one trimmed line, then the
  // archive's end.
  assert.deepEqual(body, plainTarOf({ "manifest.json": release.manifest, "manifest.sig": `${signature}\n`, "output.tar": release.output }));
});

test("the mobilynet project's machines' apps of releases, one app and the project's release keys are read as mobilynet answers them", async () => {
  const { standIn, adapter, vps, key, projectId } = machineWorld();
  const db = standIn.machines.add(projectId, { name: "db1" });
  standIn.machines.addApp(db, { name: "postgresql", package: "postgresql-18" });
  standIn.machines.addApp(db, { name: "admin", version: "20261102-bbbbbbb" });
  const gone = standIn.machines.add(projectId, { name: "old1", state: "destroyed" });
  standIn.machines.addApp(gone, { name: "shop", version: OLD_VERSION });

  // Each app of releases on each machine not destroyed, by machine then app: a catalogue package's app takes none.
  assert.deepEqual(await adapter.listVpsApps(), [
    { vps: { id: db, name: "db1", state: "running", region: "us" }, app: { name: "admin", version: "20261102-bbbbbbb", state: "running" } },
    { vps: { id: vps, name: "web1", state: "running", region: "us" }, app: { name: "shop", version: OLD_VERSION, state: "running" } }
  ]);
  assert.deepEqual(await adapter.readVpsApp({ vps, app: "shop" }), {
    name: "shop", package: null, version: OLD_VERSION, wantedVersion: null, previousVersion: null, state: "running", lastFailure: null,
    changedAt: AT.toISOString()
  });
  assert.equal(await adapter.readVpsApp({ vps, app: "blog" }), null, "an app the machine doesn't run is none");
  assert.equal(await adapter.readVpsApp({ vps: "vps_unknown", app: "shop" }), null, "nor one of a machine the project hasn't");
  assert.deepEqual(await adapter.listReleaseKeys(), [
    { name: "Release key", fingerprint: key.fingerprint, publicKey: key.publicKey, createdBy: "owner@example.com", createdAt: AT.toISOString() }
  ]);
  // Reads only, each needing vps:read.
  assert.deepEqual([...new Set(standIn.requests().map(({ method, path: asked }) => `${method} ${asked.replace(/^\/v1\/vps\/[^/]+/u, "/v1/vps/{vps}")}`))].sort(), [
    `GET /v1/projects/${projectId}/release-keys`,
    `GET /v1/projects/${projectId}/vps`,
    "GET /v1/vps/{vps}/apps",
    "GET /v1/vps/{vps}/apps/blog",
    "GET /v1/vps/{vps}/apps/shop"
  ]);
  assert.deepEqual(standIn.requests().find((one) => one.path === `/v1/projects/${projectId}/vps`).query.destroyed, ["false"]);

  const reader = machineWorld({ scopes: ENGINE_SCOPES });
  await assert.rejects(reader.adapter.listReleaseKeys(), (error) => error.status === 403 && error.code === "scope_missing" && error.details?.scope === "vps:read");
});

test("a release one of the project's keys signed is taken at once, its app moves to it, and the same output again answers the same release", async (t) => {
  const { standIn, adapter, vps, key } = machineWorld();
  const release = prebuiltRelease({ key: key.fingerprint });
  const asked = { vps, app: "shop", manifest: release.manifest, signature: key.sign(release.manifest), output: outputFile(folderFor(t), release) };

  const taken = await adapter.releasePrebuilt(asked);
  const version = `${AT.toISOString().slice(0, 10).replace(/-/gu, "")}-${release.outputSha256.slice(0, 7)}`;
  assert.equal(taken.version, version);
  assert.equal(taken.app.wantedVersion, version, "the app moves to it once its output is checked");
  assert.equal(taken.app.version, OLD_VERSION, "and runs the one it ran meanwhile");
  settle(standIn);
  assert.deepEqual(await adapter.readVpsApp({ vps, app: "shop" }), {
    name: "shop", package: null, version, wantedVersion: null, previousVersion: OLD_VERSION, state: "running", lastFailure: null,
    changedAt: AT.toISOString()
  });
  assert.equal((await adapter.releasePrebuilt(asked)).version, version, "the same output answers the release it made");
  const uploads = standIn.requests().filter((one) => one.method !== "GET");
  assert.deepEqual(uploads.map((one) => [one.method, one.path, one.status, one.body]), [
    ["POST", `/v1/vps/${vps}/apps/shop/releases`, 202, { upload: release.outputSha256, release: "prebuilt" }],
    ["POST", `/v1/vps/${vps}/apps/shop/releases`, 202, { upload: release.outputSha256, release: "prebuilt" }]
  ]);

  const writer = machineWorld({ scopes: [...ENGINE_SCOPES, MACHINE_SCOPES[0]] });
  const other = prebuiltRelease({ key: writer.key.fingerprint });
  const error = await refusedRelease(writer.adapter.releasePrebuilt({
    vps: writer.vps, app: "shop", manifest: other.manifest, signature: writer.key.sign(other.manifest), output: outputFile(folderFor(t), other)
  }));
  assert.deepEqual([error.status, error.code, error.details?.scope], [403, "scope_missing", "vps:manage"]);
});

test("the stand-in refuses another key's signature, and each other prebuilt check, under its field in mobilynet's words, changing nothing", async (t) => {
  const { standIn, adapter, vps, key, projectId } = machineWorld();
  const folder = folderFor(t);
  const release = prebuiltRelease({ key: key.fingerprint });
  const output = outputFile(folder, release);
  const asked = (more) => ({ vps, app: "shop", manifest: release.manifest, signature: key.sign(release.manifest), output, ...more });
  const refusal = async (more) => {
    const error = await refusedRelease(adapter.releasePrebuilt(asked(more)));
    return { status: error.status, code: error.code, field: error.field, message: error.message, retryable: error.retryable };
  };
  const words = (field, message) => ({ status: 422, code: "prebuilt_refused", field, message, retryable: false });

  // Another key's signature: the project's keys are tried, and none made it.
  const stranger = releaseKey();
  const strangers = prebuiltRelease({ key: stranger.fingerprint });
  const foreign = await refusal({ manifest: strangers.manifest, signature: stranger.sign(strangers.manifest), output: outputFile(folder, strangers) });
  assert.deepEqual(foreign, words("signature", `The release isn't signed by any of the project's release keys (${key.fingerprint.slice(0, 12)}): `
    + `The release isn't signed by the key ${key.fingerprint}.`));
  // A manifest changed after it was signed, or a signature of the project's key over another manifest.
  const changed = Buffer.from(release.manifest.toString("utf8").replace("\"storePaths\": []", "\"storePaths\": [] "));
  assert.equal((await refusal({ manifest: changed })).field, "signature");
  // No signature, or one that isn't an Ed25519 signature in base64.
  assert.deepEqual(await refusal({ signature: "" }), words("signature", "The release carries no signature: an Ed25519 signature, base64."));
  assert.deepEqual(await refusal({ signature: "not a signature" }), words("signature", "The release carries no signature: an Ed25519 signature, base64."));
  // A manifest naming another key than the one that signed it.
  const misnamed = prebuiltRelease({ key: stranger.fingerprint });
  assert.deepEqual(await refusal({ manifest: misnamed.manifest, signature: key.sign(misnamed.manifest), output: outputFile(folder, misnamed) }),
    words("signature", `The manifest names the key ${stranger.fingerprint}, not ${key.fingerprint}.`));
  // A manifest that isn't one.
  const notManifest = Buffer.from("{\"format\":\"something-else\"}");
  assert.equal((await refusal({ manifest: notManifest, signature: key.sign(notManifest) })).field, "manifest");
  // A MobilyNet-Content-SHA256 that isn't the manifest's output's; an output of another size than the manifest's; and
  // another output of the same size.
  const larger = prebuiltRelease({ key: key.fingerprint, release: "2".repeat(700) });
  assert.deepEqual(await refusal({ output: { ...output, sha256: larger.outputSha256 } }),
    words("upload", `MobilyNet-Content-SHA256 is ${larger.outputSha256}; the manifest names the output ${release.outputSha256}.`));
  assert.deepEqual(await refusal({ output: { ...outputFile(folder, larger), sha256: release.outputSha256 } }),
    words("output", `output.tar is ${larger.output.length} bytes; its manifest names ${release.output.length}.`));
  const sameSize = prebuiltRelease({ key: key.fingerprint, release: "3" });
  assert.equal(sameSize.output.length, release.output.length);
  assert.equal((await refusal({ output: { ...outputFile(folder, sameSize), sha256: release.outputSha256 } })).field, "output");
  // A declaration that isn't the one the manifest names, or one that runs a build.
  const swapped = prebuiltRelease({ key: key.fingerprint, manifest: { declaration: { sha256: sha256("another") } } });
  assert.equal((await refusal({ manifest: swapped.manifest, signature: key.sign(swapped.manifest) })).field, "declaration");
  const building = prebuiltRelease({ key: key.fingerprint, declaration: { ...prebuiltDeclaration(), build: { command: "npm run build", output: ["."] } } });
  assert.deepEqual(await refusal({ manifest: building.manifest, signature: key.sign(building.manifest), output: outputFile(folder, building) }),
    words("declaration.build", "A prebuilt release runs no build: its build is { \"output\": [\".\"] } alone, with no setup, command, packages, settings or cache."));
  const blog = prebuiltRelease({ key: key.fingerprint, declaration: prebuiltDeclaration("blog") });
  assert.equal((await refusal({ manifest: blog.manifest, signature: key.sign(blog.manifest), output: outputFile(folder, blog) })).field, "declaration.name");

  // Nothing changed: the app runs what it ran, moving nowhere, and no release was made.
  settle(standIn);
  const app = await adapter.readVpsApp({ vps, app: "shop" });
  assert.deepEqual([app.version, app.wantedVersion, app.lastFailure], [OLD_VERSION, null, null]);
  assert.deepEqual(standIn.releases(projectId, "shop"), []);

  // A project with no release key refuses every prebuilt release, saying where one is added.
  const bare = machineWorld();
  bare.standIn.removeReleaseKey(bare.projectId, bare.key.fingerprint);
  const unkeyed = prebuiltRelease({ key: bare.key.fingerprint });
  const none = await refusedRelease(bare.adapter.releasePrebuilt({
    vps: bare.vps, app: "shop", manifest: unkeyed.manifest, signature: bare.key.sign(unkeyed.manifest), output: outputFile(folder, unkeyed)
  }));
  assert.deepEqual([none.field, none.message], ["signature", "The project has no release key: an owner or admin adds one first, in the customer area."]);
});

test("a release whose check fails on the machine is switched back by its host: the app runs the version before, saying why", async (t) => {
  const { standIn, adapter, vps, key } = machineWorld();
  standIn.faults.switchBack = { code: "check_failed", message: "The check exited with status 1. Its output's last line: database unreachable" };
  const release = prebuiltRelease({ key: key.fingerprint });
  const taken = await adapter.releasePrebuilt({ vps, app: "shop", manifest: release.manifest, signature: key.sign(release.manifest), output: outputFile(folderFor(t), release) });
  settle(standIn);
  const app = await adapter.readVpsApp({ vps, app: "shop" });
  assert.notEqual(taken.version, OLD_VERSION);
  assert.deepEqual([app.version, app.wantedVersion, app.state], [OLD_VERSION, null, "running"]);
  assert.deepEqual(app.lastFailure, { code: "check_failed", message: "The check exited with status 1. Its output's last line: database unreachable", step: "check", at: AT.toISOString() });
});

test("the adapter reads a prebuilt manifest's key, output and declaration as mobilynet names them, and refuses one that isn't mobilynet's", () => {
  const { adapter, key } = machineWorld();
  const release = prebuiltRelease({ key: key.fingerprint });
  const declared = JSON.parse(release.manifest.toString("utf8")).declaration;
  assert.deepEqual(adapter.readReleaseManifest(release.manifest), {
    key: key.fingerprint, output: { sha256: release.outputSha256, bytes: release.output.length }, declaration: declared
  });
  for (const wrong of [
    "not json", "[]", JSON.stringify({ format: "mobilynet-release-manifest-2", key: key.fingerprint, output: { sha256: release.outputSha256, bytes: 1 } }),
    JSON.stringify({ format: "mobilynet-release-manifest-1", key: "ABC", output: { sha256: release.outputSha256, bytes: 1 } }),
    JSON.stringify({ format: "mobilynet-release-manifest-1", key: key.fingerprint, output: { sha256: "x", bytes: 1 } }),
    JSON.stringify({ format: "mobilynet-release-manifest-1", key: key.fingerprint, output: { sha256: release.outputSha256, bytes: 0 } }),
    JSON.stringify({ format: "mobilynet-release-manifest-1", key: key.fingerprint, output: { sha256: release.outputSha256, bytes: 1 }, declaration: { sha256: "y" } })
  ]) {
    assert.throws(() => adapter.readReleaseManifest(Buffer.from(wrong)), (error) => {
      assert.equal(error.code, "prebuilt_manifest_invalid", error.message);
      assert.match(error.message, /^A prebuilt release's manifest is JSON of format mobilynet-release-manifest-1, naming its key's fingerprint, its output's SHA-256 and size in bytes, and its declaration's SHA-256/u);
      return true;
    }, wrong);
  }
});
