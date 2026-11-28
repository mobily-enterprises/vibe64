import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { backoffPauses, deployError, retryable } from "./failures.js";
import { reporterOf } from "./report.js";

// A Production the Stack releases as a signed release (its Deployment's `- Signed release `name`: `command`...` line):
// one signed prebuilt release of an app a provider's machine already runs, for a project whose Production its own
// Production can't build, such as a provider's control plane. Nothing of it is an App Service: the Plan refuses it
// (needsOfStack.js), and this is all it does at the provider.
//
// A release goes building → signature → releasing → following → live, or failed (or replaced, by a new start while it
// waited for its signature). Building runs the line's command at the saved commit through the host's runner, which
// gives it V64_COMMIT, V64_RELEASE_KEY (the fingerprint of the release key the person chose) and V64_RELEASE_DIR (a
// folder of its own), and must leave there output.tar and manifest.json, which are checked against each other and the
// key. Then it waits for the key's holder to sign the manifest where the key is and paste the signature: Vibe64 never
// holds the key. Its record (`save`) keeps each step, so a restarted editor, given the record again, waits again or
// goes on where it was. The pasted signature, once it looks like one, is sent with the manifest and the output as
// one prebuilt release of the chosen app (the adapter's releasePrebuilt); one the provider refuses fails the release in
// its words, and one it doesn't answer is sent again, the same output answering the release it made. Then the app is
// read until it runs the release, or its host switches it back to the version it ran, saying why.

const SIGNED_RELEASE_RECORD_FORMAT = "vibe64.signed-release-record.v1";
const COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const FINGERPRINT = /^[0-9a-f]{64}$/u;
// An Ed25519 signature in base64: 64 bytes, 88 characters.
const SIGNATURE = /^[A-Za-z0-9+/]{86}==$/u;
const MANIFEST_FILE = "manifest.json";
const OUTPUT_FILE = "output.tar";
// A record keeps its newest releases, never the whole history.
const RELEASES_KEPT = 20;
// How many times a release the provider doesn't answer is sent in one call before the call returns, still releasing.
const SEND_TRIES = 5;
// How many times the app is read in one call before the call returns, still following (with a 5-second pause, 30 min).
const FOLLOW_READS = 360;
const GONE = "The release's files are gone from the machine that built it: build it again.";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** A file's SHA-256, read as a stream. @param {string} file */
async function sha256Of(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

/** A file's size when it is a file, or null. @param {string} file */
async function fileSize(file) {
  try {
    const found = await stat(file);
    return found.isFile() ? found.size : null;
  } catch {
    return null;
  }
}

/** A file's bytes, or null when it is gone. @param {string} file */
async function bytesOrNull(file) {
  try {
    return await readFile(file);
  } catch {
    return null;
  }
}

/**
 * What a release's command left, checked: `{ manifest, output }`, each `{ sha256, bytes }`, or the problem in words.
 * @param {any} adapter @param {string} releaseDir @param {string} key the release key the person chose
 */
async function releaseFiles(adapter, releaseDir, key) {
  const manifestBytes = await bytesOrNull(path.join(releaseDir, MANIFEST_FILE));
  if (!manifestBytes) return { problem: `The release's command left no ${MANIFEST_FILE} in V64_RELEASE_DIR.` };
  const outputFile = path.join(releaseDir, OUTPUT_FILE);
  const bytes = await fileSize(outputFile);
  if (bytes === null) return { problem: `The release's command left no ${OUTPUT_FILE} in V64_RELEASE_DIR.` };
  let named;
  try {
    named = adapter.readReleaseManifest(manifestBytes);
  } catch (error) {
    return { problem: error.message };
  }
  if (named.key !== key) return { problem: `The manifest names the key ${named.key.slice(0, 12)}, not the release key you chose (${key.slice(0, 12)}).` };
  const output = { sha256: await sha256Of(outputFile), bytes };
  if (output.bytes !== named.output.bytes || output.sha256 !== named.output.sha256) {
    return { problem: `${OUTPUT_FILE} is ${output.bytes} bytes with the SHA-256 ${output.sha256}; its manifest names ${named.output.bytes} bytes with ${named.output.sha256}.` };
  }
  return { manifest: { sha256: sha256(manifestBytes), bytes: manifestBytes.length }, output };
}

/** The manifest of a release as it was built, or null when its files are gone or changed. @param {any} entry */
async function keptManifest(entry) {
  const bytes = await bytesOrNull(path.join(entry.releaseDir, MANIFEST_FILE));
  const outputBytes = await fileSize(path.join(entry.releaseDir, OUTPUT_FILE));
  return bytes && sha256(bytes) === entry.manifest.sha256 && outputBytes === entry.output.bytes ? bytes : null;
}

/** A start's problem: a saved commit, a machine's app, a release key's fingerprint. @param {any} start */
function startValid(start) {
  return COMMIT.test(String(start?.commit ?? "")) && typeof start?.target?.vps === "string" && start.target.vps !== ""
    && typeof start.target.app === "string" && start.target.app !== "" && FINGERPRINT.test(String(start.key ?? ""));
}

/**
 * The manifest the key's holder signs, of the release waiting for its signature: `{ fileName, bytes, sha256 }`, or
 * null when none waits or its files are gone.
 * @param {any} record the signed release's record
 */
async function manifestOf(record) {
  const entry = record?.releases?.at(-1);
  if (entry?.state !== "signature") return null;
  const bytes = await keptManifest(entry);
  return bytes ? { fileName: `${entry.target.app}-${entry.commit.slice(0, 12)}.manifest.json`, bytes, sha256: entry.manifest.sha256 } : null;
}

/**
 * Builds, waits for, hands over or follows a Production's signed release, as far as it goes in one call.
 * @param {object} options
 * @param {any} options.adapter the provider's (its listReleaseKeys, readVpsApp, readReleaseManifest and releasePrebuilt)
 * @param {{ name: string, argv: string[] } | null} [options.release] the Stack's Signed release line (the inspection's
 *   `signedRelease`), needed to start one
 * @param {any} [options.record] the record saved before, or null
 * @param {(record: any) => unknown} [options.save] keeps the record, at each step
 * @param {(run: { argv: string[], commit: string, env: { V64_COMMIT: string, V64_RELEASE_KEY: string }, log: (text: string) => void }) => Promise<{ releaseDir: string }>} [options.build]
 *   the host's runner: the command run at the commit in a checkout of its own, with V64_RELEASE_DIR a folder it made
 *   and answers
 * @param {{ commit: string, target: { vps: string, app: string }, key: string }} [options.start] a new release: built
 *   at the saved commit for a machine's app, with one of the project's release keys by its fingerprint
 * @param {string} [options.signature] the pasted signature of the manifest of the release waiting for it
 * @param {(event: any) => unknown} [options.report] told each step (`{ kind: "step", step: "build" | "release" |
 *   "follow", phase: "start" | "done" | "refused", words }`), the build's output (`{ kind: "output", step: "build",
 *   text }`), each wait (`{ kind: "wait", for: "signature" | "restart" | "provider", words }`) and the end
 * @param {() => Promise<void> | void} [options.pause] between reads of the app and sends the provider didn't answer
 * @param {number} [options.maxReads] how many times the app is read in this call
 * @returns {Promise<{ outcome: "signature" | "following" | "live" | "failed", record: any, message: string,
 *   waiting?: { kind: "signature", manifest: { sha256: string, bytes: number }, key: string } }>}
 */
async function signedRelease({
  adapter, release = null, record = null, save = (kept) => kept, build, start, signature, report = () => {}, pause = () => {},
  maxReads = FOLLOW_READS
}) {
  const tell = reporterOf(report);
  const kept = record ? structuredClone(record) : { format: SIGNED_RELEASE_RECORD_FORMAT, releases: [] };
  const at = () => new Date().toISOString();
  const keep = async (entry, change) => {
    Object.assign(entry, change, { changedAt: at() });
    await save(kept);
  };
  const ended = (outcome, entry) => {
    tell({ kind: "end", outcome, ...(entry.message ? { words: entry.message } : {}) });
    const waiting = outcome === "signature" ? { waiting: { kind: "signature", manifest: { ...entry.manifest }, key: entry.key } } : {};
    return { outcome, record: kept, message: entry.message, ...waiting };
  };
  const fail = async (entry, step, message) => {
    await keep(entry, { state: "failed", message });
    tell({ kind: "step", step, phase: "refused", words: message });
    return ended("failed", entry);
  };
  const waitForSignature = (entry) => {
    tell({ kind: "wait", for: "signature", words: `Waiting for the manifest of ${entry.target.app} at ${entry.commit.slice(0, 12)} to be signed with the release key ${entry.key.slice(0, 12)}.` });
    return ended("signature", entry);
  };

  if (start !== undefined) {
    if (!release) throw deployError("production_signed_release_unconfigured", "genesis/stack.md's Deployment has no `- Signed release` line: Production isn't released as a signed release.", 409);
    if (!startValid(start)) {
      throw deployError("production_signed_release_start_invalid", "A signed release starts at a saved commit (its full hash), for a machine's app ({ vps, app }), with one of the project's release keys by its fingerprint.", 422);
    }
    const current = kept.releases.at(-1);
    if (current && ["releasing", "following"].includes(current.state)) {
      throw deployError("production_signed_release_busy", `The release of ${current.commit.slice(0, 12)} is being handed to ${current.target.app}: build another once it runs or fails.`, 409);
    }
    const keys = await adapter.listReleaseKeys();
    if (!keys.some((key) => key.fingerprint === start.key)) {
      throw deployError("production_signed_release_key_unknown", `The key ${start.key.slice(0, 12)} isn't one of the project's release keys at ${adapter.title}: choose one of them.`, 422);
    }
    const app = await adapter.readVpsApp(start.target);
    if (!app || app.package) {
      throw deployError("production_signed_release_target_missing", `No app ${start.target.app} of the project's releases runs on that machine: choose one it runs.`, 404);
    }
    if (current?.state === "signature" || current?.state === "building") await keep(current, { state: "replaced" });
    const entry = {
      name: release.name, commit: start.commit, target: { vps: start.target.vps, app: start.target.app }, key: start.key, state: "building",
      releaseDir: null, manifest: null, output: null, signature: null, version: null, message: "", startedAt: at(), changedAt: at()
    };
    kept.releases = [...kept.releases, entry].slice(-RELEASES_KEPT);
    await save(kept);
    tell({ kind: "step", step: "build", phase: "start", words: `Building ${release.name} at ${start.commit.slice(0, 12)} for ${start.target.app}` });
    let releaseDir;
    try {
      ({ releaseDir } = await build({
        argv: [...release.argv], commit: start.commit, env: { V64_COMMIT: start.commit, V64_RELEASE_KEY: start.key },
        log: (text) => tell({ kind: "output", step: "build", text: String(text) })
      }));
    } catch (error) {
      return fail(entry, "build", `The release's command failed: ${error.message}`);
    }
    const files = await releaseFiles(adapter, releaseDir, start.key);
    if (files.problem) {
      await keep(entry, { releaseDir });
      return fail(entry, "build", files.problem);
    }
    await keep(entry, { releaseDir, ...files, state: "signature" });
    tell({ kind: "step", step: "build", phase: "done", words: `Built ${release.name}: its manifest waits to be signed` });
    return waitForSignature(entry);
  }

  const entry = kept.releases.at(-1);
  if (signature !== undefined) {
    if (entry?.state !== "signature") throw deployError("production_signed_release_nothing", "No release waits for its signature: build one first.", 409);
    const pasted = String(signature).trim();
    if (!SIGNATURE.test(pasted)) {
      throw deployError("production_signed_release_signature_invalid", "The signature is one line of 88 base64 characters ending in ==, as signing the manifest with the release key prints it.", 422);
    }
    if (!(await keptManifest(entry))) return fail(entry, "release", GONE);
    await keep(entry, { signature: pasted, state: "releasing" });
  }
  if (!entry) throw deployError("production_signed_release_nothing", "No signed release was built yet: build one first.", 409);
  if (entry.state === "building") return fail(entry, "build", "The release's build was cut short: build it again.");
  if (entry.state === "signature") return (await keptManifest(entry)) ? waitForSignature(entry) : fail(entry, "release", GONE);
  if (entry.state === "live") return ended("live", entry);
  if (entry.state !== "releasing" && entry.state !== "following") return ended("failed", entry);

  if (entry.state === "releasing") {
    const manifest = await keptManifest(entry);
    if (!manifest) return fail(entry, "release", GONE);
    tell({ kind: "step", step: "release", phase: "start", words: `Handing ${entry.target.app} the signed release of ${entry.commit.slice(0, 12)}` });
    for (let tries = 1; ; tries += 1) {
      try {
        const sent = await adapter.releasePrebuilt({
          vps: entry.target.vps, app: entry.target.app, manifest, signature: entry.signature,
          output: { path: path.join(entry.releaseDir, OUTPUT_FILE), sha256: entry.output.sha256, bytes: entry.output.bytes }
        });
        await keep(entry, { version: sent.version, state: "following", message: "" });
        tell({ kind: "step", step: "release", phase: "done", words: `${entry.target.app} takes ${sent.version}` });
        break;
      } catch (error) {
        if (!retryable(error)) return fail(entry, "release", `${adapter.title} refused the release: ${error.message}`);
        if (tries >= SEND_TRIES) {
          await keep(entry, { message: `${error.message.replace(/\.$/u, "")}. It is sent again when the release is next read.` });
          tell({ kind: "wait", for: "provider", words: entry.message });
          return ended("following", entry);
        }
        for (let one = 0; one < backoffPauses(tries); one += 1) await pause();
      }
    }
  }

  tell({ kind: "step", step: "follow", phase: "start", words: `Waiting for ${entry.target.app} to run ${entry.version}` });
  let restartSaid = false;
  for (let reads = 0; reads < maxReads; reads += 1) {
    if (reads > 0) await pause();
    let app;
    try {
      app = await adapter.readVpsApp(entry.target);
    } catch {
      // A read that fails is made again at the next pause; the call ends still following once its reads are spent.
      continue;
    }
    if (!app) return fail(entry, "follow", `The app ${entry.target.app} is gone from its machine.`);
    if (app.version === entry.version && app.state === "running") {
      await keep(entry, { state: "live", message: "" });
      tell({ kind: "step", step: "follow", phase: "done", words: `${entry.target.app} runs ${entry.version}` });
      return ended("live", entry);
    }
    const why = app.lastFailure?.message ?? "its host gave no reason.";
    const moved = app.wantedVersion === entry.version || app.version === entry.version;
    if (!moved) return fail(entry, "follow", `Switched back to ${app.version}: ${why}`);
    if (app.state === "failed") return fail(entry, "follow", `${entry.target.app} failed on its machine: ${why}`);
    if (app.lastFailure?.code === "reboot_needed" && !restartSaid) {
      restartSaid = true;
      tell({ kind: "wait", for: "restart", words: `${entry.target.app}'s machine needs a restart before it runs the release: ${why}` });
    }
  }
  return ended("following", entry);
}

export { SIGNED_RELEASE_RECORD_FORMAT, manifestOf, signedRelease };
