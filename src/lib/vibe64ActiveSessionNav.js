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

export {
  NO_ACTIVE_SESSION_NAV,
  VIBE64_ACTIVE_SESSION_NAV_KEY
};
