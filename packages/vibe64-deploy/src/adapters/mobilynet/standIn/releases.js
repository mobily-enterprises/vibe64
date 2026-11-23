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
// build is `building` until the stand-in moves on, then `built`, or `failed` while `releaseBuildFails` is on; while
// `buildsWait` is on it is first `queued`, waiting as that fault says, until the stand-in moves on with it off. A build
// is read (`GET /v1/builds/{id}`, with its `waiting` and `estimate` while queued) and ended (`POST
// /v1/builds/{id}/actions/end`: a queued or running one fails `cancelled`), as mobilynet's buildCalls.js answers them,
// and a refresh onto a release whose build was ended builds it again (machines' serviceEngine.js currentRefresh builds
// one whose build failed). An App
// Service refreshes onto one and reads its declaration: its first service with a port, its settings and its needs.
// STAND-IN ONLY: a release from git (`{ git, deployKey }`) is refused; the stand-in takes uploads only.

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
  Object.assign(errors, needsErrors(raw.needs, raw.settings), tasksErrors(raw.tasks));
  if (Object.keys(errors).length > 0) return { errors };
  return { declaration: { ...raw, needs: (raw.needs ?? []).map((need) => ({ interface: need.interface, as: need.as })) } };
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
