// What the dashboard shell provides to the navigation inside it.

/**
 * The active session's menu.
 * @typedef {{
 *   sessionId?: string,
 *   label?: string,
 *   visible?: boolean,
 *   tools?: object[],
 *   selectTool: (toolId: string) => boolean
 * }} ActiveSessionNav
 */

/** The active session's menu, or null while no session is open. */
const VIBE64_ACTIVE_SESSION_NAV_KEY = Symbol("vibe64.activeSessionNav");

/** Outside the dashboard shell there is no active session. */
const NO_ACTIVE_SESSION_NAV = Object.freeze({ value: null });

/** How many incoming changes wait for review, or null while unknown; the Incoming menu link shows it. */
const VIBE64_INCOMING_PENDING_COUNT_KEY = Symbol("vibe64.incoming.pendingCount");

/** Outside the dashboard shell no count is known. */
const NO_INCOMING_PENDING_COUNT = Object.freeze({ value: null });

export {
  NO_ACTIVE_SESSION_NAV,
  NO_INCOMING_PENDING_COUNT,
  VIBE64_ACTIVE_SESSION_NAV_KEY,
  VIBE64_INCOMING_PENDING_COUNT_KEY
};
