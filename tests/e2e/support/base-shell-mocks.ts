import type { Page } from "@playwright/test";
import { mockDirectChatSession as mockDirectChatSessionRoutes } from "./base-shell/codex-mocks";
import { mockProjectGateReady as mockProjectGateReadyRoutes } from "./base-shell/setup-mocks";
import { suppressAiOnboarding } from "./suppressAiOnboarding";

export { trackStudioApiRequests } from "./base-shell/http";
export {
  mockCurrentAppInspection,
  mockSessionHistoryArchives
} from "./base-shell/setup-mocks";

async function mockProjectGateReady(page: Page) {
  await suppressAiOnboarding(page);
  return mockProjectGateReadyRoutes(page);
}

async function mockDirectChatSession(page: Page) {
  await suppressAiOnboarding(page);
  return mockDirectChatSessionRoutes(page);
}

export { mockDirectChatSession, mockProjectGateReady };
