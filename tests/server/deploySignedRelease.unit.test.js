import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createMobilynetAdapter } from "../../packages/vibe64-deploy/src/adapters/mobilynet/index.js";
import { createMobilynetClient } from "../../packages/vibe64-deploy/src/adapters/mobilynet/client.js";
import { ENGINE_SCOPES } from "../../packages/vibe64-deploy/src/adapters/mobilynet/standIn.js";
import { SIGNED_RELEASE_RECORD_FORMAT, manifestOf, signedRelease } from "../../packages/vibe64-deploy/src/signedRelease.js";
import { MACHINE_SCOPES, OLD_VERSION, machineWorld, prebuiltRelease, releaseKey } from "./vibe64DeployPrebuiltHelpers.js";
import { plainTarOf } from "./vibe64DeployStandInHelpers.js";

// A Production the Stack releases as a signed release (`- Signed release `name`: `command`...`): the engine runs the
// command at the saved commit through the host's runner, which leaves output.tar and manifest.json; checks them against
// the release key the person chose; waits, its record kept, for the key's holder to sign the manifest where the key is
// and paste the signature; then hands the app the person chose, on a machine of the mobilynet project, that one signed
// prebuilt release, and follows the app until it runs it, or its host switches it back. Vibe64 never holds the key, and
// a signed release makes nothing else at the provider: no App Service, hosted service, link or setting.

const SIGNED = Object.freeze({ name: "Control plane release", argv: ["sh", "release/signed-release.sh"] });
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const NEXT_COMMIT = "fedcba9876543210fedcba9876543210fedcba98";

/** A folder of its own for the test's releases, removed when the test ends. */
function folderFor(t) {
  const folder = mkdtempSync(path.join(tmpdir(), "vibe64-signed-release-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return folder;
}

/**
 * The stand-in with the shop's machine and release key, its client's bodies kept as sent (a prebuilt release's
 * streamed tar read whole), and the host's parts the engine is given: the runner that runs the release's command at a
 * commit (here, writing the release mobilynet's tools would, its manifest naming V64_RELEASE_KEY, into a folder of
 * its own), the record's store, and the report.
 * @param {import("node:test").TestContext} t @param {{ write?: (dir: string, release: any) => void }} [options]
 */
function signedWorld(t, { write } = {}) {
  const world = machineWorld();
  const { standIn, projectId } = world;
  const sent = [];
  const fetch = async (url, init = {}) => {
    let { body } = init;
    if (typeof body?.[Symbol.asyncIterator] === "function") {
      const parts = [];
      for await (const chunk of body) parts.push(Buffer.from(chunk));
      body = Buffer.concat(parts);
      sent.push({ path: new URL(String(url)).pathname, body });
    }
    return standIn.fetch(url, { ...init, body });
  };
  const token = standIn.addKey({ projectId, scopes: [...ENGINE_SCOPES, ...MACHINE_SCOPES] });
  const adapter = createMobilynetAdapter({ client: createMobilynetClient({ baseUrl: standIn.baseUrl, credential: token, fetch }), project: projectId });
  const folder = folderFor(t);
  const builds = [];
  const releases = [];
  const build = async ({ argv, commit, env, log }) => {
    builds.push({ argv, commit, env: { ...env } });
    const releaseDir = mkdtempSync(path.join(folder, "release-"));
    const release = prebuiltRelease({ key: env.V64_RELEASE_KEY, release: commit });
    releases.push(release);
    log("Built the shop's output.");
    (write ?? ((dir, made) => {
      writeFileSync(path.join(dir, "output.tar"), made.output);
      writeFileSync(path.join(dir, "manifest.json"), made.manifest);
    }))(releaseDir, release);
    return { releaseDir };
  };
  const kept = { record: null };
  // What a restarted editor reads back: the record as it was saved, through JSON.
  const save = (record) => {
    kept.record = JSON.parse(JSON.stringify(record));
  };
  const events = [];
  const report = (event) => events.push(event);
  const parts = { adapter, release: SIGNED, save, build, report, pause: () => standIn.advance() };
  return { ...world, adapter, sent, builds, releases, kept, events, parts };
}

/** What the engine asked mobilynet to change: every request but a read. */
const writes = (standIn) => standIn.requests().filter((one) => one.method !== "GET").map((one) => [one.method, one.path, one.status, one.body]);

/** Awaits a call the engine must refuse, answering the refusal. */
async function refused(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return assert.fail("the engine went on where it should refuse");
}

test("a signed release is built at the saved commit, waits for its signature through a restart, and is handed to the chosen app as one prebuilt release, making nothing else", async (t) => {
  const { standIn, vps, key, sent, builds, releases, kept, events, parts } = signedWorld(t);
  const target = { vps, app: "shop" };

  const built = await signedRelease({ ...parts, record: null, start: { commit: COMMIT, target, key: key.fingerprint } });
  const [made] = releases;
  const waiting = { kind: "signature", manifest: { sha256: made.manifestSha256, bytes: made.manifest.length }, key: key.fingerprint };
  assert.equal(built.outcome, "signature");
  assert.deepEqual(built.waiting, waiting);
  assert.deepEqual(builds, [{ argv: SIGNED.argv, commit: COMMIT, env: { V64_COMMIT: COMMIT, V64_RELEASE_KEY: key.fingerprint } }]);
  assert.deepEqual(kept.record, built.record, "the record is saved as it stands");
  assert.equal(kept.record.format, SIGNED_RELEASE_RECORD_FORMAT);
  assert.deepEqual(kept.record.releases.map(({ name, commit, target: where, key: chosen, state, version }) => ({ name, commit, target: where, key: chosen, state, version })), [
    { name: SIGNED.name, commit: COMMIT, target, key: key.fingerprint, state: "signature", version: null }
  ]);
  assert.deepEqual(writes(standIn), [], "nothing is sent before the signature");
  // The manifest the person downloads and signs where the key is.
  const manifest = await manifestOf(kept.record);
  assert.deepEqual(manifest, { fileName: `shop-${COMMIT.slice(0, 12)}.manifest.json`, bytes: made.manifest, sha256: made.manifestSha256 });

  // The editor restarts: the saved record still waits for the signature, building nothing again.
  const restarted = await signedRelease({ ...parts, record: kept.record });
  assert.deepEqual([restarted.outcome, restarted.waiting], ["signature", waiting]);
  assert.equal(builds.length, 1);

  // The pasted signature, with the spaces and line end a paste brings: the release is handed over, and the app is
  // followed for one read, then, after another restart, until it runs the release.
  const signature = key.sign(made.manifest);
  const handed = await signedRelease({ ...parts, record: kept.record, signature: `  ${signature}\r\n`, maxReads: 1 });
  assert.equal(handed.outcome, "following");
  const followed = await signedRelease({ ...parts, record: kept.record });
  assert.equal(followed.outcome, "live");
  const version = followed.record.releases.at(-1).version;
  assert.match(version, new RegExp(`^\\d{8}-${made.outputSha256.slice(0, 7)}$`, "u"));
  assert.equal(followed.record.releases.at(-1).state, "live");
  const app = standIn.machines.app(vps, "shop");
  assert.deepEqual([app.version, app.previousVersion, app.wantedVersion], [version, OLD_VERSION, null]);

  // Exactly one write: the prebuilt release of the named machine's app, carrying the manifest and the pasted signature.
  assert.deepEqual(writes(standIn), [["POST", `/v1/vps/${vps}/apps/shop/releases`, 202, { upload: made.outputSha256, release: "prebuilt" }]]);
  assert.deepEqual(sent, [{
    path: `/v1/vps/${vps}/apps/shop/releases`,
    body: plainTarOf({ "manifest.json": made.manifest, "manifest.sig": `${signature}\n`, "output.tar": made.output })
  }]);
  assert.deepEqual([standIn.services.all(), standIn.hosted.all()], [[], []], "no App Service or hosted service");
  // It said what it did as it went, and ended live.
  assert.deepEqual(events.filter((one) => one.kind === "step").map((one) => `${one.step}:${one.phase}`), [
    "build:start", "build:done", "release:start", "release:done", "follow:start", "follow:start", "follow:done"
  ]);
  assert.deepEqual(events.filter((one) => one.kind === "output").map((one) => one.text), ["Built the shop's output."]);
  assert.deepEqual(events.filter((one) => one.kind === "end").map((one) => one.outcome), ["signature", "signature", "following", "live"]);

  // The same release isn't handed over twice: with nothing waiting, a signature is refused.
  const again = await refused(signedRelease({ ...parts, record: kept.record, signature }));
  assert.deepEqual([again.code, again.status], ["production_signed_release_nothing", 409]);
});

test("a signature mobilynet refuses fails the release in mobilynet's words, a signature that isn't one is refused before anything is sent, and a switch-back ends failed", async (t) => {
  const { standIn, vps, key, releases, kept, parts } = signedWorld(t);
  const target = { vps, app: "shop" };
  await signedRelease({ ...parts, record: null, start: { commit: COMMIT, target, key: key.fingerprint } });

  // Not an Ed25519 signature in base64: refused, nothing sent, still waiting.
  for (const wrong of ["", "not a signature", "A".repeat(87), `${"A".repeat(86)}=`]) {
    const error = await refused(signedRelease({ ...parts, record: kept.record, signature: wrong }));
    assert.deepEqual([error.code, error.status], ["production_signed_release_signature_invalid", 422], wrong);
    assert.match(error.message, /^The signature is one line of 88 base64 characters ending in ==, as signing the manifest with the release key prints it\./u);
  }
  assert.equal(kept.record.releases.at(-1).state, "signature");
  assert.deepEqual(writes(standIn), []);

  // Another key's signature: mobilynet refuses it under `signature`, and the release fails with its words.
  const stranger = releaseKey();
  const failed = await signedRelease({ ...parts, record: kept.record, signature: stranger.sign(releases[0].manifest) });
  const words = `The release isn't signed by any of the project's release keys (${key.fingerprint.slice(0, 12)}): `
    + `The release isn't signed by the key ${key.fingerprint}.`;
  assert.deepEqual([failed.outcome, failed.message], ["failed", `mobilynet refused the release: ${words}`]);
  assert.deepEqual([kept.record.releases.at(-1).state, kept.record.releases.at(-1).message], ["failed", `mobilynet refused the release: ${words}`]);
  assert.equal(standIn.machines.app(vps, "shop").version, OLD_VERSION, "the app runs what it ran");

  // A release whose check fails on the machine: its host switches the app back, and the release ends failed, saying why.
  standIn.faults.switchBack = { code: "check_failed", message: "The check exited with status 1. Its output's last line: database unreachable" };
  await signedRelease({ ...parts, record: kept.record, start: { commit: NEXT_COMMIT, target, key: key.fingerprint } });
  const back = await signedRelease({ ...parts, record: kept.record, signature: key.sign(releases[1].manifest) });
  const why = `Switched back to ${OLD_VERSION}: The check exited with status 1. Its output's last line: database unreachable`;
  assert.deepEqual([back.outcome, back.message], ["failed", why]);
  assert.deepEqual(kept.record.releases.map((one) => one.state), ["failed", "failed"]);
  assert.match(kept.record.releases.at(-1).version, /^\d{8}-[0-9a-f]{7}$/u, "the release it made is kept");
  assert.equal(standIn.machines.app(vps, "shop").version, OLD_VERSION);
});

test("a release mobilynet doesn't answer is sent again until it does, the same output answering the release it made", async (t) => {
  const { standIn, vps, key, releases, kept, parts } = signedWorld(t);
  await signedRelease({ ...parts, record: null, start: { commit: COMMIT, target: { vps, app: "shop" }, key: key.fingerprint } });
  standIn.faults.down = true;
  const unanswered = await signedRelease({ ...parts, record: kept.record, signature: key.sign(releases[0].manifest) });
  assert.equal(unanswered.outcome, "following");
  assert.match(unanswered.message, /^mobilynet did not answer: .+ It is sent again when the release is next read\.$/u);
  assert.equal(kept.record.releases.at(-1).state, "releasing");
  standIn.faults.down = false;
  const live = await signedRelease({ ...parts, record: kept.record });
  assert.equal(live.outcome, "live");
  assert.equal(writes(standIn).length, 1);
});

test("a release to a machine whose host agent takes no prebuilt release yet is sent once and fails in mobilynet's words", async (t) => {
  const { standIn, vps, key, releases, kept, parts } = signedWorld(t);
  await signedRelease({ ...parts, record: null, start: { commit: COMMIT, target: { vps, app: "shop" }, key: key.fingerprint } });
  standIn.faults.hostNotUpdated = true;
  const ended = await signedRelease({ ...parts, record: kept.record, signature: key.sign(releases[0].manifest) });
  const words = "mobilynet refused the release: Its server runs an older host agent, which does this once MobilyNet updates it.";
  assert.deepEqual([ended.outcome, ended.message], ["failed", words]);
  assert.deepEqual([kept.record.releases.at(-1).state, kept.record.releases.at(-1).message], ["failed", words]);
  // One upload of the output, never repeated while the machine's server can't take it.
  assert.deepEqual(writes(standIn), [["POST", `/v1/vps/${vps}/apps/shop/releases`, 409, { upload: releases[0].outputSha256, release: "prebuilt" }]]);
  assert.equal(standIn.machines.app(vps, "shop").version, OLD_VERSION);
});

test("a signed release starts only for the Stack's line, one of the project's release keys and an app of releases a machine runs, and fails a build whose files aren't the release", async (t) => {
  const { standIn, vps, key, builds, kept, parts } = signedWorld(t);
  const target = { vps, app: "shop" };
  const start = { commit: COMMIT, target, key: key.fingerprint };
  const refusal = async (asked) => {
    const error = await refused(signedRelease({ ...parts, record: null, ...asked }));
    return [error.code, error.status];
  };
  assert.deepEqual(await refusal({ release: null, start }), ["production_signed_release_unconfigured", 409]);
  for (const wrong of [{ ...start, commit: "main" }, { ...start, target: { vps } }, { ...start, key: "" }]) {
    assert.deepEqual(await refusal({ start: wrong }), ["production_signed_release_start_invalid", 422]);
  }
  assert.deepEqual(await refusal({ start: { ...start, key: releaseKey().fingerprint } }), ["production_signed_release_key_unknown", 422]);
  const db = standIn.machines.add(standIn.projectId, { name: "db1" });
  standIn.machines.addApp(db, { name: "postgresql", package: "postgresql-18" });
  for (const where of [{ vps, app: "blog" }, { vps: "vps_unknown", app: "shop" }, { vps: db, app: "postgresql" }]) {
    assert.deepEqual(await refusal({ start: { ...start, target: where } }), ["production_signed_release_target_missing", 404], JSON.stringify(where));
  }
  assert.equal(builds.length, 0, "nothing is built for a release refused");

  // A second start replaces a release still waiting for its signature; one being handed over can't be replaced.
  await signedRelease({ ...parts, record: null, start });
  await signedRelease({ ...parts, record: kept.record, start: { ...start, commit: NEXT_COMMIT } });
  assert.deepEqual(kept.record.releases.map((one) => [one.commit, one.state]), [[COMMIT, "replaced"], [NEXT_COMMIT, "signature"]]);
  standIn.faults.down = true;
  await signedRelease({ ...parts, record: kept.record, signature: key.sign((await manifestOf(kept.record)).bytes) });
  standIn.faults.down = false;
  const busy = await refused(signedRelease({ ...parts, record: kept.record, start }));
  assert.deepEqual([busy.code, busy.status], ["production_signed_release_busy", 409]);

  // The command must leave mobilynet's release, of the key the person chose: anything else fails it before signing.
  const other = releaseKey();
  for (const [write, pattern] of [
    [() => {}, /^The release's command left no manifest\.json in V64_RELEASE_DIR\.$/u],
    [(dir, made) => writeFileSync(path.join(dir, "manifest.json"), made.manifest), /^The release's command left no output\.tar in V64_RELEASE_DIR\.$/u],
    [(dir, made) => {
      writeFileSync(path.join(dir, "output.tar"), made.output);
      writeFileSync(path.join(dir, "manifest.json"), "{\"format\":\"something-else\"}");
    }, /^A prebuilt release's manifest is JSON of format mobilynet-release-manifest-1/u],
    [(dir, made) => {
      writeFileSync(path.join(dir, "output.tar"), made.output);
      writeFileSync(path.join(dir, "manifest.json"), prebuiltRelease({ key: other.fingerprint, release: COMMIT }).manifest);
    }, (chosen) => new RegExp(`^The manifest names the key ${other.fingerprint.slice(0, 12)}, not the release key you chose \\(${chosen.slice(0, 12)}\\)\\.$`, "u")],
    [(dir, made) => {
      writeFileSync(path.join(dir, "output.tar"), Buffer.concat([made.output, Buffer.alloc(512)]));
      writeFileSync(path.join(dir, "manifest.json"), made.manifest);
    }, /^output\.tar is \d+ bytes with the SHA-256 [0-9a-f]{64}; its manifest names \d+ bytes with [0-9a-f]{64}\.$/u],
    [() => {
      throw new Error("release/signed-release.sh exited with status 2");
    }, /^The release's command failed: release\/signed-release\.sh exited with status 2$/u]
  ]) {
    const broken = signedWorld(t, { write });
    const ended = await signedRelease({ ...broken.parts, record: null, start: { commit: COMMIT, target: { vps: broken.vps, app: "shop" }, key: broken.key.fingerprint } });
    assert.equal(ended.outcome, "failed");
    // Each broken build is in a world of its own, with the release key chosen there.
    assert.match(ended.message, typeof pattern === "function" ? pattern(broken.key.fingerprint) : pattern);
    assert.equal(broken.kept.record.releases.at(-1).state, "failed");
    assert.deepEqual(writes(broken.standIn), []);
  }

  // A release whose files are gone when its signature comes is built again by a new start: it fails, naming that.
  const gone = signedWorld(t);
  await signedRelease({ ...gone.parts, record: null, start: { commit: COMMIT, target: { vps: gone.vps, app: "shop" }, key: gone.key.fingerprint } });
  rmSync(gone.kept.record.releases.at(-1).releaseDir, { recursive: true, force: true });
  const lost = await signedRelease({ ...gone.parts, record: gone.kept.record, signature: gone.key.sign(gone.releases[0].manifest) });
  assert.deepEqual([lost.outcome, lost.message], ["failed", "The release's files are gone from the machine that built it: build it again."]);
  assert.deepEqual(writes(gone.standIn), []);
});

test("a release is followed as its machine says: a restart it waits for is said once, a read that fails is made again, and an app that failed or is gone ends it failed", async (t) => {
  const { adapter, vps, key, releases, kept, events, parts } = signedWorld(t);
  assert.equal(await manifestOf(null), null, "no record, no manifest");
  await signedRelease({ ...parts, record: null, start: { commit: COMMIT, target: { vps, app: "shop" }, key: key.fingerprint } });
  await signedRelease({ ...parts, record: kept.record, signature: key.sign(releases[0].manifest), maxReads: 1 });
  assert.equal(await manifestOf(kept.record), null, "none waits for its signature once it is handed over");
  const following = structuredClone(kept.record);
  const { version } = following.releases.at(-1);
  // The app as its machine answers, read after read (an Error a read that fails), the last answer kept.
  const answering = (answers) => {
    let read = 0;
    return Object.freeze({
      ...adapter,
      readVpsApp: async () => {
        const answer = answers[Math.min(read, answers.length - 1)];
        read += 1;
        if (answer instanceof Error) throw answer;
        return answer;
      }
    });
  };
  const moving = { name: "shop", package: null, version: OLD_VERSION, wantedVersion: version, previousVersion: null, state: "running", lastFailure: null, changedAt: null };
  const restart = { ...moving, lastFailure: { code: "reboot_needed", message: "The machine's kernel was updated: restart it to go on." } };

  const waiting = await signedRelease({ ...parts, adapter: answering([restart]), record: structuredClone(following), maxReads: 3 });
  assert.equal(waiting.outcome, "following");
  assert.deepEqual(events.filter((one) => one.kind === "wait" && one.for === "restart").map((one) => one.words),
    ["shop's machine needs a restart before it runs the release: The machine's kernel was updated: restart it to go on."]);

  const unread = new Error("mobilynet did not answer: fetch failed");
  const live = await signedRelease({ ...parts, adapter: answering([unread, { ...moving, version, wantedVersion: null }]), record: structuredClone(following) });
  assert.equal(live.outcome, "live");

  const failedApp = { ...moving, state: "failed", lastFailure: { code: "start_failed", message: "bin/web exited with status 1." } };
  const failed = await signedRelease({ ...parts, adapter: answering([failedApp]), record: structuredClone(following) });
  assert.deepEqual([failed.outcome, failed.message], ["failed", "shop failed on its machine: bin/web exited with status 1."]);
  const gone = await signedRelease({ ...parts, adapter: answering([null]), record: structuredClone(following) });
  assert.deepEqual([gone.outcome, gone.message], ["failed", "The app shop is gone from its machine."]);
  assert.equal(await manifestOf(gone.record), null);
});
