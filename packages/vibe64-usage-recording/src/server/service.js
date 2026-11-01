import { randomBytes } from "node:crypto";
import { chmod, mkdir, readdir, realpath, rm, stat } from "node:fs/promises";
import path from "node:path";

import {
  captureProjectRequestContext,
  currentProjectRequestContext,
  currentProjectScopeKey,
  runWithProjectRequestContext
} from "@local/vibe64-core/server/projectRequestContext";
import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";
import { resolveVibe64OutputParameters } from "@local/vibe64-genesis/server";
import { sessionClosingReason } from "@local/vibe64-runtime/server/sessionLifecycle";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

import { registerActiveUsageRecording, activeUsageRecording } from "./activeRecordings.js";
import { recordingError } from "./recordingError.js";
import { usageRecordingPath, usageRecordingsPath } from "./recordingFiles.js";
import { createRecordingRecords, isoTime, publicRecording } from "./recordingRecords.js";
import { createRecordingTargets } from "./recordingTargets.js";
import { readSourceIdentity } from "./sourceIdentity.js";
import {
  appendJsonLine,
  createTraceReader,
  pageOf,
  readInteractions,
  readJsonFile,
  recordedRequestPath,
  recordingRequestRows,
  writeJsonFile
} from "./traceStore.js";
import {
  mergePrependEnvironment,
  usageRecordingEnvironment,
  usageTracersForRuntimes
} from "./tracers/index.js";
import {
  USAGE_INTERACTION_ID_PATTERN,
  USAGE_INTERACTION_KINDS,
  USAGE_RECORDING_ID_PATTERN,
  USAGE_RECORDING_LIMITS,
  USAGE_RECORDING_RETENTION,
  USAGE_RECORDING_SCHEMA,
  usageScopeKind
} from "../shared/contract.js";

/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEvents} RuntimeEvents */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("./admission.js").UsageRecordingAdmission} UsageRecordingAdmission */

const ACTIVE_STATES = new Set(["starting", "recording", "stopping"]);
const CURRENT_WINDOW_MS = 10 * 60 * 1000;
const NOT_LOADED_REASON = "The application did not load the recorder. This Output target may not run a supported runtime directly.";
const DEFAULT_TIMING = Object.freeze({
  durationMs: USAGE_RECORDING_LIMITS.durationMs,
  eventMs: 2000,
  pollMs: USAGE_RECORDING_LIMITS.flushIntervalMs,
  // The Preview readiness timeout (300 s) plus 10 s.
  readyMs: 310_000,
  stopIdleMs: 3000
});
const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";
// What a page loads besides its own requests: dev-server modules, scripts,
// styles, images and fonts. A recording counts them instead of listing each.
const ASSET_FETCH_DESTINATIONS = new Set(["script", "style", "image", "font"]);
const DEV_SERVER_PATH = /^\/(?:@vite\/|@fs\/|@id\/|node_modules\/\.vite\/)/u;
const ASSET_PATH = /\.(?:[cm]?[jt]sx?|vue|svelte|css|scss|sass|less|map|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|otf|eot)$/u;

const newRecordingId = () => `rec_${[...randomBytes(20)].map((byte) => BASE32[byte & 31]).join("")}`;

/**
 * Without Fetch Metadata, a source module or asset is known by its extension.
 */
function isAssetLoad(requestPath = "", fetchDest = "") {
  const destination = String(fetchDest || "").toLowerCase();
  return ASSET_FETCH_DESTINATIONS.has(destination) || DEV_SERVER_PATH.test(requestPath) ||
    (!destination && ASSET_PATH.test(requestPath));
}

/**
 * highestInteraction is the number of the highest interaction recorded so far
 * (i_0007 → 7, 0 before the first): a Preview page continues after it.
 * requestLog counts the asset loads not listed, and says when the Preview
 * request log reached its limit and later requests were not recorded.
 */
function storedRecording(value) {
  return value?.schema === USAGE_RECORDING_SCHEMA && USAGE_RECORDING_ID_PATTERN.test(String(value.id || "")) ? value : null;
}

async function directorySize(directory) {
  let total = 0;
  for (const name of await readdir(directory).catch(() => [])) {
    total += await stat(path.join(directory, name)).then((info) => (info.isFile() ? info.size : 0), () => 0);
  }
  return total;
}

/**
 * @param {object} dependencies
 * @param {ProjectService} dependencies.project
 * @param {TerminalsService} dependencies.terminals
 * @param {RuntimeEvents} dependencies.events
 * @param {RuntimeLogger} dependencies.logger
 * @param {UsageRecordingAdmission} dependencies.admission
 * @param {() => number} [dependencies.now]
 * @param {object} [dependencies.timing]
 */
function createService({
  project,
  terminals,
  events,
  logger,
  admission,
  now = () => Date.now(),
  timing = {}
}) {
  const times = { ...DEFAULT_TIMING, ...timing };
  const records = createRecordingRecords({
    events,
    logger,
    now
  });
  const recordingTargets = createRecordingTargets({ terminals });
  // Recordings this process is running or finishing, by id.
  const live = new Map();
  // Sessions whose start is between its checks and its registration.
  const startingSessions = new Set();
  // Readers of finished recordings: the results view reads one or two at a time.
  const finishedReaders = new Map();

  async function sessionContext(sessionId = "") {
    const id = normalizeText(sessionId);
    if (!id) throw recordingError(400, "A session id is required.", "vibe64_invalid_session_id");
    const runtime = await project.createRuntime({ sessionId: id });
    const session = await runtime.getSession(id);
    return {
      directory: usageRecordingsPath(session),
      projectScope: currentProjectScopeKey(),
      projectSlug: String(currentProjectRequestContext()?.slug || ""),
      session,
      sessionId: id,
      sourceRoot: sessionSourcePath(session)
    };
  }

  function clearTimers(entry) {
    for (const timer of Object.values(entry.timers)) clearTimeout(timer);
  }

  async function poll(entry) {
    if (entry.polling || entry.stopRequested) return;
    entry.polling = true;
    try {
      const before = JSON.stringify(entry.record.counts);
      await entry.reader.poll();
      const ready = records.refreshFromReader(entry);
      if (entry.stopRequested) return;
      if (entry.record.state === "starting" && ready) {
        clearTimeout(entry.timers.ready);
        await records.changeState(entry, "recording");
      } else if (JSON.stringify(entry.record.counts) !== before && now() - entry.lastEventAt >= times.eventMs) {
        await records.publish(entry);
      }
      if (entry.record.counts.requests >= USAGE_RECORDING_LIMITS.capturedRequests) await stopEntry(entry, "request-limit");
      else if (entry.reader.hitsBytes() >= USAGE_RECORDING_LIMITS.hitsBytesPerRecording) await stopEntry(entry, "size-limit");
    } catch (error) {
      logger.warn({ error, recordingId: entry.record.id }, "Usage recording could not read its trace.");
      await stopEntry(entry, "error");
    } finally {
      entry.polling = false;
    }
  }

  /**
   * Runs after the person has been told the recording is stopping: tracers get
   * a moment to write their last hits and their idle line.
   */
  async function finish(entry, reason) {
    const deadline = now() + times.stopIdleMs;
    try {
      await entry.writes;
      do {
        await entry.reader.poll();
        const states = [...entry.reader.tracerStates().values()];
        if (states.every((state) => state.active === 0)) break;
        await new Promise((resolve) => setTimeout(resolve, Math.min(250, times.stopIdleMs)));
      } while (now() < deadline);
      const ready = records.refreshFromReader(entry);
      if (!ready && reason === "target-exited") {
        entry.record.tracers = records.unreadyTracers(entry, NOT_LOADED_REASON);
        await records.changeState(entry, "unavailable");
      } else {
        entry.record.tracers = records.unreadyTracers(entry, NOT_LOADED_REASON)
          .map((tracer) => (tracer.state === "ready" ? { ...tracer, state: "idle" } : tracer));
        await records.writeIndex(entry);
        await records.changeState(entry, "stopped");
      }
    } catch (error) {
      logger.warn({ error, recordingId: entry.record.id }, "Usage recording could not finish cleanly.");
      await records.changeState(entry, "stopped", { stopReason: "error" }).catch(() => {});
    } finally {
      live.delete(entry.record.id);
      rememberReader(entry.directory, entry.reader);
    }
  }

  /**
   * Stop always agrees: the first call tells the tracers to stop and returns at
   * once; later calls return the same recording.
   */
  async function stopEntry(entry, reason) {
    if (!entry.stopRequested) {
      entry.stopRequested = true;
      entry.unregister();
      clearTimers(entry);
      await writeJsonFile(path.join(entry.directory, "control.json"), { state: "stopping" });
      await records.changeState(entry, "stopping", { stopReason: reason, stoppedAt: isoTime(now()) });
      entry.finished = finish(entry, reason);
    }
    return entry.record;
  }

  /**
   * A launch that could not start, or a recorder that never loaded, ends the
   * recording without results.
   */
  async function endWithoutResults(entry, state, reason) {
    if (entry.stopRequested) return;
    entry.stopRequested = true;
    entry.unregister();
    clearTimers(entry);
    await writeJsonFile(path.join(entry.directory, "control.json"), { state: "stopping" });
    await entry.reader.poll().catch(() => {});
    entry.record.tracers = state === "failed"
      ? entry.record.tracers.map((tracer) => ({ ...tracer, state: tracer.state === "unavailable" ? tracer.state : "failed", reason }))
      : records.unreadyTracers(entry, reason);
    await records.changeState(entry, state, { stoppedAt: isoTime(now()) });
    live.delete(entry.record.id);
    entry.finished = Promise.resolve();
  }

  function rememberReader(directory, reader) {
    finishedReaders.delete(directory);
    finishedReaders.set(directory, reader);
    while (finishedReaders.size > 2) finishedReaders.delete(finishedReaders.keys().next().value);
  }

  async function readerFor(directory) {
    const running = [...live.values()].find((entry) => entry.directory === directory);
    if (running) return running.reader;
    if (!finishedReaders.has(directory)) {
      const reader = createTraceReader(directory);
      await reader.poll();
      rememberReader(directory, reader);
    }
    return finishedReaders.get(directory);
  }

  function liveEntry({ context, record, directory, tracers, target, outputParameters }) {
    const entry = {
      directory,
      finished: null,
      interactions: new Set(),
      lastEventAt: 0,
      polling: false,
      projectSlug: context.projectSlug,
      reader: createTraceReader(directory),
      record,
      requestSeq: 0,
      requestsLogged: 0,
      stopRequested: false,
      timers: {},
      unregister: () => {},
      writes: Promise.resolve()
    };
    const append = (name, row) => {
      entry.writes = entry.writes.then(() => appendJsonLine(path.join(directory, name), row))
        .catch((error) => logger.warn({ error, recordingId: record.id }, "Usage recording could not append a line."));
      return entry.writes;
    };
    /**
     * A launched target inherits this server's environment beneath the
     * launch's own variables, so a prepended value joins the one the process
     * would otherwise see, such as a PHP_INI_SCAN_DIR the server was started
     * with or a person's own PYTHONPATH.
     */
    const recorderEnvironment = (environment = {}) => {
      const result = usageRecordingEnvironment({ recordingDirectory: directory, sourceRoot: context.sourceRoot, targetKind: target.kind });
      const inherited = { ...process.env, ...environment };
      let usageRecordingPreload = "";
      for (const { prepared } of tracers) {
        Object.assign(result, prepared.environment || {}, mergePrependEnvironment(prepared.prependEnvironment, inherited));
        usageRecordingPreload = prepared.realPreload || usageRecordingPreload;
      }
      return { environment: result, usageRecordingPreload };
    };
    entry.active = {
      recordingId: record.id,
      web: target.kind === "web",
      launch({ outputTargetId = "", web = false, environment = {} } = {}) {
        const recorded = target.kind === "web" ? web === true : !web && outputTargetId === target.outputTargetId;
        if (!recorded || entry.stopRequested) return null;
        return {
          ...recorderEnvironment(environment),
          exited() {
            if (target.kind === "terminal") void stopEntry(entry, "target-exited");
          }
        };
      },
      proxyRequest({ method = "", path: requestPath = "", interaction = "", fetchDest = "" } = {}) {
        if (target.kind !== "web" || entry.stopRequested || entry.requestSeq >= 999_999) return null;
        if (isAssetLoad(String(requestPath || ""), fetchDest)) {
          entry.record.requestLog.assets += 1;
          return null;
        }
        entry.requestSeq += 1;
        const requestId = `r_${String(entry.requestSeq).padStart(6, "0")}`;
        const accepted = USAGE_INTERACTION_ID_PATTERN.test(String(interaction || "")) ? String(interaction) : null;
        const startedAtMs = now();
        return {
          requestId,
          interaction: accepted,
          finish({ status = null } = {}) {
            if (entry.requestsLogged >= USAGE_RECORDING_LIMITS.proxyRequestLines) {
              entry.record.requestLog.full = true;
              return;
            }
            entry.requestsLogged += 1;
            void append("requests.ndjson", {
              id: requestId,
              seq: Number(requestId.slice(2)),
              method: /^[A-Z]{1,16}$/u.test(String(method).toUpperCase()) ? String(method).toUpperCase() : "OTHER",
              path: recordedRequestPath(requestPath),
              status: Number.isSafeInteger(status) ? status : null,
              startedAt: new Date(startedAtMs).toISOString(),
              durationMs: Math.max(0, now() - startedAtMs),
              interaction: accepted
            });
          }
        };
      },
      stop: (reason) => stopEntry(entry, reason)
    };
    entry.append = append;
    entry.launchTarget = async () => {
      let result = null;
      try {
        if (target.kind === "web") {
          result = await terminals.startOutputTargetTerminal(record.sessionId, { restartPreview: true });
          if (result?.ok === false && result.code === "vibe64_preview_not_started") {
            result = await terminals.startOutputTargetTerminal(record.sessionId, {
              ensurePreview: true,
              outputTargetId: target.outputTargetId
            });
          }
        } else {
          result = await terminals.startOutputTargetTerminal(record.sessionId, {
            forceRestart: true,
            outputParameters,
            outputTargetId: target.outputTargetId
          });
        }
      } catch (error) {
        result = { ok: false, error: error?.message };
      }
      if (result?.ok === false) {
        await endWithoutResults(entry, "failed", String(result.error || "The recorded target could not start."));
      } else if (!entry.stopRequested && entry.record.state === "starting") {
        entry.timers.ready = setTimeout(() => {
          void endWithoutResults(entry, "unavailable", NOT_LOADED_REASON);
        }, times.readyMs);
        entry.timers.ready.unref();
      }
    };
    return entry;
  }

  /**
   * Keeps the newest recordings within the session's count and size budget
   * and deletes those older than the age limit. Running recordings stay.
   */
  async function applyRetention(directory) {
    const recordings = [];
    for (const id of (await readdir(directory).catch(() => [])).filter((name) => USAGE_RECORDING_ID_PATTERN.test(name))) {
      const recordingDirectory = path.join(directory, id);
      const stored = storedRecording(await readJsonFile(path.join(recordingDirectory, "recording.json")));
      const startedAt = Date.parse(stored?.startedAt || "") ||
        await stat(recordingDirectory).then((info) => info.mtimeMs, () => 0);
      recordings.push({ id, recordingDirectory, startedAt, bytes: await directorySize(recordingDirectory) });
    }
    recordings.sort((left, right) => right.startedAt - left.startedAt);
    let kept = 0;
    let bytes = 0;
    for (const recording of recordings) {
      const running = live.has(recording.id);
      const keep = running || (kept < USAGE_RECORDING_RETENTION.maxRecordings &&
        bytes + recording.bytes <= USAGE_RECORDING_RETENTION.maxBytes && now() - recording.startedAt <= USAGE_RECORDING_RETENTION.maxAgeMs);
      if (keep) {
        kept += 1;
        bytes += recording.bytes;
      } else {
        await rm(recording.recordingDirectory, { force: true, recursive: true });
        finishedReaders.delete(recording.recordingDirectory);
      }
    }
  }

  async function storedRecordings(context) {
    const recordings = [];
    for (const id of (await readdir(context.directory).catch(() => [])).filter((name) => USAGE_RECORDING_ID_PATTERN.test(name))) {
      const record = live.get(id)?.record || storedRecording(await readJsonFile(path.join(context.directory, id, "recording.json")));
      if (!record || record.sessionId !== context.sessionId) continue;
      // A recording left running by an earlier server process ends here.
      if (ACTIVE_STATES.has(record.state) && !live.has(id)) {
        await writeJsonFile(path.join(context.directory, id, "control.json"), { state: "stopping" });
        Object.assign(record, { state: "stopped", stopReason: "error", stoppedAt: record.stoppedAt || isoTime(now()) });
        await writeJsonFile(path.join(context.directory, id, "recording.json"), record);
      }
      recordings.push(record);
    }
    return recordings.sort((left, right) => String(right.startedAt).localeCompare(String(left.startedAt)));
  }

  async function recordingFor(context, recordingId = "") {
    const directory = usageRecordingPath(context.session, String(recordingId || ""));
    const record = live.get(recordingId)?.record ||
      (directory ? storedRecording(await readJsonFile(path.join(directory, "recording.json"))) : null);
    if (!record || record.sessionId !== context.sessionId) {
      throw recordingError(404, "This recording does not exist.", "vibe64_usage_recording_not_found");
    }
    return { directory, entry: live.get(recordingId) || null, record };
  }

  function assertActiveSession(context) {
    if (String(context.session?.status || "active") !== "active" || sessionClosingReason(context.session)) {
      throw recordingError(409, "Recording needs an active session.", "vibe64_usage_recording_session_inactive");
    }
    if (!context.directory || !context.sourceRoot) {
      throw recordingError(409, "This session has no source to record.", "vibe64_usage_recording_session_inactive");
    }
  }

  function assertNoActiveRecording(context) {
    if (activeUsageRecording(context.projectScope, context.sessionId) ||
        startingSessions.has(`${context.projectScope}\n${context.sessionId}`)) {
      throw recordingError(409, "A recording is already running in this session. Stop it first.", "vibe64_usage_recording_active");
    }
  }

  async function deleteRecording({ sessionId, recordingId }) {
    const context = await sessionContext(sessionId);
    const { directory, entry } = await recordingFor(context, recordingId);
    if (entry) {
      await stopEntry(entry, "person");
      await entry.finished;
    }
    await rm(directory, { force: true, recursive: true });
    finishedReaders.delete(directory);
    return { ok: true };
  }

  async function readTargets({ sessionId }) {
    const context = await sessionContext(sessionId);
    return { targets: (await recordingTargets.targetsFor(context)).map(({ outputTarget: _outputTarget, ...target }) => target) };
  }

  async function start({ sessionId, targetId = "", parameters }) {
    const context = await sessionContext(sessionId);
    assertActiveSession(context);
    assertNoActiveRecording(context);
    const sessionKey = `${context.projectScope}\n${context.sessionId}`;
    startingSessions.add(sessionKey);
    try {
      const target = (await recordingTargets.targetsFor(context)).find((candidate) => candidate.id === String(targetId || ""));
      if (!target) throw recordingError(422, "This target cannot be recorded.", "vibe64_usage_recording_target_unknown");
      if (!target.available) throw recordingError(422, target.reason, "vibe64_usage_recording_target_unavailable");
      let outputParameters;
      if (target.kind === "terminal") {
        try {
          outputParameters = resolveVibe64OutputParameters(target.outputTarget, parameters ?? {});
        } catch (error) {
          throw recordingError(422, error.message, "vibe64_usage_recording_parameters_invalid");
        }
      } else if (parameters && Object.keys(parameters).length) {
        throw recordingError(422, "Preview takes no parameters.", "vibe64_usage_recording_parameters_invalid");
      }
      const decision = await admission({
        sessionId: context.sessionId,
        projectSlug: context.projectSlug,
        targetKind: target.kind,
        runtimes: target.runtimes
      });
      if (decision?.admitted !== true) {
        const reason = String(decision?.reason || "Recording cannot start right now.");
        throw recordingError(503, reason, "vibe64_usage_recording_refused", { reason });
      }

      const id = newRecordingId();
      const directory = path.join(context.directory, id);
      await mkdir(context.directory, { recursive: true, mode: 0o2770 });
      await chmod(context.directory, 0o2770);
      await mkdir(directory, { mode: 0o2770 });
      await chmod(directory, 0o2770);
      const tracers = [];
      const tracerRecords = [];
      for (const tracer of usageTracersForRuntimes(target.runtimes)) {
        const prepared = tracer.prepare({
          recordingDirectory: directory,
          sourceRoot: context.sourceRoot,
          recordingId: id,
          targetKind: target.kind
        });
        if (prepared.available && prepared.nodePreload) prepared.realPreload = await realpath(prepared.nodePreload);
        if (prepared.available) tracers.push({ tracer, prepared });
        tracerRecords.push({
          runtime: tracer.runtime,
          state: prepared.available ? "starting" : "unavailable",
          reason: prepared.available ? "" : prepared.reason
        });
      }
      const record = {
        id,
        sessionId: context.sessionId,
        state: "starting",
        target: { id: target.id, kind: target.kind, label: target.label },
        runtimes: target.runtimes,
        tracers: tracerRecords,
        startedAt: isoTime(now()),
        stoppedAt: null,
        stopReason: null,
        counts: { requests: 0, functions: 0 },
        truncated: false,
        dismissedAt: null,
        sourceIdentity: await readSourceIdentity(context.sourceRoot),
        highestInteraction: 0,
        requestLog: { assets: 0, full: false }
      };
      const entry = liveEntry({
        context,
        record,
        directory,
        tracers,
        outputParameters,
        target: { ...target, outputTargetId: target.outputTarget.id }
      });
      // Registered before its files exist, so no reader takes it for a
      // recording an earlier server process left behind. Tracers read the
      // control file and the target label as soon as the target starts.
      live.set(id, entry);
      try {
        await writeJsonFile(path.join(directory, "control.json"), { state: "recording" });
        await records.writeRecord(entry);
      } catch (error) {
        live.delete(id);
        await rm(directory, { force: true, recursive: true });
        throw error;
      }
      entry.unregister = registerActiveUsageRecording(context.projectScope, context.sessionId, entry.active);
      entry.timers.poll = setInterval(() => void poll(entry), times.pollMs);
      entry.timers.limit = setTimeout(() => void stopEntry(entry, "time-limit"), times.durationMs);
      entry.timers.poll.unref();
      entry.timers.limit.unref();
      await applyRetention(context.directory);
      await records.publish(entry);
      // The target's start can take a while; the recording reports it.
      const requestContext = captureProjectRequestContext();
      void runWithProjectRequestContext(requestContext || {}, () => entry.launchTarget());
      return { recording: publicRecording(record) };
    } finally {
      startingSessions.delete(sessionKey);
    }
  }

  async function readCurrent({ sessionId }) {
    const context = await sessionContext(sessionId);
    await applyRetention(context.directory);
    const recordings = await storedRecordings(context);
    const current = recordings.find((record) => ACTIVE_STATES.has(record.state)) ||
      recordings.find((record) => !record.dismissedAt && record.stoppedAt && now() - Date.parse(record.stoppedAt) <= CURRENT_WINDOW_MS);
    return { recording: current ? publicRecording(current) : null, serverTime: isoTime(now()) };
  }

  async function stop({ sessionId, recordingId }) {
    const context = await sessionContext(sessionId);
    const { entry, record } = await recordingFor(context, recordingId);
    if (entry) return { recording: publicRecording(await stopEntry(entry, "person")) };
    const [stored] = (await storedRecordings(context)).filter((candidate) => candidate.id === record.id);
    return { recording: publicRecording(stored || record) };
  }

  async function dismiss({ sessionId, recordingId }) {
    const context = await sessionContext(sessionId);
    const { directory, entry, record } = await recordingFor(context, recordingId);
    record.dismissedAt ||= isoTime(now());
    if (entry) await records.writeRecord(entry);
    else await writeJsonFile(path.join(directory, "recording.json"), record);
    return { recording: publicRecording(record) };
  }

  async function list({ sessionId }) {
    const context = await sessionContext(sessionId);
    return { recordings: (await storedRecordings(context)).slice(0, USAGE_RECORDING_RETENTION.maxRecordings).map(publicRecording) };
  }

  /**
   * Oldest first unless order is "newest"; total counts every matching row.
   * A requestId reads that one row, whatever the other filters say.
   */
  async function readRequests({ sessionId, recordingId, cursor, limit, q = "", includeEmpty = false, order = "oldest", requestId = "" }) {
    const context = await sessionContext(sessionId);
    const { directory, entry, record } = await recordingFor(context, recordingId);
    const index = entry ? null : await readJsonFile(path.join(directory, "index.json"), USAGE_RECORDING_LIMITS.indexBytes);
    const rows = Array.isArray(index?.requests)
      ? index.requests
      : await recordingRequestRows(directory, await readerFor(directory), { runLabel: record.target.label });
    const query = String(q || "").trim().toLowerCase();
    const matching = rows.filter((row) => (requestId ? row.id === requestId : (includeEmpty === true || row.functionCount > 0) &&
      (!query || `${row.method || ""} ${row.path || ""}`.toLowerCase().includes(query))));
    const page = pageOf(order === "newest" ? matching.reverse() : matching, { cursor, limit, maxLimit: 200 });
    const referenced = new Set(page.items.map((row) => row.interaction).filter(Boolean));
    const interactions = (await readInteractions(directory)).filter((row) => referenced.has(row.id))
      .map(({ id, label, kind, componentFile }) => ({ id, label, kind: kind || "click", componentFile: componentFile ?? null }));
    return { requests: page.items, interactions, nextCursor: page.more ? page.next : null, total: matching.length };
  }

  async function readRequestFunctions({ sessionId, recordingId, requestId, cursor, limit }) {
    const context = await sessionContext(sessionId);
    const { directory } = await recordingFor(context, recordingId);
    if (!usageScopeKind(requestId)) {
      throw recordingError(404, "This request is not part of the recording.", "vibe64_usage_recording_request_not_found");
    }
    const functions = (await readerFor(directory)).scopeFunctions(String(requestId));
    const page = pageOf(functions, { cursor, limit: limit ?? 1500, maxLimit: 1500 });
    return { functions: page.items, total: functions.length, truncated: page.more };
  }

  async function recordInteraction({ sessionId, recordingId, id, at, label, kind = "click", componentFile = null }) {
    const context = await sessionContext(sessionId);
    const { entry } = await recordingFor(context, recordingId);
    if (!entry || entry.stopRequested || entry.record.target.kind !== "web") {
      throw recordingError(409, "Interactions are recorded only while Preview is being recorded.", "vibe64_usage_recording_not_recording");
    }
    const valid = USAGE_INTERACTION_ID_PATTERN.test(String(id || "")) && Number.isFinite(Date.parse(at)) &&
      typeof label === "string" && label.length > 0 && label.length <= 80 && USAGE_INTERACTION_KINDS.includes(kind) &&
      (componentFile === null || (typeof componentFile === "string" && componentFile.length <= 512 &&
        !componentFile.startsWith("/") && !componentFile.split("/").some((part) => !part || part === "." || part === "..")));
    if (!valid) throw recordingError(422, "This interaction is not valid.", "vibe64_usage_recording_interaction_invalid");
    // Another Preview page of this recording already used this number; it
    // continues from the next free one.
    if (entry.interactions.has(id)) {
      throw recordingError(409, "This interaction number is already recorded.", "vibe64_usage_recording_interaction_taken",
        { nextInteraction: entry.record.highestInteraction + 1 });
    }
    if (entry.interactions.size >= USAGE_RECORDING_LIMITS.interactions) {
      throw recordingError(422, "This recording has reached its interaction limit.", "vibe64_usage_recording_interaction_limit");
    }
    entry.interactions.add(id);
    entry.record.highestInteraction = Math.max(entry.record.highestInteraction, Number(id.slice(2)));
    await entry.append("interactions.ndjson", { id, at: new Date(Date.parse(at)).toISOString(), label, kind, componentFile });
    return { ok: true };
  }

  return Object.freeze({
    readTargets,
    start,
    readCurrent,
    stop,
    dismiss,
    list,
    readRequests,
    readRequestFunctions,
    recordInteraction,
    delete: deleteRecording
  });
}

export { createService };
