import { createHash, generateKeyPairSync, sign } from "node:crypto";

import { createMobilynetAdapter } from "../../packages/vibe64-deploy/src/adapters/mobilynet/index.js";
import { createMobilynetClient } from "../../packages/vibe64-deploy/src/adapters/mobilynet/client.js";
import { ENGINE_SCOPES, createMobilynetStandIn } from "../../packages/vibe64-deploy/src/adapters/mobilynet/standIn.js";
import { AT, plainTarOf } from "./vibe64DeployStandInHelpers.js";

// What the signed release tests share: a release key made for the test and thrown away with it (Ed25519, as mobilynet's
// release keys are), a prebuilt release's output and manifest as mobilynet's own tools write them, the signature the
// key makes of a manifest, and the stand-in with one machine running the shop's app over a key that may release to it.

// What mobilynet's release key signs: this context, then the manifest's bytes (its metal/hostd/lib/releaseSignature.js).
const RELEASE_CONTEXT = "mobilynet-release-v1\n";
const MANIFEST_FORMAT = "mobilynet-release-manifest-1";
// The scopes a key that releases to a machine's app holds beside the engine's: reading machines, apps and release keys,
// and handing an app a release.
const MACHINE_SCOPES = Object.freeze(["vps:read", "vps:manage"]);
const OLD_VERSION = "20261101-aaaaaaa";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** A release key: its public half as mobilynet lists it (base64 of its SPKI DER), its fingerprint and its signing. */
function releaseKey() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const der = publicKey.export({ format: "der", type: "spki" });
  return {
    publicKey: der.toString("base64"),
    fingerprint: sha256(der),
    /** The signature of a manifest's bytes, base64, as the key's holder pastes it. @param {Buffer | string} manifest */
    sign: (manifest) => sign(null, Buffer.concat([Buffer.from(RELEASE_CONTEXT, "utf8"), Buffer.from(manifest)]), privateKey).toString("base64")
  };
}

/** The shop's declaration as a prebuilt output holds it: a build that runs nothing. @param {string} app */
const prebuiltDeclaration = (app = "shop") => ({
  name: app,
  services: [{ name: "web", command: "bin/web", port: 3000, healthPath: "/api/health" }],
  build: { output: ["."] }
});

/**
 * A prebuilt release of `app`: its output (a plain tar, its mobilynet.json first) and the manifest naming the output,
 * its declaration and `key`, as mobilynet's release script writes them.
 * @param {{ key: string, app?: string, release?: string, declaration?: object, manifest?: object }} parts
 */
function prebuiltRelease({ key, app = "shop", release = "1", declaration = prebuiltDeclaration(app), manifest: more = {} }) {
  const declarationBytes = Buffer.from(JSON.stringify(declaration));
  const output = plainTarOf({ "mobilynet.json": declarationBytes, "release.txt": `release ${release}\n` });
  const manifest = Buffer.from(`${JSON.stringify({
    format: MANIFEST_FORMAT,
    key,
    output: { sha256: sha256(output), bytes: output.length },
    storePaths: [],
    declaration: { sha256: sha256(declarationBytes) },
    ...more
  }, null, 2)}\n`);
  return { output, outputSha256: sha256(output), manifest, manifestSha256: sha256(manifest) };
}

/**
 * The stand-in with one machine, `web1`, running the shop's app at OLD_VERSION, the project's one release key, and a
 * client and adapter over a key of the project that holds the engine's scopes and MACHINE_SCOPES.
 * @param {{ scopes?: ReadonlyArray<string>, now?: () => Date }} [options]
 */
function machineWorld({ scopes = [...ENGINE_SCOPES, ...MACHINE_SCOPES], now = () => AT } = {}) {
  const standIn = createMobilynetStandIn({ now });
  const token = standIn.addKey({ projectId: standIn.projectId, scopes });
  const client = createMobilynetClient({ baseUrl: standIn.baseUrl, credential: token, fetch: standIn.fetch });
  const adapter = createMobilynetAdapter({ client, project: standIn.projectId });
  const vps = standIn.machines.add(standIn.projectId, { name: "web1" });
  standIn.machines.addApp(vps, { name: "shop", version: OLD_VERSION });
  const key = releaseKey();
  standIn.addReleaseKey(standIn.projectId, { name: "Release key", publicKey: key.publicKey });
  return { standIn, client, adapter, vps, key, projectId: standIn.projectId };
}

export { MACHINE_SCOPES, MANIFEST_FORMAT, OLD_VERSION, machineWorld, prebuiltDeclaration, prebuiltRelease, releaseKey, sha256 };
