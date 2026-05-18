import {
  codexIssueCreatedPayload,
  codexIssueDraftedPayload,
  codexPlanPromptPayload,
  codexPromptSessionId,
  codexPromptSessionPayload,
  codexPromptStepDefinitions,
  codexThreadCommand,
  codexThreadId,
  codexThreadProbe,
  currentAppPayload,
  secondCodexPromptSessionPayload
} from "../base-shell-data";
import { fulfillJson } from "./http";
import {
  mockProtectedRouteReady,
  mockTargetScripts
} from "./setup-mocks";

function mockCodexThreadIdForSession(sessionId: string) {
  const suffix = String(sessionId || "")
    .replace(/\D/gu, "")
    .padEnd(12, "0")
    .slice(-12);
  return `019e1575-2458-7b93-bf9d-${suffix}`;
}

async function mockCodexTerminalWebSocket(page, {
  initialOutputBySessionId,
  terminalInputs
}: {
  initialOutputBySessionId: Record<string, string>;
  terminalInputs: Record<string, string[]> | string[];
}) {
  await page.exposeFunction("__recordStudioCodexTerminalInput", ({ sessionId, data }: {
    data: string;
    sessionId: string;
  }) => {
    if (Array.isArray(terminalInputs)) {
      terminalInputs.push(String(data || ""));
      return;
    }
    const terminalInputMap = terminalInputs as Record<string, string[]>;
    terminalInputMap[sessionId] ||= [];
    terminalInputMap[sessionId].push(String(data || ""));
  });
  await page.addInitScript((options) => {
    const inputsBySessionId: Record<string, string[]> = {};
    const socketsBySessionId: Record<string, any[]> = {};
    const studioWindow = window as unknown as {
      __studioFailCodexTerminal: (input: { error?: string; sessionId: string }) => void;
      __recordStudioCodexTerminalInput: (input: { data: string; sessionId: string }) => void;
      __studioPushCodexTerminalOutput: (input: { output: string; sessionId: string }) => void;
      WebSocket: typeof WebSocket;
    };
    function sessionThreadId(sessionId) {
      const suffix = String(sessionId || "")
        .replace(/\D/gu, "")
        .padEnd(12, "0")
        .slice(-12);
      return `019e1575-2458-7b93-bf9d-${suffix}`;
    }
    class MockStudioWebSocket extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      readyState: number;
      sessionId: string;
      terminalSessionId: string;
      url: string;

      constructor(url) {
        super();
        this.url = String(url || "");
        this.readyState = MockStudioWebSocket.CONNECTING;
        const match = /\/sessions\/([^/]+)\/codex-terminal\/([^/]+)\/ws/u.exec(new URL(this.url).pathname);
        this.sessionId = match ? decodeURIComponent(match[1]) : "";
        this.terminalSessionId = match ? decodeURIComponent(match[2]) : "";
        inputsBySessionId[this.sessionId] ||= [];
        socketsBySessionId[this.sessionId] ||= [];
        socketsBySessionId[this.sessionId].push(this);
        window.setTimeout(() => {
          this.readyState = MockStudioWebSocket.OPEN;
          this.dispatchEvent(new Event("open"));
          this.__emit({
            type: "snapshot",
            session: {
              ok: true,
              id: this.terminalSessionId,
              status: "running",
              commandPreview: "codex",
              output: options.initialOutputBySessionId[this.sessionId] || "Codex ready.",
              needsThreadCapture: true,
              threadProbe: options.codexThreadProbe
            }
          });
        }, 0);
      }

      send(rawMessage) {
        const message = JSON.parse(String(rawMessage || "{}"));
        if (message.type !== "input") {
          return;
        }
        const data = String(message.data || "");
        inputsBySessionId[this.sessionId].push(data);
        studioWindow.__recordStudioCodexTerminalInput({
          data,
          sessionId: this.sessionId
        });
        if (data === "\r" && inputsBySessionId[this.sessionId].includes(options.codexThreadCommand)) {
          this.__emit({
            chunk: `\n${options.codexThreadProbe}\n${options.codexThreadIdBySessionId[this.sessionId] || sessionThreadId(this.sessionId)}\n`,
            type: "output"
          });
        }
      }

      close() {
        this.readyState = MockStudioWebSocket.CLOSED;
        socketsBySessionId[this.sessionId] = (socketsBySessionId[this.sessionId] || [])
          .filter((socket) => socket !== this);
        this.dispatchEvent(new CloseEvent("close"));
      }

      __emit(message) {
        this.dispatchEvent(new MessageEvent("message", {
          data: JSON.stringify(message)
        }));
      }
    }
    studioWindow.__studioPushCodexTerminalOutput = ({ sessionId, output }) => {
      for (const socket of socketsBySessionId[sessionId] || []) {
        socket.__emit({
          chunk: String(output || ""),
          type: "output"
        });
      }
    };
    studioWindow.__studioFailCodexTerminal = ({ sessionId, error }) => {
      for (const socket of [...socketsBySessionId[sessionId] || []]) {
        socket.__emit({
          error: String(error || "Terminal session not found."),
          type: "error"
        });
        socket.close();
      }
    };
    studioWindow.WebSocket = MockStudioWebSocket as unknown as typeof WebSocket;
  }, {
    codexThreadCommand,
    codexThreadIdBySessionId: {
      [codexPromptSessionId]: codexThreadId
    },
    codexThreadProbe,
    initialOutputBySessionId
  });
}

async function mockCodexPromptHandoffRoute(page, sessionId: string) {
  await page.route(`**/api/ai-studio/sessions/${sessionId}/codex-prompt-handoff`, async (route) => {
    const payload = route.request().postDataJSON();
    await fulfillJson(route, {
      codexPromptHandoffOutputStart: Number(payload.outputStart || 0),
      codexPromptHandoffSignature: payload.signature || "",
      ok: true
    });
  });
}

async function mockCodexPromptSession(page, { stepPayloads = [], terminalInputs = [] } = {}) {
  await mockProtectedRouteReady(page);
  let terminalOutput = "Codex ready.";
  let issueTitle = codexIssueDraftedPayload.issueTitle;
  let issueText = codexIssueDraftedPayload.issueText;
  let stepRequestCount = 0;
  await mockCodexTerminalWebSocket(page, {
    initialOutputBySessionId: {
      [codexPromptSessionId]: terminalOutput
    },
    terminalInputs
  });
  await page.route("**/api/studio/current-app", async (route) => {
    await fulfillJson(route, currentAppPayload);
  });
  await page.route("**/api/ai-studio/sessions**", async (route) => {
    await fulfillJson(route, {
      limits: {
        maxOpenSessions: 3,
        openSessionCount: 1
      },
      ok: true,
      sessions: [codexPromptSessionPayload],
      stepDefinitions: codexPromptStepDefinitions
    });
  });
  await mockTargetScripts(page);
  await page.route(`**/api/ai-studio/sessions/${codexPromptSessionId}`, async (route) => {
    await fulfillJson(route, codexPromptSessionPayload);
  });
  await page.route(`**/api/ai-studio/sessions/${codexPromptSessionId}/step`, async (route) => {
    const payload = route.request().postDataJSON();
    stepPayloads.push(payload);
    stepRequestCount += 1;
    if (stepRequestCount === 1) {
      issueTitle = String(payload.issueTitle || "");
      issueText = String(payload.issue || "");
    }
    const draftedPayload = {
      ...codexIssueDraftedPayload,
      issueTitle,
      issueText
    };
    const createdPayload = {
      ...codexIssueCreatedPayload,
      issueTitle,
      issueText
    };
    const planPromptPayload = {
      ...codexPlanPromptPayload,
      issueTitle,
      issueText
    };
    await fulfillJson(
      route,
      stepRequestCount === 1
        ? draftedPayload
        : stepRequestCount === 2 ? createdPayload : planPromptPayload
    );
  });
  await page.route(`**/api/ai-studio/sessions/${codexPromptSessionId}/codex-terminal`, async (route) => {
    await fulfillJson(route, {
      ok: true,
      id: "term-1",
      status: "running",
      commandPreview: "codex",
      output: terminalOutput,
      needsThreadCapture: true,
      threadProbe: codexThreadProbe
    });
  });
  await page.route(`**/api/ai-studio/sessions/${codexPromptSessionId}/codex-thread`, async (route) => {
    await fulfillJson(route, {
      codexThreadId: route.request().postDataJSON().threadId,
      ok: true
    });
  });
  await mockCodexPromptHandoffRoute(page, codexPromptSessionId);
  return {
    async setTerminalOutput(output) {
      terminalOutput = String(output || "");
      await page.evaluate(({ output: nextOutput, sessionId }) => {
        (window as unknown as {
          __studioPushCodexTerminalOutput: (input: { output: string; sessionId: string }) => void;
        }).__studioPushCodexTerminalOutput({
          output: nextOutput,
          sessionId
        });
      }, {
        output: terminalOutput,
        sessionId: codexPromptSessionId
      });
    },
    stepPayloads,
    terminalInputs
  };
}

function isOpenMockSession(session) {
  return !["abandoned", "finished"].includes(String(session.status || ""));
}

async function mockCodexPromptSessions(page, sessionPayloads) {
  await mockProtectedRouteReady(page);
  let visibleSessionPayloads = [...sessionPayloads];
  const terminalStarts = Object.fromEntries(sessionPayloads.map((session) => [session.sessionId, 0]));
  const terminalDeletes = Object.fromEntries(sessionPayloads.map((session) => [session.sessionId, 0]));
  const terminalInputs = Object.fromEntries(sessionPayloads.map((session) => [session.sessionId, []])) as Record<string, string[]>;
  const payloadsBySessionId = Object.fromEntries(sessionPayloads.map((session) => [session.sessionId, session]));
  await mockCodexTerminalWebSocket(page, {
    initialOutputBySessionId: Object.fromEntries(sessionPayloads.map((session) => [
      session.sessionId,
      `Codex ready for ${session.sessionId}.`
    ])),
    terminalInputs
  });

  await page.route("**/api/studio/current-app", async (route) => {
    await fulfillJson(route, currentAppPayload);
  });
  await page.route("**/api/ai-studio/sessions**", async (route) => {
    await fulfillJson(route, {
      limits: {
        maxOpenSessions: 3,
        openSessionCount: visibleSessionPayloads.filter(isOpenMockSession).length
      },
      ok: true,
      sessions: visibleSessionPayloads,
      stepDefinitions: codexPromptStepDefinitions
    });
  });
  await mockTargetScripts(page);

  for (const sessionId of Object.keys(payloadsBySessionId)) {
    await page.route(`**/api/ai-studio/sessions/${sessionId}`, async (route) => {
      await fulfillJson(route, payloadsBySessionId[sessionId]);
    });
    await page.route(`**/api/ai-studio/sessions/${sessionId}/abandon`, async (route) => {
      terminalDeletes[sessionId] += 1;
      payloadsBySessionId[sessionId] = {
        ...payloadsBySessionId[sessionId],
        codex: null,
        currentStep: "",
        status: "abandoned"
      };
      visibleSessionPayloads = visibleSessionPayloads.filter((session) => session.sessionId !== sessionId);
      await fulfillJson(route, payloadsBySessionId[sessionId]);
    });
    await page.route(`**/api/ai-studio/sessions/${sessionId}/codex-terminal`, async (route) => {
      terminalStarts[sessionId] += 1;
      await fulfillJson(route, {
        ok: true,
        id: `term-${sessionId}`,
        status: "running",
        commandPreview: "codex",
        output: `Codex ready for ${sessionId}.`,
        needsThreadCapture: true,
        threadProbe: codexThreadProbe
      });
    });
    await page.route(`**/api/ai-studio/sessions/${sessionId}/codex-thread`, async (route) => {
      await fulfillJson(route, {
        codexThreadId: route.request().postDataJSON().threadId,
        ok: true
      });
    });
    await mockCodexPromptHandoffRoute(page, sessionId);
    await page.route(
      `**/api/ai-studio/sessions/${sessionId}/codex-terminal/term-${sessionId}`,
      async (route) => {
        if (route.request().method() === "DELETE") {
          terminalDeletes[sessionId] += 1;
          await fulfillJson(route, {
            closed: true,
            ok: true
          });
          return;
        }
        await route.fulfill({
          contentType: "application/json",
          status: 410,
          body: JSON.stringify({
            ok: false,
            error: "HTTP terminal read fallback is not available in tests."
          })
        });
      }
    );
  }

  return {
    terminalDeletes,
    terminalInputs,
    terminalStarts
  };
}

async function mockTwoCodexPromptSessions(page) {
  return mockCodexPromptSessions(page, [
    codexPromptSessionPayload,
    secondCodexPromptSessionPayload
  ]);
}

export {
  isOpenMockSession,
  mockCodexPromptHandoffRoute,
  mockCodexPromptSession,
  mockCodexPromptSessions,
  mockCodexTerminalWebSocket,
  mockCodexThreadIdForSession,
  mockTwoCodexPromptSessions
};
