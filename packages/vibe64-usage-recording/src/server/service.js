import { randomBytes } from "node:crypto";
import { appendFile, chmod, mkdir, open, readdir, realpath, rm, stat } from "node:fs/promises";
import path from "node:path";

import { AppError } from "@jskit-ai/kernel/server/runtime";
import {
  captureProjectRequestContext,
  currentProjectRequestContext,
  currentProjectScopeKey,
  runWithProjectRequestContext
} from "@local/vibe64-core/server/projectRequestContext";
import { vibe64SessionViewersRoom } from "@local/vibe64-core/server/sessionRealtimeEvents";
import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";
import { resolveVibe64OutputParameters } from "@local/vibe64-genesis/server";
import { sessionClosingReason } from "@local/vibe64-runtime/server/sessionLifecycle";

import { registerActiveUsageRecording, activeUsageRecording } from "./activeRecordings.js";
import { admitUsageRecording } from "./admission.js";
import { usageRecordingPath, usageRecordingsPath } from "./recordingFiles.js";
import {
  createTraceReader,
  pageOf,
  readInteractions,
  readJsonFile,
  recordingRequestRows,
  writeJsonFile
} from "./traceStore.js";
import {
  mergePrependEnvironment,
  recordingUnavailableReason,
  usageRecordingEnvironment,
  usageTracersForRuntimes
} from "./tracers/index.js";
import {
  USAGE_INTERACTION_ID_PATTERN,
  USAGE_INTERACTION_KINDS,
  USAGE_RECORDING_CHANGED_EVENT,
  USAGE_RECORDING_ID_PATTERN,
  USAGE_RECORDING_LIMITS,
  USAGE_RECORDING_RETENTION,
  USAGE_RECORDING_SCHEMA,
  usageScopeKind
} from "../shared/contract.js";

const ACTIVE_STATES = new Set(["starting", "recording", "stopping"]);
const CURRENT_WINDOW_MS = 10 * 60 * 1000;
const NOT_LOADED_REASON = "The application did not load the recorder. This Output target may not run a supported runtime directly.";
// What a tracer that never became ready said about itself.
const DIAGNOSTIC_REASONS = Object.freeze({
  CONFIGURATION_INVALID: "The recorder was started with an invalid recording configuration.",
  NODE_TOO_OLD: "Recording needs Node.js 22.15 or later.",
  NO_FREE_MONITORING_TOOL: "Another tool is already monitoring this Python program.",
  PARSER_UNAVAILABLE: "The Node.js recorder could not load its source parser.",
  PYTHON_TOO_OLD: "Recording needs Python 3.12 or later.",
  READ_FAILED: "The recorder could not read its recording files.",
  RECORDER_FAILED: "The recorder stopped after an internal error."
});
const DEFAULT_TIMING = Object.freeze({
  durationMs: USAGE_RECORDING_LIMITS.durationMs,
  eventMs: 2000,
  pollMs: USAGE_RECORDING_LIMITS.flushIntervalMs,
  // The Preview readiness timeout (300 s) plus 10 s.
  readyMs: 310_000,
  stopIdleMs: 3000
});
const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

const recordingError = (status, message, code, details) => new AppError(status, message, { code, details });
const newRecordingId = () => `rec_${[...randomBytes(20)].map((byte) => BASE32[byte & 31]).join("")}`;
const isoNow = (now) => new Date(now()).toISOString();

// highestInteraction is the number of the highest interaction recorded so far
// (i_0007 → 7, 0 before the first): a Preview page continues after it.
function publicRecording(record) {
  const { id, sessionId, state, target, runtimes, tracers, startedAt, stoppedAt, stopReason, counts, truncated, dismissedAt, sourceIdentity, highestInteraction } = record;
  return structuredClone({
    id, sessionId, state, target, runtimes, tracers, startedAt, stoppedAt, stopReason, counts, truncated, dismissedAt,
    sourceIdentity: sourceIdentity ?? null, highestInteraction: highestInteraction ?? 0
  });
}

function storedRecording(value) {
  return value?.schema === USAGE_RECORDING_SCHEMA && USAGE_RECORDING_ID_PATTERN.test(String(value.id || "")) ? value : null;
}

// The call web names the source snapshot it was built from in its first lines;
// a recording keeps it so results can say when the source has changed since.
async function readSourceIdentity(sourceRoot) {
  let handle = null;
  try {
    handle = await open(path.join(sourceRoot, ".genesis", "call-web.json"), "r");
    const buffer = Buffer.alloc(4096);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return /"sourceIdentity"\s*:\s*"(sha256:[0-9a-f]{64})"/u.exec(buffer.subarray(0, bytesRead).toString("utf8"))?.[1] || null;
  } catch {
    return null;
  } finally {
    await handle?.close();
  }
}

async function directorySize(directory) {
  let total = 0;
  for (const name of await readdir(directory).catch(() => [])) {
    total += await stat(path.join(directory, name)).then((info) => (info.isFile() ? info.size : 0), () => 0);
  }
  return total;
}

function createService({
  projectService,
  terminals,
  events = null,
  logger = null,
  admission = admitUsageRecording,
  now = () => Date.now(),
  timing = {}
}) {
  const times = { ...DEFAULT_TIMING, ...timing };
  // Recordings this process is running or finishing, by id.
  const live = new Map();
  // Sessions whose start is between its checks and its registration.
  const startingSessions = new Set();
  // Readers of finished recordings: the results view reads one or two at a time.
  const finishedReaders = new Map();

  async function sessionContext(sessionId = "") {
    const id = String(sessionId || "").trim();
    if (!id) throw recordingError(400, "A session id is required.", "vibe64_invalid_session_id");
    const runtime = await projectService.createRuntime({ sessionId: id });
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

  async function publish(entry) {
    entry.lastEventAt = now();
    if (!events || !entry.projectSlug) return;
    const { record } = entry;
    try {
      await events.publish({
        type: "entity.changed",
        source: "vibe64",
        entity: "usage-recording",
        operation: "updated",
        entityId: record.id,
        scope: { kind: "global", id: null },
        occurredAt: isoNow(now),
        realtime: {
          audience: { room: vibe64SessionViewersRoom(entry.projectSlug, record.sessionId) },
          event: USAGE_RECORDING_CHANGED_EVENT,
          payload: {
            projectSlug: entry.projectSlug,
            sessionId: record.sessionId,
            recordingId: record.id,
            state: record.state,
            counts: { ...record.counts },
            startedAt: record.startedAt,
            stoppedAt: record.stoppedAt,
            stopReason: record.stopReason
          }
        }
      });
    } catch (error) {
      logger?.warn?.({ error, recordingId: record.id }, "Usage recording change could not be published.");
    }
  }

  async function writeRecord(entry) {
    await writeJsonFile(path.join(entry.directory, "recording.json"), {
      schema: USAGE_RECORDING_SCHEMA,
      ...publicRecording(entry.record),
      limits: {
        durationMs: USAGE_RECORDING_LIMITS.durationMs,
        capturedRequests: USAGE_RECORDING_LIMITS.capturedRequests,
        hitsBytesPerProcess: USAGE_RECORDING_LIMITS.hitsBytesPerProcess,
        hitsBytesPerRecording: USAGE_RECORDING_LIMITS.hitsBytesPerRecording,
        proxyRequestLines: USAGE_RECORDING_LIMITS.proxyRequestLines,
        interactions: USAGE_RECORDING_LIMITS.interactions
      }
    });
  }

  async function changeState(entry, state, fields = {}) {
    Object.assign(entry.record, { state, ...fields });
    await writeRecord(entry);
    await publish(entry);
  }

  function clearTimers(entry) {
    for (const timer of Object.values(entry.timers)) clearTimeout(timer);
  }

  // A tracer that never became ready explains itself through its diagnostics.
  function unreadyTracers(entry, fallback) {
    const states = entry.reader.tracerStates();
    return entry.record.tracers.map((tracer) => {
      if (tracer.state === "unavailable" || states.get(tracer.runtime)?.ready) return tracer;
      const code = [...(states.get(tracer.runtime)?.diagnostics || [])].find((name) => DIAGNOSTIC_REASONS[name]);
      return { ...tracer, state: "unavailable", reason: code ? DIAGNOSTIC_REASONS[code] : fallback };
    });
  }

  function refreshFromReader(entry) {
    const states = entry.reader.tracerStates();
    entry.record.counts = entry.reader.counts();
    entry.record.truncated = entry.reader.truncated() || entry.requestLogFull;
    entry.record.tracers = entry.record.tracers.map((tracer) => {
      const state = states.get(tracer.runtime);
      if (!state?.ready || tracer.state === "unavailable") return tracer;
      return { ...tracer, state: state.active === 0 && state.idle > 0 ? "idle" : "ready" };
    });
    return [...states.values()].some((state) => state.ready);
  }

  async function poll(entry) {
    if (entry.polling || entry.stopRequested) return;
    entry.polling = true;
    try {
      const before = JSON.stringify(entry.record.counts);
      await entry.reader.poll();
      const ready = refreshFromReader(entry);
      if (entry.stopRequested) return;
      if (entry.record.state === "starting" && ready) {
        clearTimeout(entry.timers.ready);
        await changeState(entry, "recording");
      } else if (JSON.stringify(entry.record.counts) !== before && now() - entry.lastEventAt >= times.eventMs) {
        await publish(entry);
      }
      if (entry.record.counts.requests >= USAGE_RECORDING_LIMITS.capturedRequests) await stopEntry(entry, "request-limit");
      else if (entry.reader.hitsBytes() >= USAGE_RECORDING_LIMITS.hitsBytesPerRecording) await stopEntry(entry, "size-limit");
    } catch (error) {
      logger?.warn?.({ error, recordingId: entry.record.id }, "Usage recording could not read its trace.");
      await stopEntry(entry, "error");
    } finally {
      entry.polling = false;
    }
  }

  async function writeIndex(entry) {
    const requests = await recordingRequestRows(entry.directory, entry.reader, { runLabel: entry.record.target.label });
    const index = { schema: USAGE_RECORDING_SCHEMA, counts: entry.record.counts, requests };
    if (Buffer.byteLength(JSON.stringify(index)) <= USAGE_RECORDING_LIMITS.indexBytes) {
      await writeJsonFile(path.join(entry.directory, "index.json"), index);
    }
  }

  // Runs after the person has been told the recording is stopping: tracers get
  // a moment to write their last hits and their idle line.
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
      const ready = refreshFromReader(entry);
      if (!ready && reason === "target-exited") {
        entry.record.tracers = unreadyTracers(entry, NOT_LOADED_REASON);
        await changeState(entry, "unavailable");
      } else {
        entry.record.tracers = unreadyTracers(entry, NOT_LOADED_REASON)
          .map((tracer) => (tracer.state === "ready" ? { ...tracer, state: "idle" } : tracer));
        await writeIndex(entry);
        await changeState(entry, "stopped");
      }
    } catch (error) {
      logger?.warn?.({ error, recordingId: entry.record.id }, "Usage recording could not finish cleanly.");
      await changeState(entry, "stopped", { stopReason: "error" }).catch(() => {});
    } finally {
      live.delete(entry.record.id);
      rememberReader(entry.directory, entry.reader);
    }
  }

  // Stop always agrees: the first call tells the tracers to stop and returns at
  // once; later calls return the same recording.
  async function stopEntry(entry, reason) {
    if (!entry.stopRequested) {
      entry.stopRequested = true;
      entry.unregister();
      clearTimers(entry);
      await writeJsonFile(path.join(entry.directory, "control.json"), { state: "stopping" });
      await changeState(entry, "stopping", { stopReason: reason, stoppedAt: isoNow(now) });
      entry.finished = finish(entry, reason);
    }
    return entry.record;
  }

  // A launch that could not start, or a recorder that never loaded, ends the
  // recording without results.
  async function endWithoutResults(entry, state, reason) {
    if (entry.stopRequested) return;
    entry.stopRequested = true;
    entry.unregister();
    clearTimers(entry);
    await writeJsonFile(path.join(entry.directory, "control.json"), { state: "stopping" });
    await entry.reader.poll().catch(() => {});
    entry.record.tracers = state === "failed"
      ? entry.record.tracers.map((tracer) => ({ ...tracer, state: tracer.state === "unavailable" ? tracer.state : "failed", reason }))
      : unreadyTracers(entry, reason);
    await changeState(entry, state, { stoppedAt: isoNow(now) });
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
      requestLogFull: false,
      requestSeq: 0,
      requestsLogged: 0,
      stopRequested: false,
      timers: {},
      unregister: () => {},
      writes: Promise.resolve()
    };
    const append = (name, row) => {
      entry.writes = entry.writes.then(() => appendFile(path.join(directory, name), `${JSON.stringify(row)}\n`, { mode: 0o660 }))
        .catch((error) => logger?.warn?.({ error, recordingId: record.id }, "Usage recording could not append a line."));
      return entry.writes;
    };
    const recorderEnvironment = (environment = {}) => {
      const result = usageRecordingEnvironment({ recordingDirectory: directory, sourceRoot: context.sourceRoot, targetKind: target.kind });
      let usageRecordingPreload = "";
      for (const { prepared } of tracers) {
        Object.assign(result, prepared.environment || {}, mergePrependEnvironment(prepared.prependEnvironment, environment));
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
      proxyRequest({ method = "", path: requestPath = "", interaction = "" } = {}) {
        if (target.kind !== "web" || entry.stopRequested || entry.requestSeq >= 999_999) return null;
        entry.requestSeq += 1;
        const requestId = `r_${String(entry.requestSeq).padStart(6, "0")}`;
        const accepted = USAGE_INTERACTION_ID_PATTERN.test(String(interaction || "")) ? String(interaction) : null;
        const startedAtMs = now();
        return {
          requestId,
          interaction: accepted,
          finish({ status = null } = {}) {
            if (entry.requestsLogged >= USAGE_RECORDING_LIMITS.proxyRequestLines) {
              entry.requestLogFull = true;
              return;
            }
            entry.requestsLogged += 1;
            void append("requests.ndjson", {
              id: requestId,
              seq: Number(requestId.slice(2)),
              method: /^[A-Z]{1,16}$/u.test(String(method).toUpperCase()) ? String(method).toUpperCase() : "OTHER",
              path: String(requestPath || "/").split(/[?#]/u)[0].slice(0, 256),
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
            result = await terminals.startOutputTargetTerminal(record.sessionId, { ensurePreview: true, outputTargetId: target.outputTargetId });
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
        entry.timers.ready.unref?.();
      }
    };
    return entry;
  }

  // Keeps the newest recordings within the session's count and size budget
  // and deletes those older than the age limit. Running recordings stay.
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
        Object.assign(record, { state: "stopped", stopReason: "error", stoppedAt: record.stoppedAt || isoNow(now) });
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

  async function targetsFor(context) {
    const result = await terminals.usageRecordingTargets(context.sessionId);
    if (result?.ok === false) {
      throw recordingError(422, result.error || "This session's Output targets cannot be read.", result.code || "vibe64_usage_recording_targets_unavailable");
    }
    const describe = (outputTarget, { id, kind, label }) => {
      const runtimes = [...outputTarget.runtimes];
      const tracers = usageTracersForRuntimes(runtimes).map((tracer) => ({
        tracer,
        prepared: tracer.prepare({ recordingDirectory: "", sourceRoot: context.sourceRoot, recordingId: "", targetKind: kind })
      }));
      const ready = tracers.filter(({ prepared }) => prepared.available);
      const reason = !outputTarget.available
        ? outputTarget.disabledReason || "This Output target is unavailable."
        : tracers.length === 0
          ? recordingUnavailableReason(runtimes)
          : ready.length === 0 ? tracers.map(({ prepared }) => prepared.reason).join(" ") : "";
      return {
        id,
        kind,
        label,
        runtimes,
        available: !reason,
        reason,
        parameters: kind === "web" ? [] : outputTarget.parameters.map(({ id: parameterId, label: parameterLabel, required }) => ({
          id: parameterId, label: parameterLabel, required: required === true
        })),
        outputTarget
      };
    };
    const outputTargets = Array.isArray(result?.targets) ? result.targets : [];
    const preview = outputTargets.find((target) => target.web && target.id === result.previewTargetId);
    return [
      ...(preview ? [describe(preview, { id: "preview", kind: "web", label: "Preview" })] : []),
      ...outputTargets.filter((target) => !target.web)
        .map((target) => describe(target, { id: `output:${target.id}`, kind: "terminal", label: target.label }))
    ];
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

  return Object.freeze({
    async readTargets({ sessionId } = {}) {
      const context = await sessionContext(sessionId);
      return { targets: (await targetsFor(context)).map(({ outputTarget: _outputTarget, ...target }) => target) };
    },

    async start({ sessionId, targetId = "", parameters } = {}) {
      const context = await sessionContext(sessionId);
      assertActiveSession(context);
      assertNoActiveRecording(context);
      const sessionKey = `${context.projectScope}\n${context.sessionId}`;
      startingSessions.add(sessionKey);
      try {
        const target = (await targetsFor(context)).find((candidate) => candidate.id === String(targetId || ""));
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
          sessionId: context.sessionId, projectSlug: context.projectSlug, targetKind: target.kind, runtimes: target.runtimes
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
          const prepared = tracer.prepare({ recordingDirectory: directory, sourceRoot: context.sourceRoot, recordingId: id, targetKind: target.kind });
          if (prepared.available && prepared.nodePreload) prepared.realPreload = await realpath(prepared.nodePreload);
          if (prepared.available) tracers.push({ tracer, prepared });
          tracerRecords.push({ runtime: tracer.runtime, state: prepared.available ? "starting" : "unavailable", reason: prepared.available ? "" : prepared.reason });
        }
        const record = {
          id,
          sessionId: context.sessionId,
          state: "starting",
          target: { id: target.id, kind: target.kind, label: target.label },
          runtimes: target.runtimes,
          tracers: tracerRecords,
          startedAt: isoNow(now),
          stoppedAt: null,
          stopReason: null,
          counts: { requests: 0, functions: 0 },
          truncated: false,
          dismissedAt: null,
          sourceIdentity: await readSourceIdentity(context.sourceRoot),
          highestInteraction: 0
        };
        const entry = liveEntry({
          context, record, directory, tracers, outputParameters,
          target: { ...target, outputTargetId: target.outputTarget.id }
        });
        // Registered before its files exist, so no reader takes it for a
        // recording an earlier server process left behind. Tracers read the
        // control file and the target label as soon as the target starts.
        live.set(id, entry);
        try {
          await writeJsonFile(path.join(directory, "control.json"), { state: "recording" });
          await writeRecord(entry);
        } catch (error) {
          live.delete(id);
          await rm(directory, { force: true, recursive: true });
          throw error;
        }
        entry.unregister = registerActiveUsageRecording(context.projectScope, context.sessionId, entry.active);
        entry.timers.poll = setInterval(() => void poll(entry), times.pollMs);
        entry.timers.limit = setTimeout(() => void stopEntry(entry, "time-limit"), times.durationMs);
        entry.timers.poll.unref?.();
        entry.timers.limit.unref?.();
        await applyRetention(context.directory);
        await publish(entry);
        // The target's start can take a while; the recording reports it.
        const requestContext = captureProjectRequestContext();
        void runWithProjectRequestContext(requestContext || {}, () => entry.launchTarget());
        return { recording: publicRecording(record) };
      } finally {
        startingSessions.delete(sessionKey);
      }
    },

    async readCurrent({ sessionId } = {}) {
      const context = await sessionContext(sessionId);
      await applyRetention(context.directory);
      const recordings = await storedRecordings(context);
      const current = recordings.find((record) => ACTIVE_STATES.has(record.state)) ||
        recordings.find((record) => !record.dismissedAt && record.stoppedAt && now() - Date.parse(record.stoppedAt) <= CURRENT_WINDOW_MS);
      return { recording: current ? publicRecording(current) : null, serverTime: isoNow(now) };
    },

    async stop({ sessionId, recordingId } = {}) {
      const context = await sessionContext(sessionId);
      const { entry, record } = await recordingFor(context, recordingId);
      if (entry) return { recording: publicRecording(await stopEntry(entry, "person")) };
      const [stored] = (await storedRecordings(context)).filter((candidate) => candidate.id === record.id);
      return { recording: publicRecording(stored || record) };
    },

    async dismiss({ sessionId, recordingId } = {}) {
      const context = await sessionContext(sessionId);
      const { directory, entry, record } = await recordingFor(context, recordingId);
      record.dismissedAt ||= isoNow(now);
      if (entry) await writeRecord(entry);
      else await writeJsonFile(path.join(directory, "recording.json"), record);
      return { recording: publicRecording(record) };
    },

    async list({ sessionId } = {}) {
      const context = await sessionContext(sessionId);
      return { recordings: (await storedRecordings(context)).slice(0, USAGE_RECORDING_RETENTION.maxRecordings).map(publicRecording) };
    },

    // Oldest first unless order is "newest"; total counts every matching row.
    // A requestId reads that one row, whatever the other filters say.
    async readRequests({ sessionId, recordingId, cursor, limit, q = "", includeEmpty = false, order = "oldest", requestId = "" } = {}) {
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
    },

    async readRequestFunctions({ sessionId, recordingId, requestId, cursor, limit } = {}) {
      const context = await sessionContext(sessionId);
      const { directory } = await recordingFor(context, recordingId);
      if (!usageScopeKind(requestId)) {
        throw recordingError(404, "This request is not part of the recording.", "vibe64_usage_recording_request_not_found");
      }
      const functions = (await readerFor(directory)).scopeFunctions(String(requestId));
      const page = pageOf(functions, { cursor, limit: limit ?? 1500, maxLimit: 1500 });
      return { functions: page.items, total: functions.length, truncated: page.more };
    },

    async recordInteraction({ sessionId, recordingId, id, at, label, kind = "click", componentFile = null } = {}) {
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
    },

    async delete({ sessionId, recordingId } = {}) {
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
  });
}

export { createService };
