import { NEED_HELP_STILL_OPEN_MS, needHelpState, readNeedHelpFlag } from "@local/vibe64-terminals/shared/needHelp";

// How a session shows its Need help (@local/vibe64-terminals/shared/needHelp): on its session tab, in its header and in
// the dialog where the person answers, raises or clears it.

/** The session's Need help, from the record its list or its page holds, or null. @param {object | null | undefined} session */
function vibe64SessionNeedHelp(session) {
  return readNeedHelpFlag(session?.metadata || null);
}

/**
 * What the session's header and tab say of its Need help at `now`: its label, colour and the line that explains it, or
 * null without one. Once its newest request has waited NEED_HELP_STILL_OPEN_MS unanswered, it says so.
 * @param {import("@local/vibe64-terminals/shared/needHelp").NeedHelpFlag | null} flag
 * @param {number} now
 */
function vibe64NeedHelpPresentation(flag, now) {
  if (!flag) return null;
  const state = needHelpState(flag, now);
  const minutes = Math.floor(state.waitingMs / 60_000);
  if (state.answered) {
    return { label: "Need help · answered", color: "secondary", stillOpen: false,
      title: "Need help is answered. Clear it once it's resolved." };
  }
  if (state.stillOpen) {
    return { label: "Need help · no answer yet", color: "error", stillOpen: true,
      title: `Still open: nobody has answered this request for ${minutes} minutes. Open it to answer, or to add what you know.` };
  }
  return { label: "Need help", color: "warning", stillOpen: false,
    title: "This session asked for help with something it can't fix itself. Open it to read and answer." };
}

export { NEED_HELP_STILL_OPEN_MS, vibe64NeedHelpPresentation, vibe64SessionNeedHelp };
