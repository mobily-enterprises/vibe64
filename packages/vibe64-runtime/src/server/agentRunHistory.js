// A session agent run keeps the events of its last two turns; the events of every turn before them are in its
// history, `agent-runs/<run id>.history.jsonl` beside it, one event per line, oldest first, which no session read
// opens. A run used to keep every event of its session's whole life (Codex writes several each turn and one at every
// phase change), so each open or reload of a session read, parsed and sent all of them, and each event rewrote them
// all. Now both cost two turns, at one stored turn as at a thousand.
//
// A turn starts at an event in an active state that follows one in an ended state, or opens the run, as
// workingTurns.js reads a working turn's start. The two turns kept are what the run's readers use: the working
// turn's events, and the turn just ended, whose result-processed event a late result of that turn still finds.
//
// The run's `eventHistoryBytes` is how much of its history holds the events it moved there. An append whose run
// never reached the disk (a crash between the two writes) is cut off before the next one, so each event is in the
// history once and in the run or the history, never neither.

import { open } from "node:fs/promises";
import { runStateIsActive } from "./agentRunStates.js";

const AGENT_RUN_HISTORY_SUFFIX = ".history.jsonl";

/**
 * How many of a run's first events belong to turns before its last two: the events before the start of its
 * second-to-last turn, or 0 when it holds two turns or fewer. It looks back only that far.
 * @param {unknown[]} events
 */
function agentRunRetiredEventCount(events) {
  let starts = 0;
  for (let index = events.length - 1; index > 0; index -= 1) {
    if (runStateIsActive(events[index]?.state) && !runStateIsActive(events[index - 1]?.state)) {
      starts += 1;
      if (starts === 2) return index;
    }
  }
  return 0;
}

/** The history lines of events, each one JSON line. @param {unknown[]} events */
function agentRunHistoryLines(events) {
  return events.map((event) => `${JSON.stringify(event)}\n`).join("");
}

/** The bytes of a run's history that hold the events it moved there. @param {{ eventHistoryBytes?: unknown }} record */
function recordedHistoryBytes(record) {
  const bytes = Number(record?.eventHistoryBytes);
  return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : 0;
}

/**
 * A run and its history after moving the events of its turns before its last two, from the run and the history's
 * current text (null for none): what the 20261125-agent-run-history upgrade publishes. Null when the run holds two
 * turns or fewer, so a run that upgrade or a write already split is left as it is.
 * @param {{ events: unknown[], eventHistoryBytes?: unknown }} record
 * @param {Buffer | null} history
 * @returns {{ record: object, history: Buffer } | null}
 */
function splitAgentRunHistory(record, history) {
  const count = agentRunRetiredEventCount(record.events);
  if (!count) return null;
  const kept = history ? history.subarray(0, Math.min(history.length, recordedHistoryBytes(record))) : Buffer.alloc(0);
  const next = Buffer.concat([kept, Buffer.from(agentRunHistoryLines(record.events.slice(0, count)), "utf8")]);
  return {
    history: next,
    record: { ...record, events: record.events.slice(count), eventHistoryBytes: next.length }
  };
}

/**
 * Moves the events of a run's turns before its last two to the end of its history, synced, and returns the run
 * without them, for the caller to publish; the run itself when it holds two turns or fewer. Callers hold the
 * session's mutation lease. The history's folder entry reaches the disk with the run published after it, which
 * syncs the same folder.
 * @param {string} historyPath
 * @param {{ events: unknown[], eventHistoryBytes?: unknown }} record
 */
async function retireAgentRunEvents(historyPath, record) {
  const count = agentRunRetiredEventCount(record.events);
  if (!count) return record;
  const lines = Buffer.from(agentRunHistoryLines(record.events.slice(0, count)), "utf8");
  const handle = await open(historyPath, "a");
  let start;
  try {
    const size = (await handle.stat()).size;
    start = Math.min(size, recordedHistoryBytes(record));
    // What a run that never reached the disk moved here: it still holds those events.
    if (size > start) await handle.truncate(start);
    for (let written = 0; written < lines.length;) {
      const { bytesWritten } = await handle.write(lines, written, lines.length - written);
      if (!bytesWritten) throw new Error("The agent run history accepted no more bytes.");
      written += bytesWritten;
    }
    await handle.datasync();
  } finally {
    await handle.close();
  }
  return { ...record, events: record.events.slice(count), eventHistoryBytes: start + lines.length };
}

export {
  AGENT_RUN_HISTORY_SUFFIX,
  agentRunHistoryLines,
  agentRunRetiredEventCount,
  retireAgentRunEvents,
  splitAgentRunHistory
};
