import path from "node:path";

import { recordingError } from "./recordingError.js";
import { pageOf, readInteractions, readJsonFile, recordingRequestRows, unionFunctions } from "./traceStore.js";
import { USAGE_INTERACTION_ID_PATTERN, USAGE_RECORDING_LIMITS, usageScopeKind } from "../shared/contract.js";

/** @typedef {ReturnType<typeof import("./traceStore.js").createTraceReader>} TraceReader */
/** @typedef {{ directory: string, entry: object | null, record: object }} FoundRecording */

/** An interaction as results read it: a click unless it names its kind, and its component file or null. */
const publicInteraction = ({ id, label, kind, componentFile }) => ({ id, label, kind: kind || "click", componentFile: componentFile ?? null });

/**
 * What a recording's results show: its requests, and the functions one request
 * or one interaction's requests ran. Each read takes the recording the service
 * found for the session.
 * @param {object} dependencies
 * @param {(directory: string) => Promise<TraceReader>} dependencies.readerFor
 */
function createRecordingResults({ readerFor }) {
  /**
   * Every row of a recording: its index once it stopped, else read from its logs and trace.
   * @param {FoundRecording} recording
   */
  async function recordingRows({ directory, entry, record }) {
    const index = entry ? null : await readJsonFile(path.join(directory, "index.json"), USAGE_RECORDING_LIMITS.indexBytes);
    return Array.isArray(index?.requests)
      ? index.requests
      : recordingRequestRows(directory, await readerFor(directory), { runLabel: record.target.label });
  }

  /**
   * Oldest first unless order is "newest"; total counts the matching requests
   * and runs, as the recording's count does: start-up work and the readiness
   * check are rows, not requests. A requestId reads that one row, whatever the
   * other filters say. Each interaction says how many requests it probably
   * started in the whole recording, whatever the page and filters hold.
   * @param {FoundRecording} recording
   */
  async function readRequests(recording, { cursor, limit, q = "", includeEmpty = false, order = "oldest", requestId = "" }) {
    const rows = await recordingRows(recording);
    const query = String(q || "").trim().toLowerCase();
    const matching = rows.filter((row) => (requestId ? row.id === requestId : (includeEmpty === true || row.functionCount > 0) &&
      (!query || `${row.method || ""} ${row.path || ""}`.toLowerCase().includes(query))));
    const page = pageOf(order === "newest" ? matching.reverse() : matching, { cursor, limit, maxLimit: 200 });
    const referenced = new Set(page.items.map((row) => row.interaction).filter(Boolean));
    const started = new Map();
    for (const row of rows) if (referenced.has(row.interaction)) started.set(row.interaction, (started.get(row.interaction) || 0) + 1);
    const interactions = (await readInteractions(recording.directory)).filter((row) => referenced.has(row.id))
      .map((row) => ({ ...publicInteraction(row), requestCount: started.get(row.id) }));
    const total = matching.filter((row) => row.kind !== "background" && row.kind !== "readiness").length;
    return { requests: page.items, interactions, nextCursor: page.more ? page.next : null, total };
  }

  /** @param {FoundRecording} recording */
  async function readRequestFunctions({ directory }, { requestId, cursor, limit }) {
    if (!usageScopeKind(requestId)) {
      throw recordingError(404, "This request is not part of the recording.", "vibe64_usage_recording_request_not_found");
    }
    const functions = (await readerFor(directory)).scopeFunctions(String(requestId));
    const page = pageOf(functions, { cursor, limit: limit ?? 1500, maxLimit: 1500 });
    return { functions: page.items, total: functions.length, truncated: page.more };
  }

  /**
   * Everything one interaction probably started: the functions of every request
   * the proxy tagged with it, each once with its counts added up, cut once at
   * the limit. requests lists those requests in recorded order.
   * @param {FoundRecording} recording
   */
  async function readInteractionFunctions(recording, { interactionId, cursor, limit }) {
    const interaction = USAGE_INTERACTION_ID_PATTERN.test(String(interactionId))
      ? (await readInteractions(recording.directory)).find((row) => row.id === interactionId)
      : null;
    if (!interaction) {
      throw recordingError(404, "This interaction is not part of the recording.", "vibe64_usage_recording_interaction_not_found");
    }
    const requests = (await recordingRows(recording)).filter((row) => row.interaction === interaction.id).map((row) => row.id);
    const reader = await readerFor(recording.directory);
    const plumbing = reader.plumbingKeys();
    const functions = unionFunctions(requests.map((id) => reader.scopeFunctions(id, plumbing)));
    const page = pageOf(functions, { cursor, limit: limit ?? 1500, maxLimit: 1500 });
    return { functions: page.items, total: functions.length, truncated: page.more, requests, interaction: publicInteraction(interaction) };
  }

  return Object.freeze({
    readRequests,
    readRequestFunctions,
    readInteractionFunctions
  });
}

export { createRecordingResults };
