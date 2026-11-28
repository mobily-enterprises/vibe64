import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

import { MobilynetError, createMobilynetClient } from "../../packages/vibe64-deploy/src/adapters/mobilynet/client.js";
import { createMobilynetStandIn } from "../../packages/vibe64-deploy/src/adapters/mobilynet/standIn.js";

// What the deploy engine's mobilynet tests share: a release's tarball made in memory, the shop's declaration, the
// stand-in with the client over it, and how a refusal is read.

const AT = new Date("2026-11-20T09:00:00.000Z");
const DAY = "20261120";
const HOST = "shop.example.com";

/** The shop's declaration: one web service on a port, its own settings, and one need of PostgreSQL. */
const SHOP = Object.freeze({
  name: "shop",
  services: [{ name: "web", command: "bin/web", port: 3000, healthPath: "/api/health" }],
  settings: {
    mode: { type: "string", required: true },
    sessionKey: { type: "string", secret: true }
  },
  needs: [{ interface: "postgresql", as: "DB" }],
  build: { command: "npm ci && npm run build", output: ["dist", "node_modules", "package.json"] }
});

/**
 * A plain tar of these files, in their order, each a ustar entry at the archive's root as mobilynet's mn writes one
 * (mode 0644, owner 0, time 0), then the archive's two zero blocks.
 * @param {Record<string, string | Buffer>} files
 */
function plainTarOf(files) {
  const blocks = [];
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content);
    const header = Buffer.alloc(512);
    header.write(name, 0, 100, "utf8");
    header.write("0000644\0", 100, "ascii");
    header.write("0000000\0", 108, "ascii");
    header.write("0000000\0", 116, "ascii");
    header.write(`${data.length.toString(8).padStart(11, "0")}\0`, 124, "ascii");
    header.write("00000000000\0", 136, "ascii");
    header.write("        ", 148, "ascii");
    header.write("0", 156, "ascii");
    header.write("ustar\0" + "00", 257, "ascii");
    header.write(`${header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, "0")}\0 `, 148, "ascii");
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  return Buffer.concat([...blocks, Buffer.alloc(1024)]);
}

/** A gzip tarball of these files, each a ustar entry at the archive's root. @param {Record<string, string>} files */
const tarballOf = (files) => gzipSync(plainTarOf(files));

/**
 * A release's tarball and its SHA-256: its mobilynet.json and a file naming the release, so each release has its own
 * bytes and the same release always the same.
 * @param {object} declaration @param {string} release
 */
function upload(declaration, release) {
  const archive = tarballOf({ "mobilynet.json": JSON.stringify(declaration), "release.txt": release });
  return { archive, sha256: createHash("sha256").update(archive).digest("hex") };
}

/**
 * The stand-in and the client over it with the stand-in's key, and the calls of its project.
 * @param {{ scopes?: string[], now?: () => Date }} [options]
 */
function world({ scopes, now = () => AT } = {}) {
  const standIn = createMobilynetStandIn({ now, ...(scopes ? { scopes } : {}) });
  const client = createMobilynetClient({ baseUrl: standIn.baseUrl, credential: standIn.key, fetch: standIn.fetch });
  return { standIn, client, production: client.project(standIn.projectId), projectId: standIn.projectId };
}

/** The stand-in moved on enough times for every refresh, link and hosted service to settle. */
function settle(standIn, times = 20) {
  for (let step = 0; step < times; step += 1) standIn.advance();
}

/** A refusal's status, code and field errors' names, to compare. */
function refusal(error) {
  return { status: error.status, code: error.code, fields: Object.keys(error.details?.fieldErrors ?? {}).sort() };
}

/** Awaits a call mobilynet must refuse and answers its MobilynetError. */
async function refused(promise) {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof MobilynetError, String(error?.stack ?? error));
    return error;
  }
  return assert.fail("mobilynet took a call it should refuse");
}

/** The service spec of the shop's web part, on a release of the project. @param {string} version */
function webSpec(version, more = {}) {
  return {
    name: "web",
    region: "us",
    exposure: "public",
    size: "a-2",
    instances: 2,
    app: { name: "shop", version },
    settings: { mode: "web" },
    secrets: { sessionKey: "session-1" },
    routes: [{ host: HOST, tls: "edge" }],
    ...more
  };
}

/** The world with its domain verified, a release of the shop and its web service running on it. */
async function runningShop(parts = world(), declaration = SHOP) {
  await parts.production.createDomain(HOST, { idempotencyKey: "domain-shop" });
  parts.standIn.verifyDomain(HOST, parts.projectId);
  const { release } = await parts.production.createRelease("shop", upload(declaration, "1"));
  const created = await parts.production.createService(webSpec(release.version), { idempotencyKey: "service-web" });
  settle(parts.standIn);
  return { ...parts, release, serviceId: created.service.id, created };
}

export { AT, DAY, HOST, SHOP, plainTarOf, refusal, refused, runningShop, settle, upload, webSpec, world };
