import { createHash, createPublicKey } from "node:crypto";

import { pageOf } from "./catalogue.js";

// A mobilynet project's machines as the stand-in answers a signed release's calls to them (mobilynet's openApiVps.js
// listVps, openApiApps.js listVpsApps, readVpsApp and createAppRelease's prebuilt release, openApiReleaseKeys.js): each
// machine with its state and region, its apps (an app of the project's releases, its version, or a catalogue package's),
// and the project's release keys, the Ed25519 public keys a prebuilt release's manifest is signed with. A prebuilt
// release (`MobilyNet-Release: prebuilt`) is checked at once, as mobilynet's prebuiltRelease.js checks it
// (releases.js prebuilt), and answers `202` with the app moving to it: the next step checks and keeps its output (the
// build that runs nothing), the one after attaches it, and its check passes, or fails while `switchBack` is on, when
// the host switches the app back to the version it ran, saying why in its `lastFailure`, as mobilynet's B4 does. The
// same output again answers the release it made.
// STAND-IN ONLY: no operations, data paths, settings or logs; an app takes only a prebuilt release here, and is put on a
// machine only by the stand-in's controls; a destroyed machine's apps are none.

const RELEASE_KEYS_MAX = 5;
// The moves of an app to its wanted version, one a step: its output checked and kept, then attached and checked.
const MOVE_STEPS = Object.freeze(["output", "attach"]);
const SWITCH_BACK = Object.freeze({ code: "check_failed", message: "The check exited with status 1." });

/**
 * @param {any} world the stand-in's (standIn.js)
 * @param {{ releases: any }} parts the project's releases of an app (releases.js)
 */
function createStandInMachines(world, { releases }) {
  const { answer, failure, nextId, at, faults, notFound } = world;
  /** @type {Map<string, any>} each machine, by id */
  const machines = new Map();
  /** @type {Map<string, Map<string, any>>} each machine's apps, by name */
  const apps = new Map();
  /** @type {Map<string, any[]>} each mobilynet project's release keys, oldest first */
  const releaseKeys = new Map();

  const machineView = ({ id, projectId, name, state, region, createdAt }) => ({ id, projectId, name, state, region, createdAt });
  const appView = (app) => ({
    name: app.name,
    package: app.package,
    version: app.version,
    wantedVersion: app.wantedVersion,
    previousVersion: app.previousVersion,
    state: app.state,
    lastFailure: app.lastFailure ? { ...app.lastFailure } : null,
    operationId: null,
    createdAt: app.createdAt,
    changedAt: app.changedAt
  });
  const keyView = ({ name, fingerprint, publicKey, createdBy, createdAt }) => ({ name, fingerprint, publicKey, createdBy, createdAt });

  /** A machine the caller's key reaches, not destroyed, or null. */
  function machineOf(caller, id) {
    const machine = machines.get(id);
    return machine && machine.state !== "destroyed" && world.reaches(caller, machine.projectId) ? machine : null;
  }

  /**
   * A prebuilt release of a machine's app (`POST /v1/vps/{id}/apps/{app}/releases`): refused as mobilynet refuses one,
   * or `202` with the release, its build (none when the same output had one) and the app moving to it.
   */
  function release(machine, app, { body, contentSha256, release: kind }) {
    if (kind !== "prebuilt" || !Buffer.isBuffer(body)) {
      return failure(422, "validation_failed", "Check release.", { fieldErrors: { release: "The stand-in takes a machine's app's release as a prebuilt one only: MobilyNet-Release: prebuilt." } });
    }
    if (faults.hostNotUpdated) return failure(409, "host_not_updated", "The machine's server runs an older host agent, which takes no prebuilt release: try again once it is updated.");
    const made = releases.prebuilt(machine.projectId, app.name, body, contentSha256, releaseKeys.get(machine.projectId) ?? []);
    if (made.refusal) return made.refusal;
    const { version } = made.release;
    if (app.version !== version) Object.assign(app, { wantedVersion: version, moving: { version, step: 0 }, changedAt: at() });
    return answer(202, {
      release: releases.view(made.release),
      build: made.started ? { id: made.release.buildId, state: "queued" } : null,
      app: appView(app)
    });
  }

  /**
   * Answers a request about the project's machines, their apps or its release keys, or null when it is none of them.
   * @param {{ method: string, path: string, params: URLSearchParams, body: any, contentSha256?: string, release?: string, caller: any }} request
   */
  function request({ method, path, params, body, contentSha256, release: kind, caller }) {
    const inProject = /^\/v1\/projects\/([^/]+)\/(vps|release-keys)$/u.exec(path);
    if (inProject && method === "GET") {
      const projectId = decodeURIComponent(inProject[1]);
      if (!world.reaches(caller, projectId)) return notFound("project");
      if (inProject[2] === "release-keys") return answer(200, { releaseKeys: (releaseKeys.get(projectId) ?? []).map(keyView) });
      const hidden = params.get("destroyed") === "false";
      const listed = [...machines.values()].filter((one) => one.projectId === projectId && !(hidden && one.state === "destroyed"));
      return answer(200, pageOf(listed.reverse().map(machineView), params));
    }
    const onMachine = /^\/v1\/vps\/([^/]+)\/apps(?:\/([^/]+))?(\/releases)?$/u.exec(path);
    if (!onMachine) return null;
    const machine = machineOf(caller, decodeURIComponent(onMachine[1]));
    // mobilynet's word for a machine, as its paths name it.
    if (!machine) return notFound("vps");
    const held = apps.get(machine.id) ?? new Map();
    if (!onMachine[2]) return method === "GET" ? answer(200, { items: [...held.values()].map(appView) }) : null;
    const app = held.get(decodeURIComponent(onMachine[2]));
    if (!app) return notFound("app");
    if (!onMachine[3]) return method === "GET" ? answer(200, { app: appView(app) }) : null;
    return method === "POST" ? release(machine, app, { body, contentSha256, release: kind }) : null;
  }

  /** Moves each app moving to a release one step on: its output checked, then attached, or switched back. */
  function advance() {
    for (const held of apps.values()) {
      for (const app of held.values()) {
        if (!app.moving) continue;
        app.moving.step += 1;
        if (MOVE_STEPS[app.moving.step] !== undefined) continue;
        const fault = faults.switchBack;
        if (fault) {
          const said = fault === true ? SWITCH_BACK : { code: String(fault.code ?? SWITCH_BACK.code), message: String(fault.message ?? SWITCH_BACK.message) };
          Object.assign(app, { wantedVersion: null, lastFailure: { ...said, step: "check", at: at() } });
        } else {
          Object.assign(app, { previousVersion: app.version, version: app.moving.version, wantedVersion: null, lastFailure: null });
        }
        Object.assign(app, { moving: null, state: "running", changedAt: at() });
      }
    }
  }

  const controls = Object.freeze({
    /**
     * A machine of a mobilynet project, running in `region` unless given another state; answers its id.
     * @param {string} projectId @param {{ name: string, region?: string, state?: string }} machine
     */
    add: (projectId, { name, region = "us", state = "running" }) => {
      const id = nextId("vps");
      machines.set(id, { id, projectId, name, region, state, createdAt: at() });
      apps.set(id, new Map());
      return id;
    },
    /**
     * An app on a machine, running a version of the project's releases, or a catalogue package (`package`).
     * @param {string} machineId @param {{ name: string, version?: string | null, package?: string | null }} app
     */
    addApp: (machineId, { name, version = null, package: catalogued = null }) => {
      const held = apps.get(machineId);
      if (!held) throw new Error(`The stand-in has no machine ${machineId}.`);
      held.set(name, {
        name, package: catalogued, version, wantedVersion: null, previousVersion: null, state: "running", lastFailure: null, moving: null,
        createdAt: at(), changedAt: at()
      });
    },
    /** A machine's app as mobilynet answers it, or null. @param {string} machineId @param {string} name */
    app: (machineId, name) => {
      const app = apps.get(machineId)?.get(name);
      return app ? appView(app) : null;
    }
  });

  /**
   * A release key of a mobilynet project, as an owner adds one in the customer area: its fingerprint, the SHA-256 of
   * its SPKI DER in hex, as a manifest names its key. At most 5 a project.
   * @param {string} projectId @param {{ name: string, publicKey: string, createdBy?: string }} key the public key as the base64 of its SPKI DER
   */
  function addReleaseKey(projectId, { name, publicKey, createdBy = "owner@example.com" }) {
    const der = createPublicKey({ key: Buffer.from(publicKey, "base64"), format: "der", type: "spki" }).export({ format: "der", type: "spki" });
    const fingerprint = createHash("sha256").update(der).digest("hex");
    const held = releaseKeys.get(projectId) ?? [];
    if (held.length >= RELEASE_KEYS_MAX) throw new Error(`A project holds at most ${RELEASE_KEYS_MAX} release keys.`);
    releaseKeys.set(projectId, [...held, { name, fingerprint, publicKey: der.toString("base64"), createdBy, createdAt: at() }]);
    return fingerprint;
  }

  /** Removes a project's release key by its fingerprint. @param {string} projectId @param {string} fingerprint */
  function removeReleaseKey(projectId, fingerprint) {
    releaseKeys.set(projectId, (releaseKeys.get(projectId) ?? []).filter((key) => key.fingerprint !== fingerprint));
  }

  return Object.freeze({ request, advance, controls, addReleaseKey, removeReleaseKey });
}

export { createStandInMachines };
