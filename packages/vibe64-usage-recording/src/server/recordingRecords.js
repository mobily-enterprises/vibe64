import path from "node:path";

import { vibe64SessionViewersRoom } from "@local/vibe64-core/server/sessionRealtimeEvents";

import { recordingRequestRows, writeJsonFile } from "./traceStore.js";
import { USAGE_RECORDING_CHANGED_EVENT, USAGE_RECORDING_LIMITS, USAGE_RECORDING_SCHEMA } from "../shared/contract.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEvents} RuntimeEvents */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */

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

const isoNow = (now) => new Date(now()).toISOString();

function publicRecording(record) {
  const { id, sessionId, state, target, runtimes, tracers, startedAt, stoppedAt, stopReason, counts, truncated, dismissedAt, sourceIdentity, highestInteraction, requestLog } = record;
  return structuredClone({
    id, sessionId, state, target, runtimes, tracers, startedAt, stoppedAt, stopReason, counts, truncated, dismissedAt,
    sourceIdentity: sourceIdentity ?? null, highestInteraction: highestInteraction ?? 0, requestLog: requestLog ?? { assets: 0, full: false }
  });
}

/**
 * A live recording's record: its file, the change event its viewers get, and
 * what its tracers' trace says about them.
 * @param {object} dependencies
 * @param {RuntimeEvents} dependencies.events
 * @param {RuntimeLogger} dependencies.logger
 * @param {() => number} dependencies.now
 */
function createRecordingRecords({ events, logger, now }) {
  async function publish(entry) {
    entry.lastEventAt = now();
    if (!entry.projectSlug) return;
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
      logger.warn({ error, recordingId: record.id }, "Usage recording change could not be published.");
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
    entry.record.truncated = entry.reader.truncated() || entry.record.requestLog.full;
    entry.record.tracers = entry.record.tracers.map((tracer) => {
      const state = states.get(tracer.runtime);
      if (!state?.ready || tracer.state === "unavailable") return tracer;
      return { ...tracer, state: state.active === 0 && state.idle > 0 ? "idle" : "ready" };
    });
    return [...states.values()].some((state) => state.ready);
  }

  async function writeIndex(entry) {
    const requests = await recordingRequestRows(entry.directory, entry.reader, { runLabel: entry.record.target.label });
    const index = { schema: USAGE_RECORDING_SCHEMA, counts: entry.record.counts, requests };
    if (Buffer.byteLength(JSON.stringify(index)) <= USAGE_RECORDING_LIMITS.indexBytes) {
      await writeJsonFile(path.join(entry.directory, "index.json"), index);
    }
  }

  return Object.freeze({ changeState, publish, refreshFromReader, unreadyTracers, writeIndex, writeRecord });
}

/** @typedef {ReturnType<typeof createRecordingRecords>} RecordingRecords */

export { createRecordingRecords, isoNow, publicRecording };
