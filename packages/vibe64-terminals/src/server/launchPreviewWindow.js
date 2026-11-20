// A window the Preview pane opens: its ticket, and its way in.
//
// A Preview on a domain of its own is a cross-site frame of the editor, and the browser keeps a window at the
// Preview's own address apart from it: the window has none of the pane's cookies, so the Preview's gate would
// refuse it. The pane's bridge (launchPreviewBridgeScript.txt, window.open) therefore opens the window blank, asks
// the Preview for a ticket with the pane's own access, and sends the window to the window path with the ticket and
// the address it was opening. There the Preview swaps the ticket for the access cookie and the pane's held session,
// kept in the window's own cookies, and sends the window on. The app cookies the Preview holds for that session
// (launchPreviewHeldCookies.js) then make the pane and the window one app session. Only the pane is a held session
// (launchPreviewForwarding.js, startsHeldSession), so only it can ask for a ticket.

import {
  PREVIEW_WINDOW_DESTINATION_QUERY_PARAM,
  PREVIEW_WINDOW_TICKET_QUERY_PARAM
} from "../shared/launchPreviewProtocol.js";
import { previewHeldSessionCookie, previewTokenCookie, requestHeader } from "./launchPreviewHeaders.js";

const PREVIEW_WINDOW_REFUSED_MESSAGE =
  "This Preview window's ticket is missing, used, expired or not this page's. Open the window again from the Preview.";

function writeTicketJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Connection": "close",
    "Content-Length": Buffer.byteLength(body),
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(body);
}

/**
 * A ticket for a window the pane opens, carrying the pane's held session. Only a script of the pane's own pages
 * asks: a same-origin POST of a held session. A page of another site framing the Preview has no access to ask
 * with (the gate refused it before this), and a page in a tab of its own is no held session.
 * @param {import("node:http").IncomingMessage} request
 * @param {import("node:http").ServerResponse} response
 * @param {object} options
 * @param {ReturnType<typeof import("./launchPreviewAccess.js").createPreviewAccess>} options.access
 * @param {string} options.heldSession the asking page's held session, or ""
 */
function issuePreviewWindowTicket(request, response, { access, heldSession }) {
  const site = requestHeader(request, "sec-fetch-site").toLowerCase();
  if (!heldSession || String(request.method || "GET").toUpperCase() !== "POST" || (site && site !== "same-origin")) {
    writeTicketJson(response, 403, {
      code: "vibe64_preview_window_ticket_refused",
      error: "Only the Preview pane's own pages can ask for a window ticket.",
      ok: false
    });
    return;
  }
  writeTicketJson(response, 200, { ok: true, ticket: access.issueWindowTicket(heldSession) });
}

/**
 * Where a window is sent on to: a page of the Preview, or the address of another site it was opening (a sign-in
 * page, say). Anything else is refused.
 */
function previewWindowDestination(value, proxyOrigin) {
  try {
    const url = new URL(String(value || ""), proxyOrigin);
    return value && ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

/**
 * The window path: a window's own page load with a ticket gets the Preview's access and the held session the
 * ticket carries, whatever session its browser kept before, and goes on to its destination. The ticket is used up
 * by its first use, whatever comes of it. A ticket in a frame (a page of another site framing the Preview), one
 * used or expired, or one of another Preview is refused.
 * @param {import("node:http").IncomingMessage} request
 * @param {import("node:http").ServerResponse} response
 * @param {object} options
 * @param {ReturnType<typeof import("./launchPreviewAccess.js").createPreviewAccess>} options.access
 * @param {string} options.proxyOrigin
 * @param {URL} options.requestUrl
 */
function enterPreviewWindow(request, response, { access, proxyOrigin, requestUrl }) {
  const ticketSession = access.redeemWindowTicket(requestUrl.searchParams.get(PREVIEW_WINDOW_TICKET_QUERY_PARAM) || "");
  const destination = previewWindowDestination(requestUrl.searchParams.get(PREVIEW_WINDOW_DESTINATION_QUERY_PARAM), proxyOrigin);
  const windowPageLoad = String(request.method || "GET").toUpperCase() === "GET" &&
    requestHeader(request, "sec-fetch-dest").toLowerCase() === "document";
  if (!ticketSession || !destination || !windowPageLoad) {
    response.writeHead(403, {
      "Cache-Control": "no-store",
      "Connection": "close",
      "Content-Type": "text/plain; charset=utf-8"
    });
    response.end(PREVIEW_WINDOW_REFUSED_MESSAGE);
    return false;
  }
  response.writeHead(303, {
    "Cache-Control": "no-store",
    "Connection": "close",
    "Location": destination,
    // The window's address held the ticket; the page it goes on to, another site's maybe, is not told it.
    "Referrer-Policy": "no-referrer",
    "Set-Cookie": [
      previewTokenCookie(access.token, { proxyOrigin }),
      previewHeldSessionCookie(ticketSession, { proxyOrigin })
    ]
  });
  response.end();
  return true;
}

export {
  enterPreviewWindow,
  issuePreviewWindowTicket,
  PREVIEW_WINDOW_REFUSED_MESSAGE
};
