// The archive a deploy sends its provider, and what each service is given. The archive is the saved commit as a gzip
// tarball, made by git with no key and no provider's call, with the scripts Vibe64 makes for it added (the shared build
// script and one serve script per service); each service's upload is that archive with its provider's declaration
// added at the root. A commit that already has a file Vibe64 makes is refused: what the app needs is said once, in
// genesis/stack.md.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

import { boundSettings } from "./needs.js";

const DECLARATION_FILE = "mobilynet.json";
const APP_SCRIPTS_FOLDER = "vibe64-app";
// The largest archive a deploy sends: what one deploy request could carry, base64, beside its small fields.
const PACKAGE_MAX_BYTES = Math.floor((64 * 1024 * 1024 - 64 * 1024) * 3 / 4);
// The settings Production gives every service itself: the environment, where it listens, its public address and the
// proxies it believes.
const PRODUCTION_SETTINGS = Object.freeze(["APP_ENV", "HOST", "PORT", "APP_PUBLIC_URL", "TRUSTED_PROXIES"]);
const TAR_BLOCK = 512;

/** A refusal a caller shows as it is, with its code and HTTP status. */
function packageError(message, code, status = 422) {
  return Object.assign(new Error(message), { code, status });
}

/**
 * Why the saved commit can't be packed, as `{ code, message }`, or null: it has its own mobilynet.json, or its own
 * vibe64-app folder, where Vibe64 puts the scripts it makes.
 * @param {{ commit: string, git: (args: string[]) => Promise<string> }} source
 */
async function archiveProblem({ commit, git }) {
  const exists = (file) => git(["cat-file", "-e", `${commit}:${file}`]).then(() => true, () => false);
  const [ownDeclaration, scriptsFolderTaken] = await Promise.all([exists(DECLARATION_FILE), exists(APP_SCRIPTS_FOLDER)]);
  if (ownDeclaration) {
    return {
      code: "production_own_declaration",
      message: "The saved work has its own mobilynet.json, but Production makes the app's package from genesis/stack.md: say "
        + "what the app needs there (its Deployment section and ## Resources; the coding agent can do this), remove "
        + "mobilynet.json, Save, then deploy."
    };
  }
  if (scriptsFolderTaken) {
    return {
      code: "vibe64_production_folder_taken",
      message: `The saved work has its own ${APP_SCRIPTS_FOLDER}, where Vibe64 puts the build and service scripts of the `
        + "package it makes. Rename it, Save, then deploy."
    };
  }
  return null;
}

/**
 * Packs the commit as a gzip tarball with the scripts Vibe64 makes for it, and answers its bytes and SHA-256. Refuses
 * one too big to send.
 * @param {object} options
 * @param {string} options.commit
 * @param {(args: string[]) => Promise<string>} options.git
 * @param {string} options.scratch a folder git may write into
 * @param {Record<string, string>} options.scripts each script's text by its path in the release, all in vibe64-app/
 * @param {number} [options.maxBytes] the largest archive taken
 * @returns {Promise<{ bytes: Buffer, sha256: string }>}
 */
async function packArchive({ commit, git, scratch, scripts, maxBytes = PACKAGE_MAX_BYTES }) {
  const output = path.join(scratch, "production-package.tar.gz");
  // git archive adds each extra file under the last --prefix before it; the commit's own files take the last one.
  const args = ["archive", "--format=tar.gz", `--output=${output}`, `--prefix=${APP_SCRIPTS_FOLDER}/`];
  const folder = path.join(scratch, "production-package");
  await mkdir(path.join(folder, APP_SCRIPTS_FOLDER), { recursive: true });
  for (const [file, text] of Object.entries(scripts)) {
    if (path.posix.dirname(file) !== APP_SCRIPTS_FOLDER) throw new Error(`A made script belongs in ${APP_SCRIPTS_FOLDER}/: ${file}`);
    await writeFile(path.join(folder, file), text, { mode: 0o755 });
    args.push(`--add-file=${path.join(folder, file)}`);
  }
  await git([...args, "--prefix=", commit]);
  const bytes = await readFile(output);
  if (bytes.length > maxBytes) {
    throw packageError(
      `The packed app is ${megabytes(bytes.length)} MiB; Production takes at most `
      + `${megabytes(maxBytes)} MiB. Keep built files and large assets out of the repository, Save, then deploy.`,
      "vibe64_production_package_too_large"
    );
  }
  return { bytes, sha256: sha256Of(bytes) };
}

/**
 * The archive with one more file at its root (a provider's declaration), as a gzip tarball again, and its SHA-256: the
 * tar's entries are kept as they are and the file is added before its end.
 * @param {Buffer} archive a gzip tarball (packArchive's bytes) @param {string} name @param {string} text
 * @returns {{ bytes: Buffer, sha256: string }}
 */
function withRootFile(archive, name, text) {
  const tar = gunzipSync(archive);
  let end = 0;
  while (end + TAR_BLOCK <= tar.length && tar.subarray(end, end + TAR_BLOCK).some((byte) => byte !== 0)) {
    const size = Number.parseInt(tar.subarray(end + 124, end + 136).toString("latin1").replace(/\0.*$/su, "").trim() || "0", 8);
    end += TAR_BLOCK + Math.ceil(size / TAR_BLOCK) * TAR_BLOCK;
  }
  const content = Buffer.from(text, "utf8");
  const header = Buffer.alloc(TAR_BLOCK);
  const field = (offset, length, value) => header.write(value, offset, length, "latin1");
  field(0, 100, name);
  field(100, 8, "0000644\0");
  field(108, 8, "0000000\0");
  field(116, 8, "0000000\0");
  field(124, 12, `${content.length.toString(8).padStart(11, "0")}\0`);
  field(136, 12, "00000000000\0");
  field(148, 8, " ".repeat(8));
  field(156, 1, "0");
  field(257, 8, "ustar\u000000");
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  field(148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
  const padding = Buffer.alloc((TAR_BLOCK - (content.length % TAR_BLOCK)) % TAR_BLOCK);
  const bytes = gzipSync(Buffer.concat([tar.subarray(0, end), header, content, padding, Buffer.alloc(TAR_BLOCK * 2)]));
  return { bytes, sha256: sha256Of(bytes) };
}

/**
 * What each service is given: Production's own settings and the generated secrets every
 * service, the setup code the public one, each Reaches setting the service that reaches, and each Production Env entry
 * the services it names (the public one when it names none). Values are the deploy's; here each setting is
 * `{ secret, required }`. A resource's settings come from its link and are not here.
 * @param {object} needs needsOfStack's needs
 * @param {Array<{ key: string, secret?: boolean, services?: string[] }>} [envRecords] the Production Env's entries
 * @returns {Record<string, Record<string, { secret: boolean, required: boolean }>>}
 */
function settingsPerService(needs, envRecords = []) {
  const publicId = needs.services.find((service) => service.exposure === "public")?.id;
  for (const record of envRecords) {
    const problem = envEntryProblem(record, needs);
    if (problem) throw packageError(`${problem} Remove it from the Production Env, then deploy.`, "vibe64_production_env_invalid");
  }
  return Object.fromEntries(needs.services.map((service) => {
    const settings = {};
    const declare = (name, secret, required) => {
      settings[name] ??= { secret, required };
    };
    for (const name of PRODUCTION_SETTINGS) declare(name, false, true);
    for (const secret of needs.generatedSecrets) declare(secret, true, true);
    if (needs.setupCode && service.id === publicId) declare(needs.setupCode, true, false);
    for (const reach of service.reaches) declare(reach.setting, false, true);
    for (const record of envRecords) {
      if ((record.services ?? [publicId]).includes(service.id)) declare(record.key, record.secret === true, false);
    }
    return [service.id, settings];
  }));
}

/**
 * The values a service is given, split into settings and secrets as declared: Production's own (APP_ENV=production,
 * HOST=0.0.0.0, PORT, APP_PUBLIC_URL at the domain, TRUSTED_PROXIES as the provider names them), each Reaches setting
 * the reached service's private address, and the Production Env's values (generated secrets and the setup code
 * among them) for the names it declares. A declared name without a value is left out, never blanked.
 * @param {object} options
 * @param {Record<string, { secret: boolean, required: boolean }>} options.declared the service's settings (settingsPerService)
 * @param {Record<string, string>} options.env the Production Env's values by name
 * @param {string} options.domain @param {string} options.trustedProxies @param {number} options.port
 * @param {Record<string, string>} [options.reached] each of the service's Reaches settings with the reached service's address
 */
function settingValues({ declared, env, domain, trustedProxies, port, reached = {} }) {
  const own = { APP_ENV: "production", HOST: "0.0.0.0", PORT: String(port), APP_PUBLIC_URL: `https://${domain}`, TRUSTED_PROXIES: trustedProxies };
  const all = { ...env, ...reached, ...own };
  const settings = {};
  const secrets = {};
  for (const [name, { secret }] of Object.entries(declared)) {
    if (typeof all[name] === "string") (secret ? secrets : settings)[name] = all[name];
  }
  return hashedValues(settings, secrets);
}

/** A service's settings and secrets with the hash a Deploy compares them by. */
function hashedValues(settings, secrets) {
  return { settings, secrets, hash: `sha256:${sha256Of(Buffer.from(JSON.stringify([sortedObject(settings), sortedObject(secrets)])))}` };
}

/**
 * Those of a service's values (settingValues) whose names it holds at its provider (`held`), with their own hash: what a
 * Deploy gives it ahead of a release, where the provider takes only those the release it runs declares.
 * @param {{ settings: Record<string, string>, secrets: Record<string, string> }} values @param {string[]} held
 */
function heldValues(values, held) {
  const pick = (from) => Object.fromEntries(Object.entries(from).filter(([name]) => held.includes(name)));
  return hashedValues(pick(values.settings), pick(values.secrets));
}

function sortedObject(value) {
  return Object.fromEntries(Object.entries(value).sort(([one], [other]) => (one < other ? -1 : 1)));
}

/**
 * Why a Production Env entry can't be given to the services it names, or "": it names a service there isn't, or it is
 * a setting Production gives itself, a resource binds, or a service's own `- Setting` or Reaches sets.
 * @param {{ key: string, services?: string[] }} record @param {object} needs needsOfStack's needs
 */
function envEntryProblem(record, needs) {
  const ids = needs.services.map((service) => service.id);
  const unknown = (record.services ?? []).filter((id) => !ids.includes(id));
  if (unknown.length > 0) {
    return `${record.key} is given to ${unknown.join(", ")}, which this Deployment doesn't have: its services are ${ids.join(", ")}.`;
  }
  const own = needs.services.flatMap((service) => [...Object.keys(service.settings), ...service.reaches.map((reach) => reach.setting)]);
  if (PRODUCTION_SETTINGS.includes(record.key) || record.key.startsWith("V64_") || boundSettings(needs).has(record.key) || own.includes(record.key)) {
    return `${record.key} is set by Production itself (from genesis/stack.md's resources and services), so the Production Env can't set it.`;
  }
  return "";
}

/** The settings a declaration names, which are the only ones the deploy sets. */
function declaredSettingsOf(declaration) {
  return Object.keys(isRecord(declaration?.settings) ? declaration.settings : {});
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sha256Of(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function megabytes(bytes) {
  return (bytes / (1024 * 1024)).toFixed(1);
}

export {
  PACKAGE_MAX_BYTES,
  PRODUCTION_SETTINGS,
  archiveProblem,
  declaredSettingsOf,
  envEntryProblem,
  heldValues,
  packArchive,
  settingValues,
  settingsPerService,
  withRootFile
};
