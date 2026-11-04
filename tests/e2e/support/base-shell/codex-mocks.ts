import {
  currentAppPayload,
  directChatSessionId,
  directChatSessionPayload
} from "../base-shell-data";
import {
  fulfillJson,
  routeApiEndpoint
} from "./http";
import {
  mockProjectGateReady
} from "./setup-mocks";

async function mockDirectChatSession(page) {
  await mockProjectGateReady(page);
  await routeApiEndpoint(page, "/studio/current-app", async (route) => {
    await fulfillJson(route, currentAppPayload);
  });
  await routeApiEndpoint(page, "/vibe64/sessions", async (route) => {
    await fulfillJson(route, {
      creation: {
        canCreate: true,
        mode: "direct"
      },
      limits: {
        openSessionCount: 1
      },
      ok: true,
      sessions: [directChatSessionPayload]
    });
  });
  await routeApiEndpoint(page, `/vibe64/sessions/${directChatSessionId}`, async (route) => {
    await fulfillJson(route, directChatSessionPayload);
  });
  await routeApiEndpoint(page, `/vibe64/sessions/${directChatSessionId}/temporary-conversations`, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await fulfillJson(route, { ok: true, conversations: [] });
  });
  await routeApiEndpoint(page, `/vibe64/sessions/${directChatSessionId}/conversation-log`, async (route) => {
    await fulfillJson(route, {
      conversationLog: [],
      ok: true,
      pagination: {
        count: 0,
        hasMoreBefore: false,
        limit: 20,
        totalTurnCount: 0
      },
      sessionId: directChatSessionId
    });
  });
}

export {
  mockDirectChatSession
};
