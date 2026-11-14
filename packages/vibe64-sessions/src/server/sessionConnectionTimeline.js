import { currentProjectRuntimeRoot, currentProjectVibe64User } from "@local/vibe64-core/server/projectRequestContext";
import { recordSessionTimelineEvent, timelineActor } from "@local/vibe64-core/server/sessionTimeline";

/** @typedef {import("./types.js").WatchConnection} WatchConnection */

// A tab whose connection to a session ended is remembered for a day, so its
// next watch of that session reads as a reconnect, with how long it was away.
const RECONNECT_WINDOW_MS = 24 * 60 * 60 * 1000;
const REMEMBERED_TABS = 1024;
const lostTabs = new Map();

function rememberLostTab(key, at) {
  lostTabs.delete(key);
  lostTabs.set(key, at);
  if (lostTabs.size > REMEMBERED_TABS) lostTabs.delete(lostTabs.keys().next().value);
}

/**
 * The session timeline of one browser connection's view of a session, inside
 * the watch action: "connected" (or "reconnected") when its first watch of the
 * session starts, and "disconnected" with the realtime reason (such as
 * "transport close" or "ping timeout"), or "left" while still connected, when
 * its last one ends. Returns what the watch's release runs.
 * @param {string} sessionId
 * @param {WatchConnection} connection
 */
function watchSessionConnection(sessionId, connection) {
  const projectRuntimeRoot = currentProjectRuntimeRoot();
  const user = timelineActor(currentProjectVibe64User());
  const view = `${projectRuntimeRoot}\n${sessionId}`;
  const tabKey = `${view}\n${connection.tab}`;
  const record = (event, fields = {}) => recordSessionTimelineEvent(sessionId, {
    kind: "connection",
    event,
    tab: connection.tab,
    user,
    ...fields
  }, { projectRuntimeRoot });
  const views = connection.sessionViews.get(view) || 0;
  connection.sessionViews.set(view, views + 1);
  if (views === 0) {
    const lostAt = connection.tab ? lostTabs.get(tabKey) : undefined;
    lostTabs.delete(tabKey);
    const offlineMs = lostAt === undefined ? -1 : Date.now() - lostAt;
    if (offlineMs >= 0 && offlineMs < RECONNECT_WINDOW_MS) record("reconnected", { offlineMs });
    else record("connected");
  }
  return () => {
    const remaining = (connection.sessionViews.get(view) || 1) - 1;
    if (remaining > 0) {
      connection.sessionViews.set(view, remaining);
      return;
    }
    connection.sessionViews.delete(view);
    const reason = connection.closedReason();
    if (!reason) {
      record("left");
      return;
    }
    if (connection.tab) rememberLostTab(tabKey, Date.now());
    record("disconnected", { reason });
  };
}

export { watchSessionConnection };
