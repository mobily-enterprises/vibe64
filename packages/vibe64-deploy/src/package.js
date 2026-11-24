// The archive a deploy sends its provider, and what each service is given. The archive is the saved commit as a gzip
// tarball, made by git with no key and no provider's call, with the scripts Vibe64 makes for it added (the shared build
// script and one serve script per service, and the Deployment's machine setup script again at the root when it names
// one); each service's upload is that archive with its provider's declaration added at the root. A commit that already has a file Vibe64 makes is refused: what the app needs is said once, in
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
// The domain's other names, which Production gives the public service where the domain has any: its server sends a
// request for one on to APP_PUBLIC_URL (JSKIT's kernel). No release declares it, as no Env entry or Stack setting sets it.
const REDIRECT_SETTING = "APP_REDIRECT_HOSTS";
// A host gives it to a Staging that real people use; a production server refuses to start with it.
const STAGING_REAL_PEOPLE_SETTING = "STAGING_REACHES_REAL_PEOPLE";
const TAR_BLOCK = 512;
// The Deployment's machine setup script (its `- Machine setup:`), as every provider's upload carries it: at the
// archive's root under this name, which mobilynet's build.setup takes (a file of the app's folder, named in letters,
// digits, dots, hyphens and underscores) and an image's build runs. Its size is mobilynet's limit.
const MACHINE_SETUP_FILE = "vibe64-machine-setup.sh";
const MACHINE_SETUP_MAX_BYTES = 64 * 1024;
const MACHINE_SETUP_INVALID = "vibe64_production_machine_setup_invalid";

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
        + "mobilynet.json, Save, then deploy to production."
    };
  }
  if (scriptsFolderTaken) {
    return {
      code: "vibe64_production_folder_taken",
      message: `The saved work has its own ${APP_SCRIPTS_FOLDER}, where Vibe64 puts the build and service scripts of the `
        + "package it makes. Rename it, Save, then deploy to production."
    };
  }
  return null;
}

/**
 * Packs the commit as a gzip tarball with the scripts Vibe64 makes for it, and answers its bytes and SHA-256. With a
 * machine setup script, the commit's file it names is added again at the archive's root as MACHINE_SETUP_FILE, byte for
 * byte, which each provider's package names (machineSetupOf refuses one a host can't run). Refuses one too big to send.
 * @param {object} options
 * @param {string} options.commit
 * @param {(args: string[]) => Promise<string>} options.git
 * @param {string} options.scratch a folder git may write into
 * @param {Record<string, string>} options.scripts each script's text by its path in the release, all in vibe64-app/
 * @param {string} [options.machineSetup] the Deployment's `- Machine setup:` path, "" for none
 * @param {number} [options.maxBytes] the largest archive taken
 * @returns {Promise<{ bytes: Buffer, sha256: string }>}
 */
async function packArchive({ commit, git, scratch, scripts, machineSetup = "", maxBytes = PACKAGE_MAX_BYTES }) {
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
  let bytes = await readFile(output);
  if (machineSetup) {
    const script = machineSetupOf(gunzipSync(bytes), machineSetup);
    if (script.problem) throw packageError(script.problem.message, script.problem.code);
    if (machineSetup !== MACHINE_SETUP_FILE) bytes = withRootFile(bytes, MACHINE_SETUP_FILE, script.text).bytes;
  }
  if (bytes.length > maxBytes) {
    throw packageError(
      `The packed app is ${megabytes(bytes.length)} MiB; Production takes at most `
      + `${megabytes(maxBytes)} MiB. Keep built files and large assets out of the repository, Save, then deploy to production.`,
      "vibe64_production_package_too_large"
    );
  }
  return { bytes, sha256: sha256Of(bytes) };
}

/**
 * One entry of a tar archive by its path, as git archive writes one (ustar, with a pax header naming a path past 100
 * characters and a global one naming the commit): its tar type (`0` a file, `2` a link, `5` a folder) and its bytes, or
 * null when the archive has none.
 * @param {Buffer} tar @param {string} name
 * @returns {{ type: string, bytes: Buffer } | null}
 */
function archiveEntry(tar, name) {
  let paxPath = null;
  for (let at = 0; at + TAR_BLOCK <= tar.length && tar.subarray(at, at + TAR_BLOCK).some((byte) => byte !== 0);) {
    const field = (offset, length) => tar.subarray(at + offset, at + offset + length).toString("utf8").replace(/\0.*$/su, "");
    const size = Number.parseInt(field(124, 12).trim() || "0", 8);
    const type = field(156, 1) || "0";
    const data = tar.subarray(at + TAR_BLOCK, at + TAR_BLOCK + size);
    at += TAR_BLOCK + Math.ceil(size / TAR_BLOCK) * TAR_BLOCK;
    if (type === "g") continue;
    if (type === "x") {
      paxPath = /(?:^|\n)\d+ path=([^\n]*)\n/u.exec(data.toString("utf8"))?.[1] ?? null;
      continue;
    }
    const prefix = field(345, 155);
    const entry = (paxPath ?? (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100))).replace(/\/$/u, "");
    paxPath = null;
    if (entry === name) return { type, bytes: Buffer.from(data) };
  }
  return null;
}

/**
 * The Deployment's machine setup script in the packed commit, as its text, or why no host could run it, as `{ code,
 * message }`: it isn't there, is a link or a folder, holds nothing or more than 64 KiB, isn't UTF-8 text or holds a NUL
 * (mobilynet's own checks of a release's build.setup, so it is refused before anything is sent), or the commit has its
 * own file where Vibe64 puts it.
 * @param {Buffer} tar the packed commit, unzipped @param {string} file the Deployment's `- Machine setup:` path
 * @returns {{ text: string, problem?: undefined } | { problem: { code: string, message: string } }}
 */
function machineSetupOf(tar, file) {
  const refuse = (message, code = MACHINE_SETUP_INVALID) => ({ problem: { code, message } });
  const named = `genesis/stack.md's Deployment names the machine setup script ${file}`;
  const entry = archiveEntry(tar, file);
  if (!entry) return refuse(`${named}, which the saved work doesn't have. Commit the script there (the coding agent can do this), Save, then deploy to production.`);
  if (entry.type !== "0") {
    return refuse(`${named}, which is ${entry.type === "2" ? "a link" : "a folder"} in the saved work, not a file. Name the script itself `
      + "(the coding agent can do this), Save, then deploy to production.");
  }
  if (file !== MACHINE_SETUP_FILE && archiveEntry(tar, MACHINE_SETUP_FILE)) {
    return refuse(`The saved work has its own ${MACHINE_SETUP_FILE}, where Vibe64 puts the Deployment's machine setup script (${file}) `
      + "in the package it makes. Rename it, Save, then deploy to production.", "vibe64_production_machine_setup_taken");
  }
  const size = entry.bytes.length;
  if (size === 0 || size > MACHINE_SETUP_MAX_BYTES) {
    return refuse(`The machine setup script ${file} holds ${size.toLocaleString("en-US")} bytes, and a host takes 1 byte to 64 KiB. `
      + `${size === 0 ? "Write the script" : "Make it shorter, fetching what it installs instead of holding it"} (the coding agent can do this), Save, then deploy to production.`);
  }
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(entry.bytes);
  } catch {
    return refuse(`The machine setup script ${file} isn't UTF-8 text, and a host runs it as a script. Write it as UTF-8 text `
      + "(the coding agent can do this), Save, then deploy to production.");
  }
  if (text.includes("\u0000")) {
    return refuse(`The machine setup script ${file} holds a NUL character, which no script holds. Remove it (the coding agent can do this), Save, then deploy to production.`);
  }
  return { text };
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
 * What each service's release declares, from the Stack alone: Production's own settings and the generated secrets every
 * service, the setup code the public one and each Reaches setting the service that reaches, each `{ secret, required }`.
 * A resource's settings come from its link and are not here, nor is a Production Env entry: a release is made of the
 * code and the Stack, so a change of the Env changes no release (settingsPerService adds the Env's entries).
 * @param {object} needs needsOfStack's needs
 * @returns {Record<string, Record<string, { secret: boolean, required: boolean }>>}
 */
function stackSettingsPerService(needs) {
  const publicId = needs.services.find((service) => service.exposure === "public")?.id;
  return Object.fromEntries(needs.services.map((service) => {
    const settings = {};
    const declare = (name, secret, required) => {
      settings[name] ??= { secret, required };
    };
    for (const name of PRODUCTION_SETTINGS) declare(name, false, true);
    for (const secret of needs.generatedSecrets) declare(secret, true, true);
    if (needs.setupCode && service.id === publicId) declare(needs.setupCode, true, false);
    for (const reach of service.reaches) declare(reach.setting, false, true);
    return [service.id, settings];
  }));
}

/**
 * What each service is given: the settings its release declares (stackSettingsPerService) and each Production Env
 * entry the services it names (the public one when it names none), an entry `{ secret, required: false }`. Values are
 * the deploy's; a Deploy gives a service all of them in a settings replace, whether or not its release declares them.
 * An entry that holds no value (`valuePresent: false`, a secret not set) is checked but given to no service: a Deploy
 * has no value to send for it, so a provider's limits (mobilynet's count and names) don't meet it.
 * @param {object} needs needsOfStack's needs
 * @param {Array<{ key: string, secret?: boolean, services?: string[], valuePresent?: boolean }>} [envRecords] the
 *   Production Env's entries
 * @returns {Record<string, Record<string, { secret: boolean, required: boolean }>>}
 */
function settingsPerService(needs, envRecords = []) {
  const publicId = needs.services.find((service) => service.exposure === "public")?.id;
  for (const record of envRecords) {
    const problem = envEntryProblem(record, needs);
    if (problem) throw packageError(`${problem} Remove it from the Production Env, then deploy to production.`, "vibe64_production_env_invalid");
  }
  const declared = stackSettingsPerService(needs);
  return Object.fromEntries(needs.services.map((service) => {
    const settings = { ...declared[service.id] };
    for (const record of envRecords.filter((one) => one.valuePresent !== false)) {
      if ((record.services ?? [publicId]).includes(service.id)) settings[record.key] ??= { secret: record.secret === true, required: false };
    }
    return [service.id, settings];
  }));
}

/**
 * The values a service is given, split into settings and secrets as declared: Production's own (APP_ENV=production,
 * HOST=0.0.0.0, PORT, APP_PUBLIC_URL at the domain, TRUSTED_PROXIES as the provider names them), each Reaches setting
 * the reached service's private address, and the Production Env's values (generated secrets and the setup code
 * among them) for the names it declares. A declared name without a value is left out, never blanked. The domain's
 * other names (`aliases`, the public service's alone) are given as APP_REDIRECT_HOSTS, comma-separated, which no
 * release declares; with none there is no such setting.
 * @param {object} options
 * @param {Record<string, { secret: boolean, required: boolean }>} options.declared the service's settings (settingsPerService)
 * @param {Record<string, string>} options.env the Production Env's values by name
 * @param {string} options.domain @param {string[]} [options.aliases] @param {string} options.trustedProxies @param {number} options.port
 * @param {Record<string, string>} [options.reached] each of the service's Reaches settings with the reached service's address
 */
function settingValues({ declared, env, domain, aliases = [], trustedProxies, port, reached = {} }) {
  const own = { APP_ENV: "production", HOST: "0.0.0.0", PORT: String(port), APP_PUBLIC_URL: `https://${domain}`, TRUSTED_PROXIES: trustedProxies };
  const all = { ...env, ...reached, ...own };
  const settings = {};
  const secrets = {};
  for (const [name, { secret }] of Object.entries(declared)) {
    if (typeof all[name] === "string") (secret ? secrets : settings)[name] = all[name];
  }
  if (aliases.length > 0) settings[REDIRECT_SETTING] = aliases.join(",");
  return { settings, secrets, hash: `sha256:${sha256Of(Buffer.from(JSON.stringify([sortedObject(settings), sortedObject(secrets)])))}` };
}

/**
 * The settings a service requires that the Production Env has no value for (a generated secret it doesn't hold): each
 * required one but Production's own and the service's Reaches settings, whose values Production and the provider give.
 * @param {Record<string, { required: boolean }>} declared the service's settings (settingsPerService)
 * @param {Record<string, string>} env the Production Env's values by name
 * @param {string[]} [reaches] the service's Reaches settings
 */
function requiredWithoutValue(declared, env, reaches = []) {
  return Object.entries(declared)
    .filter(([name, { required }]) => required && !PRODUCTION_SETTINGS.includes(name) && !reaches.includes(name) && typeof env[name] !== "string")
    .map(([name]) => name);
}

function sortedObject(value) {
  return Object.fromEntries(Object.entries(value).sort(([one], [other]) => (one < other ? -1 : 1)));
}

/**
 * Why a Production Env entry can't be given to the services it names, or "": it names a service there isn't, or it is
 * a setting Production gives itself, a resource binds, or a service's own `- Setting` or Reaches sets, or
 * STAGING_REACHES_REAL_PEOPLE, which only a Staging takes.
 * @param {{ key: string, services?: string[] }} record @param {object} needs needsOfStack's needs
 */
function envEntryProblem(record, needs) {
  const ids = needs.services.map((service) => service.id);
  const unknown = (record.services ?? []).filter((id) => !ids.includes(id));
  if (unknown.length > 0) {
    return `${record.key} is given to ${unknown.join(", ")}, which this Deployment doesn't have: its services are ${ids.join(", ")}.`;
  }
  if (record.key === STAGING_REAL_PEOPLE_SETTING) {
    return `${record.key} says real people use a Staging, so Production never takes it: an app refuses to start with it there.`;
  }
  const own = needs.services.flatMap((service) => [...Object.keys(service.settings), ...service.reaches.map((reach) => reach.setting)]);
  if (PRODUCTION_SETTINGS.includes(record.key) || record.key === REDIRECT_SETTING || record.key.startsWith("V64_") || boundSettings(needs).has(record.key)
    || own.includes(record.key)) {
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
  MACHINE_SETUP_FILE,
  PACKAGE_MAX_BYTES,
  PRODUCTION_SETTINGS,
  REDIRECT_SETTING,
  archiveProblem,
  declaredSettingsOf,
  envEntryProblem,
  packArchive,
  requiredWithoutValue,
  settingValues,
  settingsPerService,
  stackSettingsPerService,
  withRootFile
};
