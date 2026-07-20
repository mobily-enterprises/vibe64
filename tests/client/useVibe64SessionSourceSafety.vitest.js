import { effectScope, nextTick, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const httpMocks = vi.hoisted(() => ({
  request: vi.fn()
}));

vi.mock("@jskit-ai/users-web/client/lib/httpClient", () => ({
  getUsersWebHttpClient: () => ({
    request: httpMocks.request
  })
}));

import {
  useVibe64SessionSourceSafety
} from "../../src/composables/useVibe64SessionSourceSafety.js";

describe("useVibe64SessionSourceSafety", () => {
  beforeEach(() => {
    httpMocks.request.mockReset();
  });

  it("polls independently of workflow state and sends a normal assistant prompt", async () => {
    httpMocks.request.mockImplementation(async (requestPath, options = {}) => {
      if (String(requestPath).endsWith("/source-safety")) {
        return {
          available: true,
          changedFileCount: 4,
          hasUncommittedChanges: true,
          hasUnpushedCommits: true,
          ok: true,
          repositoryMode: "managed_git",
          requiresPush: true,
          sessionId: "session-1",
          severity: 64,
          unpushedCommitCount: 2,
          unsafe: true
        };
      }
      if (String(requestPath).endsWith("/agent-message") && options.method === "POST") {
        return {
          accepted: true,
          ok: true
        };
      }
      throw new Error(`Unexpected request: ${requestPath}`);
    });

    const sessions = ref([
      {
        sessionId: "session-1"
      }
    ]);
    const scope = effectScope();
    let sourceSafety;
    scope.run(() => {
      sourceSafety = useVibe64SessionSourceSafety({
        pollIntervalMs: 0,
        sessions,
        sessionsApiPath: ref("/api/app/project/example/vibe64/sessions")
      });
    });

    await vi.waitFor(() => {
      expect(sourceSafety.statusForSession("session-1").initialized).toBe(true);
    });
    const status = sourceSafety.statusForSession("session-1");
    expect(status.unsafe).toBe(true);
    expect(status.requiresPush).toBe(true);

    expect(await sourceSafety.promptSession("session-1")).toBe(true);
    await nextTick();

    expect(httpMocks.request).toHaveBeenCalledTimes(2);
    const [promptPath, promptOptions] = httpMocks.request.mock.calls[1];
    expect(promptPath).toBe("/api/app/project/example/vibe64/sessions/session-1/agent-message");
    expect(promptOptions.method).toBe("POST");
    expect(promptOptions.body.displayFields.conversationRequest).toBe("Commit and push all current session work to origin/main.");
    expect(promptOptions.body.message).toContain("independent source-safety request");
    expect(promptOptions.body.message).toContain("straightforward save");
    expect(promptOptions.body.message).toContain("HEAD:refs/heads/main");
    expect(promptOptions.body.message).toContain("Only ever push to origin/main");
    expect(promptOptions.body.message).toContain("vibe64.system.json");
    expect(promptOptions.body.message).not.toContain("secret");
    expect(promptOptions.body.message).not.toContain("ownership");
    expect(promptOptions.body.message).not.toContain("audit the");
    expect(promptOptions.body).not.toHaveProperty("actionId");
    expect(promptOptions.body).not.toHaveProperty("intentId");

    scope.stop();
  });
});
