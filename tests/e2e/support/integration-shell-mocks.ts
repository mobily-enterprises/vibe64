import type { Page } from "@playwright/test";
import { directChatSessionId } from "./base-shell-data";
import { fulfillJson, routeApiEndpoint } from "./base-shell/http";

const owner = "integration-test-owner";

/**
 * Answers every read the studio shell makes around a strict integration-panel page, as a ready direct-chat session
 * with nothing else configured: no Learning, Colleague, AI accounts, AI tasks, approvals, work plan or usage
 * recording. A spec's catch-all route still reports any other request as unexpected.
 */
async function mockIntegrationShellReads(page: Page) {
  const session = `/vibe64/sessions/${directChatSessionId}`;
  for (const [endpoint, payload] of [
    ["/vibe64/settings", { ok: true, promptHints: { enabled: false } }],
    ["/vibe64/sessions/current", { ok: true, sessionId: directChatSessionId }],
    [`${session}/agent-session`, { ok: true }],
    [`${session}/presence`, { ok: true }],
    [`${session}/assistant-access`, { ok: true, available: true, canUse: true, ownerOnly: false }],
    [`${session}/message-suggestions`, { ok: true, suggestions: [], canManage: true }],
    [`${session}/work`, { ok: true, unsaved: false, operation: null, updateOperation: null }],
    [`${session}/updates/check`, { ok: true, updateAvailable: false, status: "up-to-date" }],
    [`${session}/renewal`, { ok: true, renewal: null, viewerScope: owner }],
    [`${session}/source-editor/stars`, { ok: true, files: [] }],
    [`${session}/work-plan`, { ok: true, sessionId: directChatSessionId, available: false, current: null, history: [] }],
    [`${session}/ai-tasks`, { ok: true, tasks: [], viewerId: owner }],
    [`${session}/main-chat-approvals`, { ok: true, sessionId: directChatSessionId, owner: true, practice: false,
      viewer: { id: owner, username: owner, displayName: owner }, ownerName: owner, entries: [] }],
    [`/vibe64/usage-recordings/sessions/${directChatSessionId}/current`, { recording: null, serverTime: new Date().toISOString() }],
    ["/vibe64/accounts/codex-providers", { ok: true, providers: [] }],
    ["/vibe64/accounts/ai-connections", { ok: true, connections: [] }],
    ["/vibe64/training/learning-mode", { ok: true, available: true, learningMode: null }],
    ["/vibe64/training/courses", { ok: true, courses: [] }],
    ["/vibe64/training/learning", { ok: true, available: false }],
    ["/vibe64/colleague", { ok: false, error: "Colleague is not part of this scenario." }]
  ] as const) {
    await routeApiEndpoint(page, endpoint, (route) => fulfillJson(route, payload));
  }
}

export { mockIntegrationShellReads };
