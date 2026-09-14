import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Server } from "socket.io";
import {
  bootstrapPayload, currentAppPayload, directChatSessionPayload,
  readyProjectSelectionPayload, WORKSPACE_SLUG
} from "./base-shell-data";

type Handler = (response: ServerResponse, request: IncomingMessage) => void | Promise<void>;

export function json(response: ServerResponse, value: unknown, status = 200) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

// Production client and real HTTP/Socket.IO transports. Provider responses are
// controlled here so failures never touch a real assistant or user project.
export async function assistantStatusServer() {
  const session = structuredClone(directChatSessionPayload);
  session.sessionName = "Status recovery";
  session.agentSession.turn = { active: true, id: "turn-status", state: "active" } as typeof session.agentSession.turn;
  const conversation = {
    turnId: "turn-status",
    user: { role: "user", text: "Keep working while the connection recovers.", at: new Date().toISOString() },
    commentary: [{ role: "assistant", text: "I am working on the project.", at: new Date().toISOString() }]
  };
  const state = {
    checks: [] as Handler[],
    checkCount: 0,
    checkTimes: [] as number[],
    connectionAttempts: 0,
    rejectConnections: false,
    detailCount: 0,
    detailHandler: null as Handler | null,
    messages: [] as Record<string, unknown>[],
    interrupts: 0,
    requests: [] as string[],
    unexpectedRequests: [] as string[],
    session
  };
  const http = createServer(async (request, response) => {
    try {
      const url = new URL(request.url!, "http://127.0.0.1");
      const route = url.pathname.replace(/^\/api(?:\/app\/[^/]+)?/u, "");
      if (!url.pathname.startsWith("/api/")) {
        const asset = url.pathname.startsWith("/assets/") ? url.pathname.slice(1) : "index.html";
        const file = await readFile(path.join(process.env.VIBE64_STATUS_E2E_DIST || "dist", asset));
        const mime = asset.endsWith(".js") ? "text/javascript" : asset.endsWith(".css") ? "text/css" : asset.endsWith(".svg") ? "image/svg+xml" : "text/html";
        response.writeHead(200, { "content-type": mime });
        response.end(file);
        return;
      }
      const requestKey = `${request.method} ${route}`;
      const sessionRoute = `/vibe64/sessions/${session.sessionId}`;
      state.requests.push(requestKey);
      if (requestKey === `POST ${sessionRoute}/agent-session`) {
        state.checkCount += 1;
        state.checkTimes.push(Date.now());
        const handler = state.checks.shift();
        if (handler) await handler(response, request);
        else json(response, { ok: true, ...session.agentSession });
        return;
      }
      if (requestKey === `GET ${sessionRoute}`) {
        state.detailCount += 1;
        if (state.detailHandler) await state.detailHandler(response, request);
        else json(response, session);
        return;
      }
      if (requestKey === `POST ${sessionRoute}/agent-message`) {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks).toString());
        state.messages.push(body);
        json(response, { ok: true, delivered: true, messageId: body.messageId });
        return;
      }
      if (requestKey === `POST ${sessionRoute}/agent-turn/interrupt`) {
        state.interrupts += 1;
        session.agentSession.turn.active = false;
        publishTurn();
        json(response, { ok: true, interrupted: true });
        return;
      }
      if (requestKey === "POST /vibe64/project-runtime/open") {
        json(response, { ok: true, runtime: { open: true, reason: "status-test" } });
        return;
      }
      if (requestKey === `POST ${sessionRoute}/updates/check`) {
        json(response, { ok: true, relationship: "current", ahead: 0, behind: 0, updateAvailable: false, incomingVersions: [] });
        return;
      }
      if (requestKey === `POST ${sessionRoute}/presence`) {
        json(response, { ok: true, status: "unavailable" });
        return;
      }
      if (requestKey === "PUT /vibe64/sessions/current") {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks).toString());
        if (body.sessionId !== session.sessionId) {
          state.unexpectedRequests.push(`${requestKey}: ${JSON.stringify(body)}`);
          json(response, { ok: false, error: "Unknown status-test session." }, 404);
        } else {
          json(response, { ok: true, sessionId: session.sessionId });
        }
        return;
      }
      let result: unknown;
      if (route === "/auth/state") result = { ok: true, authenticated: true, setupRequired: false, user: { email: "owner@example.com", role: "owner" } };
      else if (route === "/session") result = { ok: true, csrfToken: "status-e2e", authenticated: true };
      else if (route === "/bootstrap") result = bootstrapPayload;
      else if (route === "/vibe64/projects") result = readyProjectSelectionPayload;
      else if (route === "/studio/current-app") result = currentAppPayload;
      else if (route === "/vibe64/env") result = { ok: true, env: { environment: "dev", records: [], unavailable: null } };
      else if (route === "/vibe64/sessions") result = { ok: true, sessions: [session], limits: { openSessionCount: 1 }, creation: { canCreate: true, mode: "direct" } };
      else if (route === "/vibe64/sessions/current") result = { ok: true, sessionId: session.sessionId };
      else if (route === `${sessionRoute}/conversation-log`) result = { ok: true, sessionId: session.sessionId, conversationLog: [conversation], pagination: { count: 1, totalTurnCount: 1, hasMoreBefore: false, limit: 20 } };
      else if (route === `${sessionRoute}/assistant-access`) result = { ok: true, available: true, canUse: true, ownerOnly: false };
      else if (route === `${sessionRoute}/message-suggestions`) result = { ok: true, suggestions: [], canManage: true };
      else if (route === `${sessionRoute}/work`) result = { ok: true, unsaved: false, operation: null, updateOperation: null };
      else if (route === `${sessionRoute}/renewal`) result = { ok: true, renewal: null, viewerScope: "status-test-owner" };
      else if (route === `${sessionRoute}/source-editor/stars`) result = { ok: true, files: [] };
      else if (route === "/vibe64/settings") result = { ok: true, promptHints: { enabled: false } };
      else if (route === "/vibe64/accounts") result = { ok: true, ready: true, accounts: [] };
      if (request.method !== "GET" || result === undefined) {
        state.unexpectedRequests.push(requestKey);
        json(response, { ok: false, error: `Unexpected status fixture request: ${requestKey}` }, 404);
        return;
      }
      json(response, result);
    } catch (error) {
      if (!response.headersSent) json(response, { ok: false, error: String(error) }, 500);
      else response.destroy();
    }
  });
  const io = new Server(http, { path: "/socket.io" });
  io.use((_socket, next) => {
    state.connectionAttempts += 1;
    next(state.rejectConnections ? new Error("Temporary authentication lookup failure") : undefined);
  });
  function publishTurn() {
    session.revision += 1;
    session.manifest.revision = session.revision;
    io.emit("vibe64.session.changed", {
      projectSlug: WORKSPACE_SLUG,
      sessionId: session.sessionId,
      revision: session.revision,
      reason: session.agentSession.turn.active ? "codex-app-server-turn-active" : "codex-app-server-turn-idle",
      agentSession: session.agentSession
    });
  }
  http.listen(0, "127.0.0.1");
  await once(http, "listening");
  return {
    state,
    url: `http://127.0.0.1:${(http.address() as { port: number }).port}`,
    publishTurn,
    progress(text: string) {
      conversation.commentary.push({ role: "assistant", text, at: new Date().toISOString() });
      io.emit("vibe64.session.changed", {
        projectSlug: WORKSPACE_SLUG, sessionId: session.sessionId,
        reason: "codex-app-server-commentary",
        conversationLogPatch: { type: "upsert-turn", turn: conversation }
      });
    },
    disconnect() {
      for (const socket of io.of("/").sockets.values()) socket.conn.close();
    },
    forceDisconnect() {
      for (const socket of io.of("/").sockets.values()) socket.disconnect(true);
    },
    async close() {
      const closed = new Promise<void>((resolve) => io.close(() => resolve()));
      http.closeAllConnections();
      await closed;
    }
  };
}
