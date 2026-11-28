import { createReadStream } from "node:fs";

import { deployError } from "../../failures.js";

// A signed prebuilt release of an app a machine of the mobilynet project runs, as mobilynet's own tools make and send
// one (its docs/self-hosting.md B3, prebuiltRelease.js, metal/hostd/lib/releaseSignature.js, mn's app release
// --prebuilt): an output built elsewhere (output.tar, its mobilynet.json first), a manifest naming the output's SHA-256
// and size, its declaration's SHA-256 and the release key's fingerprint, and the key's Ed25519 signature of the
// manifest, which the key's holder makes where the key is and pastes. mobilynet checks the signature against each of
// the project's release keys and the output against the manifest at once, refusing `422` under its field, and moves the
// app to the release, its host switching it back to the version it ran when the release's check fails.
// What this module holds: the upload's body (a plain tar of manifest.json, manifest.sig and output.tar, in that order,
// each member written as mn's tarMember writes it, the output read from its file as it is sent), the manifest's reading,
// and the adapter's calls, which a host's Production of a signed release (signedRelease.js) makes.

const BLOCK = 512;
const MANIFEST_FORMAT = "mobilynet-release-manifest-1";
const HEX64 = /^[0-9a-f]{64}$/u;
const MANIFEST_WORDS = `A prebuilt release's manifest is JSON of format ${MANIFEST_FORMAT}, naming its key's fingerprint, its output's `
  + "SHA-256 and size in bytes, and its declaration's SHA-256: { \"format\", \"key\", \"output\": { \"sha256\", \"bytes\" }, \"declaration\": { \"sha256\" } }.";

/** A tar member's header as mn's tarMember writes one: ustar, mode 0644, owner 0, time 0. @param {string} name @param {number} size */
function memberHeader(name, size) {
  const header = Buffer.alloc(BLOCK);
  header.write(name, 0, 100, "utf8");
  header.write("0000644\0", 100, "ascii");
  header.write("0000000\0", 108, "ascii");
  header.write("0000000\0", 116, "ascii");
  header.write(`${size.toString(8).padStart(11, "0")}\0`, 124, "ascii");
  header.write("00000000000\0", 136, "ascii");
  header.write("        ", 148, "ascii");
  header.write("0", 156, "ascii");
  header.write("ustar\0" + "00", 257, "ascii");
  header.write(`${header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, "0")}\0 `, 148, "ascii");
  return header;
}

const padding = (size) => Buffer.alloc((BLOCK - (size % BLOCK)) % BLOCK);

/**
 * The upload's body, made anew for each request: manifest.json, manifest.sig (the signature, one line) and output.tar
 * read from its file, then the archive's two zero blocks. An output whose file isn't `size` bytes as it is read ends
 * the upload with an error rather than sending a broken archive.
 * @param {{ manifest: Buffer, signature: string, output: { path: string }, size: number }} release
 */
async function* prebuiltTar({ manifest, signature, output, size }) {
  const sig = Buffer.from(`${String(signature).trim()}\n`, "utf8");
  for (const [name, data] of [["manifest.json", manifest], ["manifest.sig", sig]]) {
    yield memberHeader(name, data.length);
    yield data;
    yield padding(data.length);
  }
  yield memberHeader("output.tar", size);
  let sent = 0;
  for await (const chunk of createReadStream(output.path)) {
    sent += chunk.length;
    if (sent > size) break;
    yield chunk;
  }
  if (sent !== size) throw new Error(`${output.path} changed while it was sent: it was ${size} bytes.`);
  yield padding(size);
  yield Buffer.alloc(2 * BLOCK);
}

/**
 * A prebuilt release's manifest as mobilynet names its parts: `{ key, output: { sha256, bytes }, declaration: { sha256 } }`,
 * or a `prebuilt_manifest_invalid` error saying what one is.
 * @param {Buffer | string} bytes
 */
function readReleaseManifest(bytes) {
  let parsed = null;
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    parsed = null;
  }
  const valid = parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed.format === MANIFEST_FORMAT
    && HEX64.test(String(parsed.key ?? "")) && HEX64.test(String(parsed.output?.sha256 ?? ""))
    && Number.isSafeInteger(parsed.output?.bytes) && parsed.output.bytes > 0 && HEX64.test(String(parsed.declaration?.sha256 ?? ""));
  if (!valid) throw deployError("prebuilt_manifest_invalid", MANIFEST_WORDS, 422);
  return { key: parsed.key, output: { sha256: parsed.output.sha256, bytes: parsed.output.bytes }, declaration: { sha256: parsed.declaration.sha256 } };
}

/** A machine's app as a host reads it: what it runs, what it moves to, and why it last failed. @param {any} app */
const appOf = (app) => ({
  name: app.name,
  package: app.package ?? null,
  version: app.version ?? null,
  wantedVersion: app.wantedVersion ?? null,
  previousVersion: app.previousVersion ?? null,
  state: app.state,
  lastFailure: app.lastFailure ?? null,
  changedAt: app.changedAt ?? null
});

/**
 * The adapter's calls for a signed release, over the client and the mobilynet project's calls.
 * @param {{ client: any, calls: any }} parts
 */
function createPrebuiltCalls({ client, calls }) {
  return Object.freeze({
    readReleaseManifest,
    /**
     * Hands a machine's app one signed prebuilt release (`vps:manage`): `{ version, app }`, the release's version and
     * the app moving to it. A release mobilynet refuses is a `prebuilt_refused` error carrying mobilynet's `field` and
     * its words for it, never tried again; anything else is mobilynet's error as it came.
     * @param {{ vps: string, app: string, output: { path: string, sha256: string }, manifest: Buffer, signature: string }} release
     */
    async releasePrebuilt({ vps, app, output, manifest, signature }) {
      try {
        const answered = await client.releasePrebuilt(vps, app, { manifest, signature, output });
        return { version: answered.release.version, app: appOf(answered.app) };
      } catch (error) {
        const fieldErrors = error?.status === 422 ? error.details?.fieldErrors : null;
        if (!fieldErrors || Object.keys(fieldErrors).length === 0) throw error;
        const [field, words] = Object.entries(fieldErrors)[0];
        throw Object.assign(deployError("prebuilt_refused", String(words), 422, error.details), { field, retryable: false, cause: error });
      }
    },
    /** A machine's app (`vps:read`), or null when the machine or the app is none of the project's. @param {{ vps: string, app: string }} where */
    async readVpsApp({ vps, app }) {
      const found = await client.readVpsApp(vps, app);
      return found ? appOf(found) : null;
    },
    /**
     * Every app of the project's releases on each of its machines not destroyed (`vps:read`), by machine and app name:
     * `{ vps: { id, name, state, region }, app: { name, version, state } }`. A catalogue package's app takes none.
     */
    async listVpsApps() {
      const machines = (await calls.listVpses()).sort((one, other) => one.name.localeCompare(other.name));
      const listed = [];
      for (const machine of machines) {
        const apps = (await client.listVpsApps(machine.id)).filter((app) => !app.package).sort((one, other) => one.name.localeCompare(other.name));
        for (const app of apps) {
          listed.push({ vps: { id: machine.id, name: machine.name, state: machine.state, region: machine.region }, app: { name: app.name, version: app.version ?? null, state: app.state } });
        }
      }
      return listed;
    },
    /** The project's release keys (`vps:read`): `{ name, fingerprint, publicKey, createdBy, createdAt }`, oldest first. */
    async listReleaseKeys() {
      return (await calls.listReleaseKeys()).map(({ name, fingerprint, publicKey, createdBy, createdAt }) => ({ name, fingerprint, publicKey, createdBy, createdAt }));
    }
  });
}

export { createPrebuiltCalls, prebuiltTar, readReleaseManifest };
