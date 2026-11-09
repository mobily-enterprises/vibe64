import { inspectVibe64ArchitectureLayout } from "@local/vibe64-genesis/server";
import { pathExists } from "@local/vibe64-core/server/core";
import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";
import { vibe64Result } from "@local/vibe64-core/server/serverResponses";
import { toText } from "@jskit-ai/kernel/shared/support/normalize";

import {
  readGenesisCallWeb,
  readGenesisCity,
  requireGenesisCity
} from "./genesisCities.js";
import { createSnapshotCache } from "./snapshotCache.js";
import {
  buildCallIndex,
  buildSnapshotIndex,
  usageError
} from "./usageIndex.js";
import {
  CALL_WEB_CACHE_SESSIONS,
  joinFunctions,
  matchRoutes,
  readCallsWeb,
  readEntries,
  readFunction,
  readImportsWeb,
  requireEntry
} from "./usageWeb.js";

/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */

// The usage service answers usage queries for one session's source, from its
// Genesis snapshot and its parsed call web.

/**
 * One parsed call web per session source, at most two sessions, released after
 * two idle minutes and replaced when the Machine City names another identity.
 */
function createCallWebCache(options = {}) {
  return createSnapshotCache({ capacity: CALL_WEB_CACHE_SESSIONS, ...options });
}

// The usage service's own cache. A scan supersedes the session's call web, so
// the scan releases it rather than keeping it through the scan.
const callWebs = createCallWebCache();

function releaseCallWeb(sourceRoot) {
  callWebs.delete(sourceRoot);
}

/**
 * @param {object} dependencies
 * @param {ProjectService} dependencies.project
 * @param {typeof readGenesisCity} [dependencies.cityReader]
 * @param {typeof readGenesisCallWeb} [dependencies.callWebReader]
 * @param {typeof inspectVibe64ArchitectureLayout} [dependencies.layoutReader]
 */
function createUsageService({
  project,
  cityReader = readGenesisCity,
  callWebReader = readGenesisCallWeb,
  layoutReader = inspectVibe64ArchitectureLayout
}) {
  const snapshotIndexes = new WeakMap();

  async function sessionSource(sessionId = "") {
    const normalizedSessionId = toText(sessionId);
    if (!normalizedSessionId) throw usageError("Missing Vibe64 session id.", "vibe64_invalid_session_id_missing");
    const runtime = await project.createRuntime({ sessionId: normalizedSessionId });
    const session = await runtime.getSession(normalizedSessionId);
    const sourceRoot = sessionSourcePath(session);
    if (!sourceRoot || !await pathExists(sourceRoot)) {
      throw usageError(
        "Create the active session source before opening Architecture.",
        "vibe64_system_source_unavailable",
        { sessionId: normalizedSessionId }
      );
    }
    return sourceRoot;
  }

  async function snapshot(sourceRoot) {
    const record = await cityReader(sourceRoot, "machine");
    const machine = requireGenesisCity(record, "machine");
    if (!snapshotIndexes.has(machine)) {
      snapshotIndexes.set(machine, (async () => {
        let layout = null;
        // Groups only arrange cards; an invalid layout leaves them alphabetical.
        try {
          layout = await layoutReader({ projectRoot: sourceRoot });
        } catch {
          layout = null;
        }
        return buildSnapshotIndex(record, layout);
      })());
      snapshotIndexes.get(machine).catch(() => snapshotIndexes.delete(machine));
    }
    return snapshotIndexes.get(machine);
  }

  async function callIndexFor(sourceRoot, index) {
    const identity = index.snapshot.callWebIdentity;
    if (!identity) return null;
    return callWebs.read(sourceRoot, identity, async () => {
      const document = await callWebReader(sourceRoot, index.architecture);
      return document ? buildCallIndex(document) : null;
    });
  }

  function query(operation) {
    return (input = {}) => vibe64Result(async () => {
      const sourceRoot = await sessionSource(input.sessionId);
      const index = await snapshot(sourceRoot);
      const result = await operation(index, input, () => callIndexFor(sourceRoot, index));
      return { ok: true, snapshot: index.snapshot, ...result };
    }, { fallbackCode: "vibe64_usage_query_failed", fallbackMessage: "The usage map could not be read." });
  }

  return Object.freeze({
    readUsageEntries: query((index, input) => readEntries(index, input)),
    readUsageWeb: query(async (index, input, calls) => {
      const entry = requireEntry(index, input.entryId);
      const mode = toText(input.mode) || "imports";
      if (mode === "imports") return readImportsWeb(index, entry, input);
      if (mode === "calls") return readCallsWeb(index, await calls(), entry, input);
      throw usageError("Mode must be imports or calls.", "vibe64_invalid_usage_mode");
    }),
    readUsageFunction: query(async (index, input, calls) => readFunction(index, await calls(), input)),
    joinUsage: query(async (index, input, calls) => joinFunctions(index, await calls(), input)),
    matchUsageRoutes: query((index, input) => matchRoutes(index, input))
  });
}

const __testables = Object.freeze({ createCallWebCache });

export {
  createUsageService,
  releaseCallWeb,
  __testables
};
