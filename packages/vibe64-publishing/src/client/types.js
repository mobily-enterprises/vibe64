/**
 * What the project dashboard tells the Publish page about the session it is open in. Outside a session the dashboard
 * passes an empty context: no session, no Save and no session work to refresh.
 * @typedef {object} PublishDashboardContext
 * @property {boolean} [active] False while the dashboard is hidden.
 * @property {string} [sessionId]
 * @property {() => Promise<unknown>} [requestSaveWork] Saves the session's work.
 * @property {() => Promise<unknown>} [refreshSessionWork] Reads the session's work again.
 */

export {};
