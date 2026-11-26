// The repeated commands of a Main turn: the editor counts each finished shell command of the session's routed Main
// turn (a message's turn, an Auto step, a plan's pass) by its text, with only its whitespace collapsed, and the time
// commands run more than once take. A turn that crosses the line tells its AI once, and its end shows the person the
// same numbers. The line marks what is clearly broken, not a target. The count lives only in memory, for the turn
// running now: a new turn, its end, the session's close and a restart start it again from nothing. It never stops,
// slows or changes a command.

import { createHash } from "node:crypto";
import { toText } from "@jskit-ai/kernel/shared/support/normalize";
import { logOperationalEvent, sanitizeLogText } from "@local/vibe64-core/server/logging";
import { decodedCommand } from "./agentSessionCommandRun.js";

/**
 * Steers the session's running Main turn with Vibe64's note, for the person whose request it runs.
 * @typedef {(sessionId: string, message: string, options: { actor: object | null, projectSlug: string }) => Promise<unknown>} NoteAgent
 */

const MINUTE_MS = 60_000;
const COMMAND_REPEAT_LIMITS = Object.freeze({
  // One command text run this many times or more...
  runs: 5,
  // ...whose runs took this long in all, so cheap repeats (git status, say) never count.
  runsMs: 5 * MINUTE_MS,
  // Or every command run more than once, all its runs together.
  repeatedMs: 15 * MINUTE_MS
});
// The different command texts one turn holds; past it, a new text still counts toward the turn's time.
const MAX_TURN_COMMANDS = 1_000;
const EXCERPT_CHARACTERS = 160;
// What the person reads at the turn's end: the repeated commands that took the most time.
const SUMMARY_COMMANDS = 3;
// A long word of letters and digits, as a key or token has, which no assignment names.
const TOKEN_SHAPE_PATTERN = /(?<![A-Za-z0-9_-])(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{24,}(?![A-Za-z0-9_-])/gu;

const normalizedCommand = (command) => String(command || "").replace(/\s+/gu, " ").trim();

/**
 * A command as a notice shows it: masked as the editor's logs and command output tails are (sanitizeLogText), with
 * every token-looking word masked too, then cut short. Backticks become quotes, so the excerpt stays one code span.
 * @param {string} text the normalized command
 */
function commandExcerpt(text) {
  const masked = sanitizeLogText(text).replace(TOKEN_SHAPE_PATTERN, "[redacted]").replaceAll("`", "'");
  return masked.length > EXCERPT_CHARACTERS ? `${masked.slice(0, EXCERPT_CHARACTERS - 1)}…` : masked;
}

const minutes = (ms) => `${Math.max(1, Math.round(ms / MINUTE_MS))} min`;

/** The turn's repeated commands, the most time first. */
function repeatedCommands(turn) {
  return [...turn.commands.values()].filter((entry) => entry.runs > 1).sort((left, right) => right.ms - left.ms || right.runs - left.runs);
}

function agentNotice(turn) {
  const [top] = repeatedCommands(turn);
  return [
    `Vibe64 noticed repeated commands in this turn: \`${top.excerpt}\` has run ${top.runs} times (${minutes(top.ms)} in all),`,
    `and commands run more than once have taken ${minutes(turn.repeatedMs)} of this turn's ${minutes(turn.totalMs)} of commands.`,
    "Please batch your changes: make the related edits together, run the narrowest test that checks them while you iterate,",
    "and run the full set once at the end. This notice comes once per turn; nothing is stopped or slowed."
  ].join(" ");
}

function personSummary(turn) {
  const listed = repeatedCommands(turn).slice(0, SUMMARY_COMMANDS)
    .map((entry) => `\`${entry.excerpt}\` ${entry.runs} times (${minutes(entry.ms)})`).join(", ");
  return [
    `This turn reran commands far more than its work needed: ${listed}.`,
    `Commands run more than once took ${minutes(turn.repeatedMs)} of the turn's ${minutes(turn.totalMs)} of commands.`,
    "Vibe64 told the AI once to batch its changes, run the narrowest test while iterating and run the full set once at the end."
  ].join(" ");
}

/**
 * @param {{ limits?: { runs: number, runsMs: number, repeatedMs: number } }} [options]
 */
function createAgentCommandRepeats({ limits = COMMAND_REPEAT_LIMITS } = {}) {
  /** @type {Map<string, { turnId: string, commands: Map<string, { excerpt: string, runs: number, ms: number }>, runs: number, totalMs: number, repeatedMs: number, crossed: boolean }>} */
  const turns = new Map();

  /**
   * Counts one finished command of the session's turn `turnId`; a turn other than the one counted starts the count
   * again. Returns the AI's notice when this run crosses the line, once per turn, and "" otherwise.
   * @param {string} sessionId
   * @param {string} turnId
   * @param {string} command
   * @param {number} durationMs
   */
  function record(sessionId, turnId, command, durationMs) {
    const text = normalizedCommand(command);
    if (!sessionId || !turnId || !text) return "";
    let turn = turns.get(sessionId);
    if (turn?.turnId !== turnId) {
      turn = { turnId, commands: new Map(), runs: 0, totalMs: 0, repeatedMs: 0, crossed: false };
      turns.set(sessionId, turn);
    }
    const ms = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
    turn.runs += 1;
    turn.totalMs += ms;
    const key = createHash("sha256").update(text).digest("base64url");
    let entry = turn.commands.get(key);
    if (!entry) {
      if (turn.commands.size >= MAX_TURN_COMMANDS) return "";
      entry = { excerpt: commandExcerpt(text), runs: 0, ms: 0 };
      turn.commands.set(key, entry);
    }
    entry.runs += 1;
    entry.ms += ms;
    // A command's first run joins the repeated time when it runs again.
    if (entry.runs === 2) turn.repeatedMs += entry.ms;
    else if (entry.runs > 2) turn.repeatedMs += ms;
    if (turn.crossed) return "";
    const crossed = entry.runs >= limits.runs && entry.ms >= limits.runsMs || turn.repeatedMs >= limits.repeatedMs;
    if (!crossed) return "";
    turn.crossed = true;
    return agentNotice(turn);
  }

  /**
   * Ends the session's counted turn: its summary for the person when it crossed the line, else null.
   * @param {string} sessionId
   * @returns {{ turnId: string, text: string } | null}
   */
  function endTurn(sessionId) {
    const turn = turns.get(sessionId);
    turns.delete(sessionId);
    return turn?.crossed ? { turnId: turn.turnId, text: personSummary(turn) } : null;
  }

  /** @param {string} sessionId */
  function forget(sessionId) {
    turns.delete(sessionId);
  }

  /** The session's counted turn, as numbers, or null. @param {string} sessionId */
  function read(sessionId) {
    const turn = turns.get(sessionId);
    return turn ? {
      turnId: turn.turnId,
      runs: turn.runs,
      totalMs: turn.totalMs,
      repeatedMs: turn.repeatedMs,
      crossed: turn.crossed,
      commands: turn.commands.size
    } : null;
  }

  return Object.freeze({
    record,
    endTurn,
    forget,
    read
  });
}

/**
 * The session command service's side of the count: it times each command, counts the ones that ran in the session's
 * routed Main turn once they have answered, tells the turn's AI when it crosses the line, and writes the person's
 * summary when the turn ends. Nothing a command waits for depends on it, and each failure is only logged.
 * @param {object} dependencies
 * @param {ReturnType<typeof createAgentCommandRepeats>} dependencies.commandRepeats
 * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} dependencies.logger
 * @param {NoteAgent} dependencies.noteAgent
 * @param {() => number} dependencies.now
 * @param {(sessionId: string, payload: object) => Promise<unknown>} dependencies.publishSessionChanged
 * @param {(store: object, sessionId: string, binding: object) => Promise<{ actor: object | null, turnId: string }>} dependencies.requestTurn
 *   the person and the turn of the session's working Main chat request
 * @param {(sessionId: string, operation: (bound: { binding: object, store: object }) => Promise<unknown>) => Promise<unknown>} dependencies.runInSessionProject
 */
function createTurnCommandRepeats({ commandRepeats, logger, noteAgent, now, publishSessionChanged, requestTurn, runInSessionProject }) {
  /** A failed count or note, only logged. */
  const tallyFailed = (sessionId) => (error) => logOperationalEvent(logger, "warn", {
    code: toText(error?.code),
    component: "vibe64.agent_session_command",
    error: error?.message,
    event: "vibe64.agent_session_command.repeats_failed",
    sessionId
  }, "A session command's repeat count or its note to the AI failed; the command itself was not affected.");
  /** The clock, or NaN when it fails: such a command is left uncounted. */
  const readClock = () => {
    try {
      return now();
    } catch {
      return Number.NaN;
    }
  };

  /** Counts one finished command in the session's working Main turn and tells its AI when the turn crosses the line. */
  async function tally(sessionId, commandBase64, durationMs) {
    const command = decodedCommand(commandBase64);
    if (!sessionId || !command) return;
    await runInSessionProject(sessionId, async ({ binding, store }) => {
      const { actor, turnId } = await requestTurn(store, sessionId, binding);
      const notice = turnId ? commandRepeats.record(sessionId, turnId, command, durationMs) : "";
      if (notice) await noteAgent(sessionId, notice, { actor: actor || null, projectSlug: binding.projectSlug });
    });
  }

  /**
   * Starts timing a command; the function it returns counts the command once its answer is on its way.
   * @param {string} sessionId
   * @param {string} commandBase64
   */
  function begin(sessionId, commandBase64) {
    const startedAtMs = readClock();
    return () => {
      const durationMs = readClock() - startedAtMs;
      if (!Number.isFinite(durationMs)) return;
      setImmediate(() => tally(sessionId, commandBase64, durationMs).catch(tallyFailed(sessionId)));
    };
  }

  /**
   * The person's summary of the session's Main turn that just ended, when the turn crossed the line: one system row
   * in Main chat with its final numbers. The count ends with the turn either way.
   * @param {string} sessionId
   * @returns {Promise<object | null>} the row written, or null
   */
  async function summarize(sessionId) {
    const normalizedSessionId = toText(sessionId);
    const summary = commandRepeats.endTurn(normalizedSessionId);
    if (!summary) return null;
    return runInSessionProject(normalizedSessionId, async ({ store }) => {
      const turn = await store.writeConversationSystemMessage(normalizedSessionId, {
        messageId: `vibe64-command-repeats:${summary.turnId}`,
        text: summary.text
      });
      if (turn) {
        await publishSessionChanged(normalizedSessionId, {
          reason: "agent-command-repeats",
          payload: { conversationLogPatch: { type: "upsert-turn", turn } }
        });
      }
      return turn || null;
    });
  }

  /** @param {string} sessionId */
  function forget(sessionId) {
    commandRepeats.forget(toText(sessionId));
  }

  return Object.freeze({
    begin,
    summarize,
    forget
  });
}

export {
  COMMAND_REPEAT_LIMITS,
  createAgentCommandRepeats,
  createTurnCommandRepeats
};
