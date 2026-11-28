import { createHash, createPublicKey, verify } from "node:crypto";
import { gunzipSync } from "node:zlib";

import { MAX_NEEDS, NEED_NAME, interfaceNamed, isRecord, needSettings } from "./catalogue.js";

// A mobilynet project's releases of an app in the stand-in (openApiSetups.js addProjectRelease, `POST
// /v1/projects/{projectId}/apps/{app}/releases`, and openApiServices.js createServiceRelease, `POST
// /v1/services/{serviceId}/releases`): a gzip tarball uploaded as the body with its MobilyNet-Content-SHA256, checked as
// mobilynet main checks a release's (its apps package's releaseArchive.js and declaration.js, build model of 16 Nov):
// mobilynet.json at the archive's root, a JSON object for this app, with only the fields mobilynet knows, none of those
// the build model took out, a build block saying what it keeps, and its needs (hostedDeclaration.js needsOf: each
// `{ interface, as }` of an interface mobilynet provides, named once, giving no setting the app declares itself). The
// same bytes again answer the release they made, its version the day and the first 7 hex digits of its SHA-256. Its
// build is `building` until the stand-in moves on, then `built`, or `failed` while `releaseBuildFails` is on; while
// `buildsWait` is on it is first `queued`, waiting as that fault says, until the stand-in moves on with it off. A build
// is read (`GET /v1/builds/{id}`, with its `waiting` and `estimate` while queued) and ended (`POST
// /v1/builds/{id}/actions/end`: a queued or running one fails `cancelled`), as mobilynet's buildCalls.js answers them,
// and a refresh onto a release whose build was ended builds it again (machines' serviceEngine.js currentRefresh builds
// one whose build failed). An App
// Service refreshes onto one and reads its declaration: its first service with a port, its settings and its needs.
// A build block's `setup` names the release's setup script as mobilynet's declaration.js and releaseArchive.js check it
// (main 50c51a16): a plain file name, never mobilynet.json, of a regular file at the archive's root holding 1 byte to
// 64 KiB of UTF-8 text without NUL, each refused `422` under `declaration.build.setup` in mobilynet's words.
// A prebuilt release of a machine's app (`prebuilt`, mobilynet's prebuiltRelease.js and metal/hostd/lib/
// releaseSignature.js, its docs/self-hosting.md B3) is an output built elsewhere: a plain tar of manifest.json,
// manifest.sig and output.tar, in that order, checked at once in mobilynet's order and words, each refusal `422` under
// its field: the signature against each of the project's release keys (Ed25519 over RELEASE_CONTEXT and the manifest's
// bytes), and the manifest naming that key, under `signature` (`manifest` for a manifest that isn't one); the
// MobilyNet-Content-SHA256 as the manifest's output (`upload`); the output's size and SHA-256 as the manifest's
// (`output`); its mobilynet.json first, the one the manifest names (`declaration`), for the app, and running no build
// (`declaration.build`). It joins the project's releases of the app, built: nothing runs. The same output again answers
// the release it made; one released before as a build from source is refused.
// STAND-IN ONLY: a release from git (`{ git, deployKey }`) is refused; the stand-in takes uploads only. A prebuilt
// output's store paths are not checked, nor its declaration beyond its fields, its name and its build.

const SHA256 = /^[0-9a-fA-F]{64}$/u;
const UPLOAD_MAX_BYTES = 1024 * 1024 * 1024;
const DECLARATION_FILE = "mobilynet.json";
const FIELDS = Object.freeze([
  "name", "services", "start", "check", "settings", "logins", "rootCommands", "groups", "dataPaths", "ports",
  "machineFeatures", "logs", "requiredPackages", "build", "backup", "layout", "needs", "tasks"
]);
// A release's tasks (mobilynet's release tasks, its apps package's declaration.js tasksOf, main 17340a6a): `{ <name>: {
// command } }`, at most 10, a name as its TASK_NAME, a command as `start`'s (a path in the app's folder or a program on
// its PATH, then plain words, no quoting or variables), each run once by a refresh that asks for it, after its build
// passed and before any instance starts (services.js, serviceEngine.js).
const TASK_NAME = /^[a-z][a-z0-9-]{0,39}$/u;
const MAX_TASKS = 10;
const COMMAND = /^[A-Za-z0-9_+-][A-Za-z0-9._+-]*(?:\/[A-Za-z0-9._+-]+)*(?: [A-Za-z0-9._,:=@+/-]+)*$/u;
const MAX_COMMAND = 1000;

/** Why a release task is refused, or "", as mobilynet says it. @param {string} name @param {unknown} task */
function taskProblem(name, task) {
  if (!TASK_NAME.test(name)) return "A task's name: a lowercase letter, then up to 39 lowercase letters, digits and hyphens.";
  if (!isRecord(task)) return "A release task: { command }.";
  const extra = Object.keys(task).find((key) => key !== "command");
  if (extra !== undefined) return `Unknown field ${JSON.stringify(extra)}: a release task is { command }.`;
  const { command } = task;
  if (typeof command !== "string" || command.length > MAX_COMMAND || !COMMAND.test(command)
    || command.split(" ")[0].split("/").some((part) => part === "." || part === "..")) {
    return `A path in the app's folder (its build's output) or a program on its PATH, then plain words separated by single spaces (no quotes or variables), up to ${MAX_COMMAND} characters, such as bin/server --port 3000 or node dist/server.js.`;
  }
  return "";
}

/** The field errors of a declaration's `tasks`. @param {unknown} tasks */
function tasksErrors(tasks) {
  if (tasks === undefined) return {};
  if (!isRecord(tasks)) return { "declaration.tasks": "An object of the app's release tasks by name, each { command }, such as { \"migrate\": { \"command\": \"bin/migrate\" } }." };
  const names = Object.keys(tasks);
  const errors = names.length > MAX_TASKS ? { "declaration.tasks": `At most ${MAX_TASKS} release tasks.` } : {};
  for (const name of names.slice(0, MAX_TASKS)) {
    const why = taskProblem(name, tasks[name]);
    if (why) errors[`declaration.tasks.${name}`] = why;
  }
  return errors;
}
const GONE_FIELDS = Object.freeze({
  testApps: "Gone: a build never runs the app. Put your tests in build.command, such as npm ci && npm test && npm run build.",
  testSettings: "Gone: a build never runs the app, so it takes no test settings. Name the settings the build needs in build.settings.",
  setupScript: "Moved: name the setup script in build.setup."
});
const BLOCK = 512;
// A setup script's name and size, as mobilynet's declaration.js takes them.
const SETUP_SCRIPT = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}$/u;
const SETUP_SCRIPT_BYTES = 64 * 1024;

/** A tar header's text field, up to its first NUL. @param {Buffer} header @param {number} from @param {number} length */
const textAt = (header, from, length) => header.subarray(from, from + length).toString("utf8").replace(/\0.*$/su, "");

/**
 * A file at a tar archive's root, `{ type, bytes }` (its tar type: `0` a regular file), or null: ustar and GNU headers
 * (a GNU long name's `L` entry naming the next), each entry's data padded to 512 bytes.
 * @param {Buffer} tar @param {string} file
 */
function rootEntryIn(tar, file) {
  let offset = 0;
  let longName = null;
  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) return null;
    const size = Number.parseInt(textAt(header, 124, 12).trim() || "0", 8);
    const type = textAt(header, 156, 1);
    const prefix = textAt(header, 345, 155);
    const data = tar.subarray(offset + BLOCK, offset + BLOCK + size);
    offset += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
    if (type === "L") {
      longName = data.toString("utf8").replace(/\0.*$/su, "");
      continue;
    }
    const name = longName ?? (prefix ? `${prefix}/${textAt(header, 0, 100)}` : textAt(header, 0, 100));
    longName = null;
    if (name.replace(/^\.\//u, "") === file) return { type: type || "0", bytes: Buffer.from(data) };
  }
  return null;
}

/** mobilynet.json's bytes at a tar archive's root, or null. @param {Buffer} tar */
function declarationIn(tar) {
  const entry = rootEntryIn(tar, DECLARATION_FILE);
  return entry?.type === "0" ? entry.bytes : null;
}

/**
 * Why a declaration's build.setup is refused, in mobilynet's words, or "": a name no setup script has, or no regular
 * file of 1 byte to 64 KiB of UTF-8 text without NUL at the archive's root.
 * @param {Buffer} tar @param {unknown} name
 */
function setupProblem(tar, name) {
  if (typeof name !== "string" || !SETUP_SCRIPT.test(name) || name === DECLARATION_FILE) {
    return "The name of a file in the app's folder, such as setup.sh: letters, digits, dots, hyphens and underscores, at most 100.";
  }
  const entry = rootEntryIn(tar, name);
  if (entry?.type !== "0") return `The declaration's build.setup names ${name}, which isn't a regular file in the app's folder.`;
  const size = entry.bytes.length;
  if (size === 0 || size > SETUP_SCRIPT_BYTES) return `${name} must hold 1 byte to 64 KiB; it holds ${size}.`;
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(entry.bytes);
  } catch {
    return `${name} isn't UTF-8 text.`;
  }
  return text.includes("\u0000") ? `${name} holds a NUL character.` : "";
}

/**
 * A declaration's needs' errors, as mobilynet's needsOf words them.
 * @param {unknown} needs @param {unknown} settings the declaration's own settings
 */
function needsErrors(needs, settings) {
  if (needs === undefined) return {};
  if (!Array.isArray(needs) || needs.length > MAX_NEEDS) return { "declaration.needs": `A list of up to ${MAX_NEEDS} needs.` };
  const declared = isRecord(settings) ? settings : {};
  const errors = {};
  const named = [];
  needs.forEach((need, index) => {
    const at = `declaration.needs.${index}`;
    if (!isRecord(need)) {
      errors[at] = "An object with interface and as.";
      return;
    }
    const unknown = Object.keys(need).find((key) => !["interface", "as"].includes(key));
    if (unknown) errors[at] = `Unknown field ${unknown}.`;
    else if (!interfaceNamed(need.interface)) errors[at] = "interface: one MobilyNet provides, such as postgresql.";
    else if (typeof need.as !== "string" || !NEED_NAME.test(need.as)) errors[at] = "as: a capital letter, then up to 23 capital letters, digits and underscores, such as DB.";
    if (errors[at]) return;
    const clash = needSettings(need).find((entry) => Object.hasOwn(declared, entry.name));
    if (named.includes(need.as)) {
      errors[`${at}.as`] = `Another need is already named ${need.as}.`;
    } else if (clash) {
      errors[`${at}.as`] = `Its link gives the setting ${clash.name}, which the app declares itself: leave ${clash.name} out of settings, or name the need otherwise.`;
    } else {
      named.push(need.as);
    }
  });
  return errors;
}

/**
 * The declaration a release's upload carries, or the field errors mobilynet main refuses it with (`archive`,
 * `declaration`, `declaration.<field>`).
 * @param {Buffer} archive the release's gzip tarball
 * @param {string} appName the app the release is for
 * @returns {{ errors: Record<string, string> } | { declaration: any }}
 */
function declarationOf(archive, appName) {
  let tar;
  let bytes;
  try {
    tar = gunzipSync(archive);
    bytes = declarationIn(tar);
  } catch (error) {
    return { errors: { archive: `Not a gzip tarball: ${error.message}` } };
  }
  if (!bytes) {
    return { errors: { declaration: `No ${DECLARATION_FILE} at the archive's root: a release holds its declaration, which says how it is built, at its root.` } };
  }
  let raw;
  try {
    raw = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    return { errors: { declaration: `${DECLARATION_FILE} isn't valid JSON: ${error.message}` } };
  }
  if (!isRecord(raw)) return { errors: { declaration: `${DECLARATION_FILE} must hold a JSON object.` } };
  const errors = {};
  for (const key of Object.keys(raw)) {
    if (Object.hasOwn(GONE_FIELDS, key)) errors[`declaration.${key}`] = GONE_FIELDS[key];
    else if (!FIELDS.includes(key)) errors[`declaration.${key}`] = "Unknown field.";
  }
  if (raw.name !== appName) errors["declaration.name"] = `Must be ${JSON.stringify(appName)}, the app this release is for.`;
  if (!isRecord(raw.build)) {
    errors["declaration.build"] = "Required: how the app is built, as { \"command\": \"npm ci && npm run build\", \"output\": [\"dist\", \"node_modules\", \"package.json\"] }.";
  } else if (!Array.isArray(raw.build.output) || raw.build.output.length === 0) {
    errors["declaration.build.output"] = "Required: the paths the build keeps as the app's output, such as [\"dist\", \"node_modules\", \"package.json\"], or [\".\"].";
  }
  Object.assign(errors, needsErrors(raw.needs, raw.settings), tasksErrors(raw.tasks));
  if (isRecord(raw.build) && raw.build.setup !== undefined) {
    // mobilynet reads the script only once the rest of the declaration holds.
    const named = typeof raw.build.setup === "string" && SETUP_SCRIPT.test(raw.build.setup) && raw.build.setup !== DECLARATION_FILE;
    const why = named && Object.keys(errors).length > 0 ? "" : setupProblem(tar, raw.build.setup);
    if (why) errors["declaration.build.setup"] = why;
  }
  if (Object.keys(errors).length > 0) return { errors };
  return { declaration: { ...raw, needs: (raw.needs ?? []).map((need) => ({ interface: need.interface, as: need.as })) } };
}

// What a release key signs: this context, then the manifest's bytes, never the manifest alone (releaseSignature.js).
const RELEASE_CONTEXT = "mobilynet-release-v1\n";
const MANIFEST_FORMAT = "mobilynet-release-manifest-1";
const MOST_MANIFEST_BYTES = 1024 * 1024;
const MOST_SIGNATURE_BYTES = 512;
const MOST_PREBUILT_OUTPUT_BYTES = 4 * 1024 * 1024 * 1024;
// After output.tar: the archive's end, its two zero blocks and the padding a tar may add to its last record.
const MOST_TRAILER_BYTES = 20 * BLOCK;
const HEX64 = /^[0-9a-f]{64}$/u;
const SIGNATURE = /^[A-Za-z0-9+/]{86}==$/u;
const PREBUILT_MEMBERS = Object.freeze(["manifest.json", "manifest.sig", "output.tar"]);
const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** Whether a tar header's checksum is its own. @param {Buffer} header */
function checksumOk(header) {
  let sum = 0;
  for (let at = 0; at < BLOCK; at += 1) sum += at >= 148 && at < 156 ? 0x20 : header[at];
  const field = header.toString("latin1", 148, 156).replace(/[\0 ]+$/u, "").trim();
  return /^[0-7]{1,8}$/u.test(field) && Number.parseInt(field, 8) === sum;
}

/**
 * A prebuilt release's upload read in order (prebuiltRelease.js member, textOf and rest): manifest.json, manifest.sig and
 * output.tar, each the next regular file of at most its size, then only zeros; or the refusal under its field.
 * @param {Buffer} tar
 * @returns {{ refusal: { field: string, message: string } } | { members: Buffer[] }}
 */
function prebuiltMembers(tar) {
  const most = { "manifest.json": [MOST_MANIFEST_BYTES, "manifest"], "manifest.sig": [MOST_SIGNATURE_BYTES, "signature"], "output.tar": [MOST_PREBUILT_OUTPUT_BYTES, "output"] };
  const members = [];
  let offset = 0;
  for (const name of PREBUILT_MEMBERS) {
    const header = tar.subarray(offset, offset + BLOCK);
    if (header.length < BLOCK) return { refusal: { field: "upload", message: "The upload ends early: it was cut short." } };
    const said = textAt(header, 0, 100).replace(/^\.\//u, "");
    const flag = String.fromCharCode(header[156]);
    const sizeField = header.toString("latin1", 124, 136).replace(/[\0 ]+$/u, "").trim();
    if (header.every((byte) => byte === 0) || !checksumOk(header) || said !== name || !["0", "\0"].includes(flag) || !/^[0-7]{1,12}$/u.test(sizeField)) {
      return { refusal: { field: "upload", message: `A prebuilt release's upload is a plain tar of manifest.json, manifest.sig and output.tar, in that order: ${name} isn't next.` } };
    }
    const size = Number.parseInt(sizeField, 8);
    const [limit, field] = most[name];
    if (size > limit) return { refusal: { field, message: `${name} is over ${limit} bytes.` } };
    if (offset + BLOCK + size > tar.length) return { refusal: { field: "upload", message: "The upload ends early: it was cut short." } };
    members.push(tar.subarray(offset + BLOCK, offset + BLOCK + size));
    offset += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
  }
  const rest = tar.subarray(Math.min(offset, tar.length));
  if (rest.length > MOST_TRAILER_BYTES || rest.some((byte) => byte !== 0)) {
    return { refusal: { field: "upload", message: "Something follows output.tar: the upload is manifest.json, manifest.sig and output.tar, then the archive's end." } };
  }
  return { members };
}

/** A manifest's fields when it is one (releaseSignature.js manifestOf), or null. @param {string} manifest */
function manifestFields(manifest) {
  let parsed = null;
  try {
    parsed = JSON.parse(manifest);
  } catch {
    return null;
  }
  return isRecord(parsed) && parsed.format === MANIFEST_FORMAT && HEX64.test(String(parsed.key ?? "")) && HEX64.test(String(parsed.output?.sha256 ?? "")) ? parsed : null;
}

/**
 * The manifest a release key signed (releaseSignature.js verifyRelease): `{ fields }`, or `{ code, message }` naming why
 * not: no signature, another key's, or a manifest that isn't one or names another key.
 * @param {string} manifest @param {string} signature @param {{ publicKey: string, fingerprint: string }} key
 */
function verifiedBy(manifest, signature, key) {
  if (manifest.length === 0 || Buffer.byteLength(manifest) > MOST_MANIFEST_BYTES) {
    return { code: "release_manifest_invalid", message: `A release's manifest is JSON text of at most ${MOST_MANIFEST_BYTES} bytes.` };
  }
  if (!SIGNATURE.test(signature)) return { code: "release_unsigned", message: "The release carries no signature: an Ed25519 signature, base64." };
  const publicKey = createPublicKey({ key: Buffer.from(key.publicKey, "base64"), format: "der", type: "spki" });
  if (!verify(null, Buffer.concat([Buffer.from(RELEASE_CONTEXT, "utf8"), Buffer.from(manifest, "utf8")]), publicKey, Buffer.from(signature, "base64"))) {
    return { code: "release_signature_invalid", message: `The release isn't signed by the key ${key.fingerprint}.` };
  }
  const fields = manifestFields(manifest);
  if (!fields) {
    return { code: "release_manifest_invalid", message: `A release's manifest is JSON of format ${MANIFEST_FORMAT}, naming its output's SHA-256 and its key's fingerprint.` };
  }
  if (fields.key !== key.fingerprint) return { code: "release_key_mismatch", message: `The manifest names the key ${fields.key}, not ${key.fingerprint}.` };
  return { fields };
}

/**
 * The project's key whose signature the manifest carries (prebuiltRelease.js signedBy): the first that verifies, or the
 * refusal under `signature` (`manifest` for one that isn't a manifest), as a project with no key is refused.
 * @param {ReadonlyArray<{ name: string, publicKey: string, fingerprint: string }>} keys @param {string} manifest @param {string} signature
 */
function signedBy(keys, manifest, signature) {
  if (keys.length === 0) return { refusal: { field: "signature", message: "The project has no release key: an owner or admin adds one first, in the customer area." } };
  let refused = null;
  for (const key of keys) {
    const checked = verifiedBy(manifest, signature, key);
    if (checked.fields) return { key, fields: checked.fields };
    // Another key's signature tells nothing; any other refusal is the same whichever key is tried.
    if (checked.code !== "release_signature_invalid") return { refusal: { field: checked.code === "release_manifest_invalid" ? "manifest" : "signature", message: checked.message } };
    refused = checked;
  }
  return {
    refusal: {
      field: "signature",
      message: `The release isn't signed by any of the project's release keys (${keys.map((key) => key.fingerprint.slice(0, 12)).join(", ")}): ${refused.message}`
    }
  };
}

/**
 * A prebuilt output's declaration (prebuiltRelease.js declarationOf): its first entry after its root folder, the
 * mobilynet.json the manifest names, a JSON object for this app with only the fields mobilynet knows, running no build.
 * @param {Buffer} output @param {Record<string, any>} fields the manifest's @param {string} appName
 * @returns {{ refusal: Record<string, string> } | { declaration: any }}
 */
function prebuiltDeclarationOf(output, fields, appName) {
  const wanted = String(fields.declaration?.sha256 ?? "");
  if (!HEX64.test(wanted)) return { refusal: { manifest: "A prebuilt release's manifest names its declaration's SHA-256: { \"declaration\": { \"sha256\": \"…\" } }." } };
  let offset = 0;
  let entry = null;
  while (offset + BLOCK <= output.length) {
    const header = output.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) break;
    const size = Number.parseInt(textAt(header, 124, 12).trim() || "0", 8);
    const name = textAt(header, 0, 100).replace(/^\.?\//u, "");
    const type = textAt(header, 156, 1) || "0";
    if (!(type === "5" && (name === "" || name === "."))) {
      entry = { name, type, bytes: output.subarray(offset + BLOCK, offset + BLOCK + size) };
      break;
    }
    offset += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
  }
  if (!entry || entry.name !== DECLARATION_FILE || entry.type !== "0") {
    return { refusal: { declaration: `The output's first entry is its ${DECLARATION_FILE}, a file.` } };
  }
  const sha256 = createHash("sha256").update(entry.bytes).digest("hex");
  if (sha256 !== wanted) return { refusal: { declaration: `The output's ${DECLARATION_FILE} has the SHA-256 ${sha256}; its manifest names ${wanted}.` } };
  let raw;
  try {
    raw = JSON.parse(UTF8.decode(entry.bytes));
  } catch (error) {
    return { refusal: { declaration: `${DECLARATION_FILE} isn't valid JSON text: ${error.message}` } };
  }
  if (!isRecord(raw)) return { refusal: { declaration: `${DECLARATION_FILE} must hold a JSON object.` } };
  const errors = {};
  for (const key of Object.keys(raw)) {
    if (Object.hasOwn(GONE_FIELDS, key)) errors[`declaration.${key}`] = GONE_FIELDS[key];
    else if (!FIELDS.includes(key)) errors[`declaration.${key}`] = "Unknown field.";
  }
  if (raw.name !== appName) errors["declaration.name"] = `Must be ${JSON.stringify(appName)}, the app this release is for.`;
  if (Object.keys(errors).length > 0) return { refusal: errors };
  const { build } = raw;
  const plain = isRecord(build) && Object.keys(build).length === 1 && Array.isArray(build.output) && build.output.length === 1 && build.output[0] === ".";
  if (!plain) {
    return { refusal: { "declaration.build": "A prebuilt release runs no build: its build is { \"output\": [\".\"] } alone, with no setup, command, packages, settings or cache." } };
  }
  return { declaration: raw };
}

/**
 * @param {{ failure: Function, nextId: (prefix: string) => string, at: () => string, now: () => Date, faults: { releaseBuildFails: boolean, buildsWait: any } }} world
 */
function createStandInReleases(world) {
  const { failure, nextId, at, now, faults } = world;
  // A build's states as mobilynet names them, by the stand-in's.
  const BUILD_STATES = Object.freeze({ queued: "queued", building: "building", built: "succeeded", failed: "failed" });
  /** @type {Map<string, Map<string, any>>} each mobilynet project's app's releases (`<project> <app>`), by version */
  const releases = new Map();
  const keyOf = (projectId, app) => `${projectId} ${app}`;

  /** mobilynet's validationFailed: `422 validation_failed`, `Check <fields>.` with the field errors. @param {Record<string, string>} fieldErrors */
  const invalid = (fieldErrors) => failure(422, "validation_failed", `Check ${Object.keys(fieldErrors).join(", ")}.`, { fieldErrors });

  /** A release as mobilynet answers it: its build and declaration kept apart. @param {any} release */
  const view = (release) => ({
    version: release.version,
    state: release.state,
    source: structuredClone(release.source),
    declaration: null,
    createdAt: release.createdAt,
    retiredAt: release.retiredAt
  });

  /**
   * A release of an app in a mobilynet project from an upload: refused as mobilynet refuses one, or the release (the
   * same bytes' again), with `started` true when its build began now (a new release).
   * @param {string} projectId @param {string} app @param {unknown} archive @param {string | undefined} sha256
   * @returns {{ refusal: any } | { release: any, started: boolean }}
   */
  function upload(projectId, app, archive, sha256) {
    if (!Buffer.isBuffer(archive)) return { refusal: invalid({ git: "The stand-in takes a release as its uploaded tarball only." }) };
    if (archive.length === 0 || archive.length > UPLOAD_MAX_BYTES) return { refusal: invalid({ archive: "The release's tarball, at most 1 GiB." }) };
    const digest = createHash("sha256").update(archive).digest("hex");
    if (!SHA256.test(String(sha256 || "")) || String(sha256).toLowerCase() !== digest) {
      return { refusal: invalid({ archive: "Doesn't match its MobilyNet-Content-SHA256." }) };
    }
    const read = declarationOf(archive, app);
    if (read.errors) return { refusal: invalid(read.errors) };
    const versions = releases.get(keyOf(projectId, app)) ?? new Map();
    releases.set(keyOf(projectId, app), versions);
    const known = [...versions.values()].find((one) => one.source.upload.sha256 === digest);
    if (known) return { release: known, started: false };
    const release = {
      projectId,
      app,
      version: `${now().toISOString().slice(0, 10).replace(/-/gu, "")}-${digest.slice(0, 7)}`,
      state: "active",
      source: { upload: { sha256: digest, sizeBytes: archive.length, deletedAt: null } },
      createdAt: at(),
      retiredAt: null,
      ...newBuild(),
      log: `Building ${app} ${now().toISOString().slice(0, 10).replace(/-/gu, "")}-${digest.slice(0, 7)}: running its build command\n`,
      declaration: read.declaration
    };
    versions.set(release.version, release);
    return { release, started: true };
  }

  /**
   * A prebuilt release of an app from its upload (prebuiltRelease.js openPrebuilt, releases.js fromPrebuilt): refused
   * `422` under its field, in mobilynet's order and words, or the release (the same output's again), `started` true for
   * a new one. Its output is checked and kept: no build runs, so it is built at once.
   * @param {string} projectId @param {string} app @param {Buffer} body the plain tar of manifest.json, manifest.sig and output.tar
   * @param {string | undefined} sha256 its MobilyNet-Content-SHA256, the output's when sent
   * @param {ReadonlyArray<{ name: string, publicKey: string, fingerprint: string }>} keys the project's release keys
   * @returns {{ refusal: any } | { release: any, started: boolean }}
   */
  function prebuilt(projectId, app, body, sha256, keys) {
    const refused = (fieldErrors) => ({ refusal: invalid(fieldErrors) });
    if (sha256 !== undefined && !SHA256.test(String(sha256))) return refused({ upload: "MobilyNet-Content-SHA256 is the output's SHA-256: 64 hexadecimal digits." });
    const read = prebuiltMembers(body);
    if (read.refusal) return refused({ [read.refusal.field]: read.refusal.message });
    const [manifestBytes, signatureBytes, output] = read.members;
    let manifest;
    let signature;
    try {
      manifest = UTF8.decode(manifestBytes);
    } catch {
      return refused({ manifest: "It isn't UTF-8 text." });
    }
    try {
      signature = UTF8.decode(signatureBytes).trim();
    } catch {
      return refused({ signature: "It isn't UTF-8 text." });
    }
    const signed = signedBy(keys, manifest, signature);
    if (signed.refusal) return refused({ [signed.refusal.field]: signed.refusal.message });
    const { fields, key } = signed;
    if (sha256 !== undefined && String(sha256).toLowerCase() !== fields.output.sha256) {
      return refused({ upload: `MobilyNet-Content-SHA256 is ${String(sha256).toLowerCase()}; the manifest names the output ${fields.output.sha256}.` });
    }
    const versions = releases.get(keyOf(projectId, app)) ?? new Map();
    const existing = [...versions.values()].find((one) => one.source.upload.sha256 === fields.output.sha256);
    if (existing && !existing.prebuilt) return refused({ output: "This output was released before as a build from source: a prebuilt release is a new output." });
    if (existing) return { release: existing, started: false };
    const bytes = Number(fields.output?.bytes);
    if (!Number.isSafeInteger(bytes) || bytes < 1) {
      return refused({ manifest: "A prebuilt release's manifest names its output's size in bytes: { \"output\": { \"sha256\": \"…\", \"bytes\": … } }." });
    }
    if (output.length !== bytes) return refused({ output: `output.tar is ${output.length} bytes; its manifest names ${bytes}.` });
    const digest = createHash("sha256").update(output).digest("hex");
    if (digest !== fields.output.sha256) return refused({ output: `The output's SHA-256 is ${digest}; its manifest names ${fields.output.sha256}.` });
    const taken = prebuiltDeclarationOf(output, fields, app);
    if (taken.refusal) return refused(taken.refusal);
    const version = `${now().toISOString().slice(0, 10).replace(/-/gu, "")}-${digest.slice(0, 7)}`;
    const release = {
      projectId,
      app,
      version,
      state: "active",
      source: { upload: { sha256: digest, sizeBytes: output.length, deletedAt: null } },
      createdAt: at(),
      retiredAt: null,
      build: "built",
      buildId: nextId("bld"),
      error: null,
      buildCreatedAt: at(),
      buildStartedAt: at(),
      buildFinishedAt: at(),
      log: `Checked the prebuilt output of ${app} ${version}, signed by ${key.name} (${key.fingerprint.slice(0, 12)}): nothing to build\n`,
      declaration: taken.declaration,
      prebuilt: { fingerprint: key.fingerprint, keyName: key.name }
    };
    versions.set(version, release);
    releases.set(keyOf(projectId, app), versions);
    return { release, started: true };
  }

  /** A release's new build: queued while `buildsWait` is on, else building at once. */
  function newBuild() {
    const queued = Boolean(faults.buildsWait);
    return { build: queued ? "queued" : "building", buildId: nextId("bld"), error: null, buildCreatedAt: at(), buildStartedAt: queued ? null : at(), buildFinishedAt: null };
  }

  /** Builds a release whose build failed again, as a refresh onto it does: a new build. @param {any} release */
  function rebuild(release) {
    Object.assign(release, newBuild());
    release.log += "Building it again.\n";
  }

  /** A mobilynet project's release of an app by its version, or null. @param {string} projectId @param {string} app @param {string} version */
  const named = (projectId, app, version) => releases.get(keyOf(projectId, app))?.get(String(version)) ?? null;

  /**
   * Builds every release still building, or fails it while `releaseBuildFails` is on: `true`, its build command's exit;
   * `{ code, message }`, that failure, which the refresh then names too, as mobilynet named a build's output past its
   * limit (`output_too_large`, "The output is 4440 MiB; it may be at most 4096 MiB.", 18 Nov).
   */
  function advance() {
    const fault = faults.releaseBuildFails;
    for (const versions of releases.values()) {
      for (const release of versions.values()) {
        // A queued build starts once nothing holds it: it builds at the next step.
        if (release.build === "queued") {
          if (!faults.buildsWait) Object.assign(release, { build: "building", buildStartedAt: at() });
          continue;
        }
        if (release.build !== "building") continue;
        release.buildFinishedAt = at();
        release.build = fault ? "failed" : "built";
        release.error = !fault ? null
          : fault === true ? { code: "build_failed", message: "The build command exited with status 1." }
            : { code: String(fault.code ?? "build_failed"), message: String(fault.message), named: true };
        release.log += release.error ? `${release.error.message}\n` : "The build passed.\n";
      }
    }
  }

  /**
   * A build's log from byte `after` (`GET /v1/builds/{id}/log`, as mobilynet's buildCalls.js followLog answers it):
   * `{ text, next, state, done }`, its state `building`, `succeeded` or `failed`; another project's build is not found.
   * STAND-IN ONLY: `wait` is not waited; the text is the stand-in's own lines.
   * @param {(projectId: string) => boolean} reaches whether the caller's key reaches a project @param {string} buildId
   * @param {number} after
   */
  function buildLog(reaches, buildId, after) {
    const release = [...releases.values()].flatMap((versions) => [...versions.values()]).find((one) => one.buildId === buildId);
    if (!release || !reaches(release.projectId)) return null;
    const bytes = Buffer.from(release.log, "utf8");
    const from = Math.min(Math.max(0, after), bytes.length);
    const state = BUILD_STATES[release.build];
    return { text: bytes.subarray(from).toString("utf8"), next: bytes.length, state, done: !["queued", "building"].includes(release.build) };
  }

  /** The release a build id is of, when the caller's key reaches its project. @param {(projectId: string) => boolean} reaches @param {string} buildId */
  function releaseOfBuild(reaches, buildId) {
    const release = [...releases.values()].flatMap((versions) => [...versions.values()]).find((one) => one.buildId === buildId);
    return release && reaches(release.projectId) ? release : null;
  }

  /**
   * A build as mobilynet's buildCalls.js read answers it (`{ build }`): a queued one's `waiting` and `estimate` as the
   * `buildsWait` fault says (`true`: its project's other build goes first; an object: its `for`, `words`, `latestAt`
   * and `startsBy`), a running one's `estimate` with its start. STAND-IN ONLY: no log, kind or target in it.
   * @param {any} release
   */
  function buildView(release) {
    const state = BUILD_STATES[release.build];
    const wait = faults.buildsWait === true ? { for: "project", words: "Its project builds one at a time: another of its builds goes first." } : faults.buildsWait || {};
    const queued = state === "queued";
    return {
      id: release.buildId,
      app: release.app,
      version: release.version,
      state,
      waiting: queued ? { for: wait.for ?? "send", words: wait.words ?? "It goes to a build server within 10 seconds.", ahead: null, ...(wait.latestAt ? { latestAt: wait.latestAt } : {}) } : null,
      estimate: queued || state === "building"
        ? { startsBy: queued ? wait.startsBy ?? null : release.buildStartedAt, endsBy: null, limitAt: null, words: "" }
        : null,
      error: release.build === "failed" ? { code: release.error?.code ?? "build_failed", message: release.error?.message ?? "" } : null,
      createdAt: release.buildCreatedAt ?? release.createdAt,
      startedAt: release.buildStartedAt ?? null,
      finishedAt: release.buildFinishedAt ?? null
    };
  }

  /** `GET /v1/builds/{id}`: the build, or null when the caller's key reaches none by that id. */
  function readBuild(reaches, buildId) {
    const release = releaseOfBuild(reaches, buildId);
    return release ? { build: buildView(release) } : null;
  }

  /**
   * `POST /v1/builds/{id}/actions/end`: a queued or running build fails `cancelled` (whatever waits on it fails with it
   * at the next step); one that ended is `409 invalid_state`. Null when the caller's key reaches none by that id.
   */
  function endBuild(reaches, buildId) {
    const release = releaseOfBuild(reaches, buildId);
    if (!release) return null;
    if (!["queued", "building"].includes(release.build)) {
      return failure(409, "invalid_state", "The build has finished and keeps no VM: there is nothing to end.", { state: BUILD_STATES[release.build] });
    }
    const message = release.build === "queued" ? "The build was ended before it started." : "The build was ended.";
    Object.assign(release, { build: "failed", error: { code: "cancelled", message }, buildFinishedAt: at() });
    release.log += `${message}\n`;
    return { status: 200, body: { build: buildView(release) } };
  }

  /** A project's releases of an app, with their builds and declarations, for tests. @param {string} projectId @param {string} app */
  function list(projectId, app) {
    return [...(releases.get(keyOf(projectId, app))?.values() ?? [])].map((release) => ({
      ...view(release), build: release.build, buildId: release.buildId, declaration: structuredClone(release.declaration)
    }));
  }

  return Object.freeze({
    upload,
    prebuilt,
    named,
    view,
    advance,
    rebuild,
    buildLog,
    readBuild,
    endBuild,
    list,
    invalid
  });
}

export { TASK_NAME, createStandInReleases };
