// The words of a turn interruption's entry in a chat's history: what ended the turn, then whether Vibe64 resumed it or
// why not, in red; or, for a planned stop what ran carried on through, one informational line. The server writes them
// with UTC times as the entry's text; the chat writes them again from the entry's data with the viewer's own clock
// (Vibe64TurnInterruption.vue), so both read the same.

const TURN_INTERRUPTION_CAUSES = Object.freeze({
  // Vibe64's previous process ended without shutting down.
  CRASH: "crash",
  // Vibe64's previous process shut down in order and the same version started again (a stop, a restart, a move).
  RESTART: "restart",
  // Vibe64's previous process shut down in order and a different version started.
  UPDATE: "update",
  // The AI engine's process ended while Vibe64 ran, or the engine stopped the turn itself with a reason of its own.
  ENGINE: "engine",
  // Vibe64 lost its connection to the AI, or the AI service was unreachable.
  CONNECTION: "connection",
  // The AI service was overloaded.
  OVERLOADED: "overloaded",
  // The AI account needs signing in again.
  SIGN_IN: "sign-in",
  // The AI account reached its usage limit or ran out of credit.
  USAGE_LIMIT: "usage-limit",
  // The AI reported another error that ended the turn.
  FAILED: "failed"
});

// A stop in order (a release, a rollback, a machine restart): what ran carries on, and the loop rule never counts it.
const PLANNED_CAUSES = Object.freeze([TURN_INTERRUPTION_CAUSES.RESTART, TURN_INTERRUPTION_CAUSES.UPDATE]);

/**
 * The loop rule's limits (turnInterruptions.js): an unplanned end (a crash, a kill, an engine or a connection lost)
 * stops what ran the third time in a row; a planned stop never counts, but a run of them this long, each soon after the
 * resume before it, is a turn that stops Vibe64 itself, and stops too.
 */
const TURN_RESUME_LOOP_LIMIT = 3;
const TURN_RESUME_PLANNED_LOOP_LIMIT = 10;

const trimEnd = value => String(value || "").trim().replace(/[.\s]+$/u, "");
const times = count => ({ 2: "twice", 3: "three times" })[count] || `${count} times`;

/** Whether Vibe64 stopped in order: a planned restart or an update. @param {string} cause */
function turnInterruptionPlanned(cause) {
  return PLANNED_CAUSES.includes(cause);
}

/**
 * Whether the entry is a planned stop that what ran carried on through: one informational line, not a red entry.
 * @param {{ cause?: string, outcome?: string }} entry
 */
function turnInterruptionCarriedOn(entry) {
  return entry?.outcome === "resumed" && turnInterruptionPlanned(entry.cause);
}

/** The interruption's short name, as "Resumed after … at 04:18" reads it. */
function causePhrase(cause) {
  switch (cause) {
    case TURN_INTERRUPTION_CAUSES.UPDATE: return "Vibe64 was updated";
    case TURN_INTERRUPTION_CAUSES.ENGINE: return "the AI engine stopped";
    case TURN_INTERRUPTION_CAUSES.CONNECTION: return "the connection to the AI was lost";
    case TURN_INTERRUPTION_CAUSES.OVERLOADED: return "the AI service was overloaded";
    case TURN_INTERRUPTION_CAUSES.FAILED: return "the AI's error";
    case TURN_INTERRUPTION_CAUSES.SIGN_IN: return "the AI account was signed out";
    default: return "Vibe64 restarted";
  }
}

/** What happened again and again, for the loop rule's stop. */
function causeRepeatedPhrase(cause) {
  const inARow = `${times(TURN_RESUME_LOOP_LIMIT)} in a row while it ran`;
  switch (cause) {
    case TURN_INTERRUPTION_CAUSES.RESTART:
    case TURN_INTERRUPTION_CAUSES.UPDATE:
      return `Vibe64 was stopped and started again ${times(TURN_RESUME_PLANNED_LOOP_LIMIT)} in a row while it ran`;
    case TURN_INTERRUPTION_CAUSES.ENGINE: return `the AI engine stopped ${inARow}`;
    case TURN_INTERRUPTION_CAUSES.CONNECTION: return `the connection to the AI was lost ${inARow}`;
    case TURN_INTERRUPTION_CAUSES.OVERLOADED: return `the AI service was overloaded ${inARow}`;
    default: return `Vibe64 stopped unexpectedly ${inARow}`;
  }
}

/**
 * The one line of a planned stop that what ran carried on through, such as "Vibe64 was updated at 04:18; the goal
 * carried on."
 * @param {{ cause: string, at: string, goal?: boolean, newConnection?: boolean }} entry
 * @param {(at: string) => string} clock
 */
function turnInterruptionCarriedOnLine(entry, clock) {
  const at = entry.at ? clock(entry.at) : "";
  const stop = entry.cause === TURN_INTERRUPTION_CAUSES.UPDATE ? "Vibe64 was updated" : "Vibe64 was restarted";
  const account = entry.newConnection ? " with the AI account connected now" : "";
  return `${stop}${at ? ` at ${at}` : ""}; ${entry.goal ? "the goal" : "this turn"} carried on${account}.`;
}

/**
 * The red entry's first line: what ended the turn, and when.
 * @param {{ cause: string, at: string, detail?: string, crashMessage?: string, unknownRun?: boolean }} entry
 * @param {(at: string) => string} clock a time's words, such as "04:18 UTC" or the viewer's "12:18"
 */
function turnInterruptionHeadline(entry, clock) {
  const at = entry.at ? clock(entry.at) : "";
  const when = at ? ` at ${at}` : "";
  const detail = trimEnd(entry.detail);
  const withDetail = detail ? `: ${detail}` : "";
  switch (entry.cause) {
    case TURN_INTERRUPTION_CAUSES.CRASH: {
      if (entry.unknownRun) return `Vibe64 restarted${when}.`;
      const crash = trimEnd(entry.crashMessage);
      return crash ? `Vibe64 crashed${when}: ${crash}.` : `Vibe64 restarted${when} (the server stopped unexpectedly).`;
    }
    case TURN_INTERRUPTION_CAUSES.UPDATE: return `Vibe64 was updated${when}, which stopped this turn.`;
    case TURN_INTERRUPTION_CAUSES.RESTART: return `Vibe64 restarted${when} (it was stopped and started again).`;
    case TURN_INTERRUPTION_CAUSES.ENGINE: return `The AI engine stopped${when}${withDetail}.`;
    case TURN_INTERRUPTION_CAUSES.CONNECTION: return `The connection to the AI was lost${when}${withDetail}.`;
    case TURN_INTERRUPTION_CAUSES.OVERLOADED: return `The AI service was overloaded${when}${withDetail}.`;
    case TURN_INTERRUPTION_CAUSES.SIGN_IN: return `The AI account needs signing in again${when}${withDetail}.`;
    case TURN_INTERRUPTION_CAUSES.USAGE_LIMIT: return `The AI account reached its usage limit${when}${withDetail}.`;
    case TURN_INTERRUPTION_CAUSES.FAILED: return `The AI stopped with an error${when}${withDetail}.`;
    default: return `This turn was interrupted${when}.`;
  }
}

/**
 * The red entry's second line: resumed, or why not.
 * @param {{ cause: string, at: string, outcome: string, error?: string, goal?: boolean, resumeAt?: string,
 *   newConnection?: boolean }} entry newConnection: resumed on the AI account connected now, which changed since it ran
 *   outcome: resumed, resuming, loop, stopped, account (signed out, or its AI account can't be used: Vibe64 continues
 *   it once one is set), sign-in (before that), usage-limit, not-resumed, uncertain or failed (a resume that could not
 *   be sent)
 * @param {(at: string) => string} clock
 */
function turnInterruptionOutcomeLine(entry, clock) {
  const control = entry.goal ? "Resume goal" : "Continue";
  const at = entry.at ? clock(entry.at) : "";
  switch (entry.outcome) {
    case "resumed": return `Resumed after ${causePhrase(entry.cause)}${at && entry.cause !== "failed" ? ` at ${at}` : ""}` +
      `${entry.newConnection ? ", with the AI account connected now" : ""}.`;
    case "resuming": {
      const later = entry.resumeAt ? clock(entry.resumeAt) : "";
      return `Vibe64 resumes it${later ? ` at ${later}` : " shortly"}.`;
    }
    case "loop": return `Not resumed: stopped: ${causeRepeatedPhrase(entry.cause)}. Choose ${control} to try again.`;
    case "stopped": return "Not resumed: you stopped this turn.";
    // An entry written before Vibe64 continued such a turn by itself once an account is set ("account").
    case "sign-in": return `Not resumed: sign in to the AI account again in AI Accounts, then choose ${control}.`;
    // Signed out, or refused by its AI account (error): Vibe64 continues it once an account its person can use is set.
    case "account": return entry.error
      ? `Not resumed yet: ${trimEnd(entry.error)}. Vibe64 continues it once an AI account you can use is set in AI Accounts.`
      : "Not resumed yet: sign in to the AI account again in AI Accounts, and Vibe64 continues it.";
    case "usage-limit": return entry.goal
      ? "Not resumed now: Vibe64 continues the goal when the limit resets."
      : "Not resumed: choose Continue, or send a message, once the limit resets.";
    // With an error: why, such as a goal no attempt after a restart could continue.
    case "not-resumed": return entry.error ? `Not resumed: ${trimEnd(entry.error)}. Choose ${control} to try again.`
      : `Not resumed: choose ${control} to try again.`;
    case "uncertain": return "Not resumed: Vibe64 could not confirm whether the AI received the message. Choose Retry to check; it never sends a duplicate.";
    // After "Resumed after …": the resume itself could not be sent.
    default: return `The resume could not be sent${entry.error ? `: ${trimEnd(entry.error)}` : ""}. Choose ${control} to try again.`;
  }
}

/**
 * The entry's lines: what ended the turn and whether Vibe64 resumed it, or the one line of a planned stop it carried on
 * through.
 * @param {Parameters<typeof turnInterruptionOutcomeLine>[0]} entry
 * @param {(at: string) => string} clock
 */
function turnInterruptionLines(entry, clock) {
  if (turnInterruptionCarriedOn(entry)) return [turnInterruptionCarriedOnLine(entry, clock)];
  return [turnInterruptionHeadline(entry, clock), turnInterruptionOutcomeLine(entry, clock)];
}

/** "04:18 UTC" for an ISO time; "" when it is not one. */
function utcClock(at) {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? "" : `${date.toISOString().slice(11, 16)} UTC`;
}

/**
 * The error of a request whose turn its AI account stopped, which its Continue control shows while it waits for an
 * account, or of such a goal, which its Resume goal control shows: signed out, or refused with `error`.
 * @param {string} cause
 * @param {string} [error]
 * @param {{ goal?: boolean }} [options]
 */
function turnInterruptionAccountWait(cause, error = "", { goal = false } = {}) {
  const work = goal ? "the goal" : "this turn";
  return cause === TURN_INTERRUPTION_CAUSES.SIGN_IN && !error
    ? `Sign in to the AI account again in AI Accounts, and Vibe64 continues ${work}.`
    : `${trimEnd(error)}. Vibe64 continues ${work} once an AI account you can use is set in AI Accounts.`;
}

/** A Stopped request's error after the loop rule stopped resuming it, which its Continue control shows. */
function turnInterruptionLoopError(cause) {
  return `Stopped: ${causeRepeatedPhrase(cause)}. Choose Continue to try again.`;
}

export {
  TURN_INTERRUPTION_CAUSES,
  TURN_RESUME_LOOP_LIMIT,
  TURN_RESUME_PLANNED_LOOP_LIMIT,
  turnInterruptionAccountWait,
  turnInterruptionCarriedOn,
  turnInterruptionHeadline,
  turnInterruptionLines,
  turnInterruptionLoopError,
  turnInterruptionOutcomeLine,
  turnInterruptionPlanned,
  utcClock
};
