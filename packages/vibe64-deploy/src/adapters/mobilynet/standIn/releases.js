import { createHash } from "node:crypto";
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
// build is `building` until the stand-in moves on, then `built`, or `failed` while `releaseBuildFails` is on. An App
// Service refreshes onto one and reads its declaration: its first service with a port, its settings and its needs.
// STAND-IN ONLY: a release from git (`{ git, deployKey }`) is refused; the stand-in takes uploads only.

const SHA256 = /^[0-9a-fA-F]{64}$/u;
const UPLOAD_MAX_BYTES = 1024 * 1024 * 1024;
const DECLARATION_FILE = "mobilynet.json";
const FIELDS = Object.freeze([
  "name", "services", "start", "check", "settings", "logins", "rootCommands", "groups", "dataPaths", "ports",
  "machineFeatures", "logs", "requiredPackages", "build", "backup", "layout", "needs"
]);
const GONE_FIELDS = Object.freeze({
  testApps: "Gone: a build never runs the app. Put your tests in build.command, such as npm ci && npm test && npm run build.",
  testSettings: "Gone: a build never runs the app, so it takes no test settings. Name the settings the build needs in build.settings.",
  setupScript: "Moved: name the setup script in build.setup."
});
const BLOCK = 512;

/** A tar header's text field, up to its first NUL. @param {Buffer} header @param {number} from @param {number} length */
const textAt = (header, from, length) => header.subarray(from, from + length).toString("utf8").replace(/\0.*$/su, "");

/**
 * mobilynet.json's bytes at a tar archive's root, or null: ustar and GNU headers (a GNU long name's `L` entry naming
 * the next), each entry's data padded to 512 bytes.
 * @param {Buffer} tar
 */
function declarationIn(tar) {
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
    if (["0", ""].includes(type) && name.replace(/^\.\//u, "") === DECLARATION_FILE) return Buffer.from(data);
  }
  return null;
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
  let bytes;
  try {
    bytes = declarationIn(gunzipSync(archive));
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
  Object.assign(errors, needsErrors(raw.needs, raw.settings));
  if (Object.keys(errors).length > 0) return { errors };
  return { declaration: { ...raw, needs: (raw.needs ?? []).map((need) => ({ interface: need.interface, as: need.as })) } };
}

/**
 * @param {{ failure: Function, nextId: (prefix: string) => string, at: () => string, now: () => Date, faults: { releaseBuildFails: boolean } }} world
 */
function createStandInReleases(world) {
  const { failure, nextId, at, now, faults } = world;
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
      build: "building",
      buildId: nextId("bld"),
      error: null,
      log: `Building ${app} ${now().toISOString().slice(0, 10).replace(/-/gu, "")}-${digest.slice(0, 7)}: running its build command\n`,
      declaration: read.declaration
    };
    versions.set(release.version, release);
    return { release, started: true };
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
        if (release.build !== "building") continue;
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
    const state = { building: "building", built: "succeeded", failed: "failed" }[release.build];
    return { text: bytes.subarray(from).toString("utf8"), next: bytes.length, state, done: release.build !== "building" };
  }

  /** A project's releases of an app, with their builds and declarations, for tests. @param {string} projectId @param {string} app */
  function list(projectId, app) {
    return [...(releases.get(keyOf(projectId, app))?.values() ?? [])].map((release) => ({
      ...view(release), build: release.build, buildId: release.buildId, declaration: structuredClone(release.declaration)
    }));
  }

  return Object.freeze({
    upload,
    named,
    view,
    advance,
    buildLog,
    list,
    invalid
  });
}

export { createStandInReleases };
