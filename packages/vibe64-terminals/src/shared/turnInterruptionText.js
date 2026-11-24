// The words of a turn interruption's red entry in a chat's history: what ended the turn, then whether Vibe64 resumed
// it or why not. The server writes them with UTC times as the entry's text; the chat writes them again from the
// entry's data with the viewer's own clock (Vibe64TurnInterruption.vue), so both read the same.

const TURN_INTERRUPTION_CAUSES = Object.freeze({
  // Vibe64's previous process ended without shutting down.
  CRASH: "crash",
  // Vibe64's previous process shut down in order and the same version started again (a stop, a restart, a move).
  RESTART: "restart",
  // Vibe64's previous process shut down in order and a different version started.
  UPDATE: "update",
  // The AI engine's process ended while Vibe64 ran.
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

const trimEnd = value => String(value || "").trim().replace(/[.\s]+$/u, "");

/** The interruption's short name, as "Resumed after … at 04:18" reads it. */
function causePhrase(cause) {
  switch (cause) {
    case TURN_INTERRUPTION_CAUSES.UPDATE: return "Vibe64 was updated";
    case TURN_INTERRUPTION_CAUSES.ENGINE: return "the AI engine stopped";
    case TURN_INTERRUPTION_CAUSES.CONNECTION: return "the connection to the AI was lost";
    case TURN_INTERRUPTION_CAUSES.OVERLOADED: return "the AI service was overloaded";
    case TURN_INTERRUPTION_CAUSES.FAILED: return "the AI's error";
    default: return "Vibe64 restarted";
  }
}

/** What happened twice, for the crash-loop stop. */
function causeTwicePhrase(cause) {
  switch (cause) {
    case TURN_INTERRUPTION_CAUSES.ENGINE: return "the AI engine stopped twice while it ran";
    case TURN_INTERRUPTION_CAUSES.CONNECTION: return "the connection to the AI was lost twice while it ran";
    case TURN_INTERRUPTION_CAUSES.OVERLOADED: return "the AI service was overloaded twice while it ran";
    default: return "Vibe64 restarted twice while it ran";
  }
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
 * @param {{ cause: string, at: string, outcome: string, error?: string, goal?: boolean, resumeAt?: string }} entry
 *   outcome: resumed, resuming, loop, stopped, sign-in, usage-limit, not-resumed, uncertain or failed (a resume that
 *   could not be sent)
 * @param {(at: string) => string} clock
 */
function turnInterruptionOutcomeLine(entry, clock) {
  const control = entry.goal ? "Resume goal" : "Continue";
  const at = entry.at ? clock(entry.at) : "";
  switch (entry.outcome) {
    case "resumed": return `Resumed after ${causePhrase(entry.cause)}${at && entry.cause !== "failed" ? ` at ${at}` : ""}.`;
    case "resuming": {
      const later = entry.resumeAt ? clock(entry.resumeAt) : "";
      return `Vibe64 resumes it${later ? ` at ${later}` : " shortly"}.`;
    }
    case "loop": return `Not resumed: stopped: ${causeTwicePhrase(entry.cause)}. Choose ${control} to try again.`;
    case "stopped": return "Not resumed: you stopped this turn.";
    case "sign-in": return `Not resumed: sign in to the AI account again in AI Accounts, then choose ${control}.`;
    case "usage-limit": return entry.goal
      ? "Not resumed now: Vibe64 continues the goal when the limit resets."
      : "Not resumed: choose Continue, or send a message, once the limit resets.";
    case "not-resumed": return `Not resumed: choose ${control} to try again.`;
    case "uncertain": return "Not resumed: Vibe64 could not confirm whether the AI received the message. Choose Retry to check; it never sends a duplicate.";
    // After "Resumed after …": the resume itself could not be sent.
    default: return `The resume could not be sent${entry.error ? `: ${trimEnd(entry.error)}` : ""}. Choose ${control} to try again.`;
  }
}

/** Both lines. @param {Parameters<typeof turnInterruptionOutcomeLine>[0]} entry @param {(at: string) => string} clock */
function turnInterruptionLines(entry, clock) {
  return [turnInterruptionHeadline(entry, clock), turnInterruptionOutcomeLine(entry, clock)];
}

/** "04:18 UTC" for an ISO time; "" when it is not one. */
function utcClock(at) {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? "" : `${date.toISOString().slice(11, 16)} UTC`;
}

/** A Stopped request's error after the crash-loop rule stopped resuming it, which its Continue control shows. */
function turnInterruptionLoopError(cause) {
  return `Stopped: ${causeTwicePhrase(cause)}. Choose Continue to try again.`;
}

export {
  TURN_INTERRUPTION_CAUSES,
  turnInterruptionHeadline,
  turnInterruptionLines,
  turnInterruptionLoopError,
  turnInterruptionOutcomeLine,
  utcClock
};
