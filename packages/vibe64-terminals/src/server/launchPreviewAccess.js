// Who may use one Preview, and what the Preview holds for the browsers that use it.
//
// The Preview's access token is handed to the editors that show it; its gate admits a request that carries it, in
// the address or the access cookie. The editor's Preview pane coming in with it on an HTTPS Preview also gets a held
// session: an id, kept in a cookie beside the access cookie, under which the Preview holds the app's HttpOnly
// cookies in place of that browser (launchPreviewHeldCookies.js). A window the pane opens gets in with a single-use
// ticket that carries the pane's held session (launchPreviewWindow.js), so the pane and the window are one app
// session, while another browser keeps its own. All of it lives in memory, keyed by the Preview (project, session
// and public origin), and outlives the proxy's restarts; the held cookies and tickets go when the Preview stops,
// and the token with its session.

import crypto from "node:crypto";

import { previewTokenHash } from "./launchPreviewHeaders.js";
import { createHeldCookieJar } from "./launchPreviewHeldCookies.js";

// A ticket lets the window the pane is opening in once, right away: the bridge asks for it as it opens the window
// and sends the window to it at once. One Preview holds few unused ones, and few held sessions, at a time: the
// oldest give way, so a caller that makes up session ids cannot fill this process's memory.
const PREVIEW_WINDOW_TICKET_LIFETIME_MS = 30_000;
const PREVIEW_WINDOW_TICKETS_MAX = 16;
const PREVIEW_HELD_SESSIONS_MAX = 64;

function randomId() {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * @param {{ projectScope?: string, publicOrigin?: string, sessionId?: string }} tokenScope what the token is bound to
 * @param {{ ticketLifetimeMs?: number }} [options]
 */
function createPreviewAccess(tokenScope, { ticketLifetimeMs = PREVIEW_WINDOW_TICKET_LIFETIME_MS } = {}) {
  const token = randomId();
  const tokenHash = Buffer.from(previewTokenHash(token, tokenScope), "hex");
  const jars = new Map();
  const tickets = new Map();

  /** Whether a presented token is this Preview's. */
  function admits(presented = "") {
    const hash = Buffer.from(previewTokenHash(presented, tokenScope), "hex");
    return Boolean(presented) && hash.length === tokenHash.length && crypto.timingSafeEqual(hash, tokenHash);
  }

  /** The app cookies held for a held session, made on first use. */
  function heldCookies(heldSession) {
    let jar = jars.get(heldSession);
    if (!jar) {
      jar = createHeldCookieJar();
      jars.set(heldSession, jar);
      if (jars.size > PREVIEW_HELD_SESSIONS_MAX) {
        jars.delete(jars.keys().next().value);
      }
    }
    return jar;
  }

  function issueWindowTicket(heldSession, nowMs = Date.now()) {
    for (const [ticket, entry] of tickets) {
      if (entry.expiresAt <= nowMs) {
        tickets.delete(ticket);
      }
    }
    const ticket = randomId();
    tickets.set(ticket, { expiresAt: nowMs + ticketLifetimeMs, heldSession });
    if (tickets.size > PREVIEW_WINDOW_TICKETS_MAX) {
      tickets.delete(tickets.keys().next().value);
    }
    return ticket;
  }

  /** Uses a ticket up, whatever comes of it: the held session it carries, or "" for one unknown, used or expired. */
  function redeemWindowTicket(ticket = "", nowMs = Date.now()) {
    const key = String(ticket || "");
    const entry = tickets.get(key);
    if (!entry) {
      return "";
    }
    tickets.delete(key);
    return entry.expiresAt > nowMs ? entry.heldSession : "";
  }

  /** The Preview stopped: the cookies it held and its tickets go; its token stays, so open Preview pages come back. */
  function forgetHeld() {
    jars.clear();
    tickets.clear();
  }

  return Object.freeze({
    admits,
    forgetHeld,
    heldCookies,
    issueWindowTicket,
    newHeldSession: randomId,
    redeemWindowTicket,
    token
  });
}

export {
  createPreviewAccess,
  PREVIEW_WINDOW_TICKET_LIFETIME_MS
};
