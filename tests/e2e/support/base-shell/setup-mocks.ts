import {
  abandonedArchiveSession,
  bootstrapPayload,
  blockedAppSetupPayload,
  blockedBootstrapPayload,
  blockedTargetAppPayload,
  completedArchiveSession,
  currentAppPayload,
  readyAccountsPayload,
  readyAppSetupPayload,
  readyBootstrapPayload,
  readyProjectConfigPayload,
  readyProjectTypePayload,
  readyTargetAppPayload,
  targetScriptsPayload
} from "../base-shell-data";
import {
  fulfillJson,
  fulfillSse,
  setupReadinessPayload
} from "./http";

async function mockProjectGateReady(page) {
  await page.route("**/api/bootstrap", async (route) => {
    await fulfillJson(route, bootstrapPayload);
  });
  await page.route("**/api/studio/current-app", async (route) => {
    await fulfillJson(route, currentAppPayload);
  });
  await page.route("**/api/vibe64/project-type", async (route) => {
    await fulfillJson(route, readyProjectTypePayload);
  });
  await page.route("**/api/vibe64/project-config", async (route) => {
    await fulfillJson(route, readyProjectConfigPayload);
  });
  await page.route("**/api/vibe64/accounts", async (route) => {
    await fulfillJson(route, readyAccountsPayload);
  });
}

async function mockSetupReadiness(page, payload) {
  await page.route("**/api/studio/current-app/setup-readiness", async (route) => {
    await fulfillJson(route, payload);
  });
  await page.route("**/api/studio/current-app/setup-readiness/stream", async (route) => {
    await fulfillSse(route, payload, "stages");
  });
}

async function mockSetupGateReady(page) {
  await mockSetupReadiness(page, setupReadinessPayload({
    stages: [
      readyBootstrapPayload,
      readyAccountsPayload,
      readyTargetAppPayload,
      readyAppSetupPayload
    ]
  }));
  await page.route("**/api/studio/studio-setup", async (route) => {
    await fulfillJson(route, readyBootstrapPayload);
  });
  await page.route("**/api/studio/adapter-setup", async (route) => {
    await fulfillJson(route, readyTargetAppPayload);
  });
  await page.route("**/api/studio/project-setup", async (route) => {
    await fulfillJson(route, readyAppSetupPayload);
  });
}

async function mockProtectedRouteReady(page) {
  await mockProjectGateReady(page);
  await mockSetupGateReady(page);
}

async function mockBootstrapBlocked(page) {
  await mockProjectGateReady(page);
  await mockSetupReadiness(page, setupReadinessPayload({
    currentStage: {
      id: "studio-setup",
      label: "Studio Setup"
    },
    message: "Studio Setup is not ready.",
    ready: false,
    stages: [
      blockedBootstrapPayload,
      readyAccountsPayload,
      readyTargetAppPayload,
      readyAppSetupPayload
    ]
  }));
  await page.route("**/api/studio/studio-setup", async (route) => {
    await fulfillJson(route, blockedBootstrapPayload);
  });
  await page.route("**/api/studio/studio-setup/stream", async (route) => {
    await fulfillSse(route, blockedBootstrapPayload);
  });
}

async function mockTargetAppBlocked(page) {
  await mockProjectGateReady(page);
  await page.route("**/api/studio/studio-setup", async (route) => {
    await fulfillJson(route, readyBootstrapPayload);
  });
  await page.route("**/api/studio/studio-setup/stream", async (route) => {
    await fulfillSse(route, readyBootstrapPayload);
  });
  await page.route("**/api/studio/adapter-setup", async (route) => {
    await fulfillJson(route, blockedTargetAppPayload);
  });
  await page.route("**/api/studio/adapter-setup/stream", async (route) => {
    await fulfillSse(route, blockedTargetAppPayload);
  });
}

async function mockStudioReady(page) {
  await mockProjectGateReady(page);
  await page.route("**/api/studio/studio-setup", async (route) => {
    await fulfillJson(route, readyBootstrapPayload);
  });
  await page.route("**/api/studio/studio-setup/stream", async (route) => {
    await fulfillSse(route, readyBootstrapPayload);
  });
  await page.route("**/api/studio/adapter-setup", async (route) => {
    await fulfillJson(route, readyTargetAppPayload);
  });
  await page.route("**/api/studio/adapter-setup/stream", async (route) => {
    await fulfillSse(route, readyTargetAppPayload);
  });
  await page.route("**/api/studio/project-setup/stream", async (route) => {
    await fulfillSse(route, readyAppSetupPayload, "stages");
  });
  await page.route("**/api/studio/project-setup", async (route) => {
    await fulfillJson(route, readyAppSetupPayload);
  });
  await mockCurrentAppInspection(page);
}

async function mockCurrentAppInspection(page) {
  await mockProtectedRouteReady(page);
  await page.route("**/api/studio/current-app", async (route) => {
    await fulfillJson(route, currentAppPayload);
  });
  await page.route("**/api/vibe64/sessions**", async (route) => {
    await fulfillJson(route, {
      limits: {
        maxOpenSessions: 5,
        openSessionCount: 0
      },
      ok: true,
      sessions: [],
      stepDefinitions: []
    });
  });
  await mockTargetScripts(page);
}

async function mockTargetScripts(page, {
  terminalInputs = [],
  terminalStarts = []
}: {
  terminalInputs?: string[];
  terminalStarts?: string[];
} = {}) {
  await mockProtectedRouteReady(page);
  let currentPayload = JSON.parse(JSON.stringify(targetScriptsPayload));

  await page.exposeFunction("__recordStudioTargetScriptTerminalInput", ({ data }: { data: string }) => {
    terminalInputs.push(String(data || ""));
  });
  await page.addInitScript((options) => {
    const studioWindow = window as unknown as {
      __recordStudioTargetScriptTerminalInput: (input: { data: string }) => void;
      WebSocket: typeof WebSocket;
    };
    const OriginalWebSocket = studioWindow.WebSocket;

    class MockStudioWebSocket extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      readyState: number;
      terminalSessionId: string;
      url: string;

      constructor(url) {
        super();
        this.url = String(url || "");
        const pathname = new URL(this.url).pathname;
        const match = /\/target-script-terminal\/([^/]+)\/ws/u.exec(pathname);
        if (!match) {
          return new OriginalWebSocket(url);
        }
        this.readyState = MockStudioWebSocket.CONNECTING;
        this.terminalSessionId = decodeURIComponent(match[1]);
        window.setTimeout(() => {
          const scriptId = this.terminalSessionId.replace(/^target-term-/u, "");
          this.readyState = MockStudioWebSocket.OPEN;
          this.dispatchEvent(new Event("open"));
          this.__emit({
            type: "snapshot",
            session: {
              ok: true,
              id: this.terminalSessionId,
              status: "running",
              commandPreview: options.commandByScriptId[scriptId] || scriptId,
              output: `Started ${this.terminalSessionId}.`
            }
          });
        }, 0);
      }

      send(rawMessage) {
        const message = JSON.parse(String(rawMessage || "{}"));
        if (message.type === "input") {
          studioWindow.__recordStudioTargetScriptTerminalInput({
            data: String(message.data || "")
          });
        }
      }

      close() {
        this.readyState = MockStudioWebSocket.CLOSED;
        this.dispatchEvent(new CloseEvent("close"));
      }

      __emit(message) {
        this.dispatchEvent(new MessageEvent("message", {
          data: JSON.stringify(message)
        }));
      }
    }
    studioWindow.WebSocket = MockStudioWebSocket as unknown as typeof WebSocket;
  }, {
    commandByScriptId: Object.fromEntries(targetScriptsPayload.scripts.map((script) => [script.id, script.command]))
  });

  function applyStars(scriptIds: string[]) {
    const stars = new Set(scriptIds);
    currentPayload = {
      ...currentPayload,
      config: {
        exists: true,
        path: ".vibe64/config/starred_scripts"
      },
      starredScriptIds: scriptIds,
      scripts: currentPayload.scripts.map((script) => ({
        ...script,
        starred: stars.has(script.id)
      }))
    };
  }

  await page.route("**/api/studio/current-app/target-scripts**", async (route) => {
    await fulfillJson(route, currentPayload);
  });
  await page.route("**/api/studio/current-app/target-scripts/starred**", async (route) => {
    if (route.request().method() === "DELETE") {
      currentPayload = JSON.parse(JSON.stringify(targetScriptsPayload));
      await fulfillJson(route, currentPayload);
      return;
    }
    applyStars(route.request().postDataJSON().scriptIds || []);
    await fulfillJson(route, currentPayload);
  });
  await page.route("**/api/studio/current-app/target-script-terminal", async (route) => {
    const scriptId = String(route.request().postDataJSON().scriptId || "");
    const script = currentPayload.scripts.find((item) => item.id === scriptId) || {};
    terminalStarts.push(scriptId);
    await fulfillJson(route, {
      ok: true,
      id: `target-term-${scriptId}`,
      status: "running",
      commandPreview: script.command || scriptId,
      output: ""
    });
  });
  await page.route("**/api/studio/current-app/target-script-terminal/*", async (route) => {
    await fulfillJson(route, {
      closed: true,
      ok: true
    });
  });
}

async function mockSessionHistoryArchives(page, archiveRequests = []) {
  await mockProtectedRouteReady(page);
  await page.route("**/api/studio/current-app", async (route) => {
    await fulfillJson(route, currentAppPayload);
  });
  await page.route("**/api/vibe64/sessions**", async (route) => {
    const url = new URL(route.request().url());
    archiveRequests.push(`${url.pathname}${url.search}`);
    await fulfillJson(route, {
      limits: {
        maxOpenSessions: 5,
        openSessionCount: 0
      },
      ok: true,
      sessions: [completedArchiveSession, abandonedArchiveSession],
      stepDefinitions: []
    });
  });
  await mockTargetScripts(page);
}

async function mockAppSetupBlocked(page) {
  await mockProjectGateReady(page);
  await mockSetupReadiness(page, setupReadinessPayload({
    currentStage: {
      id: "project-setup",
      label: "Project Setup"
    },
    message: "Project Setup is not ready.",
    ready: false,
    stages: [
      readyBootstrapPayload,
      readyAccountsPayload,
      readyTargetAppPayload,
      blockedAppSetupPayload
    ]
  }));
  await page.route("**/api/studio/studio-setup", async (route) => {
    await fulfillJson(route, readyBootstrapPayload);
  });
  await page.route("**/api/studio/studio-setup/stream", async (route) => {
    await fulfillSse(route, readyBootstrapPayload);
  });
  await page.route("**/api/studio/adapter-setup", async (route) => {
    await fulfillJson(route, readyTargetAppPayload);
  });
  await page.route("**/api/studio/adapter-setup/stream", async (route) => {
    await fulfillSse(route, readyTargetAppPayload);
  });
  await page.route("**/api/studio/project-setup", async (route) => {
    await fulfillJson(route, blockedAppSetupPayload);
  });
  await page.route("**/api/studio/project-setup/stream", async (route) => {
    await fulfillSse(route, blockedAppSetupPayload, "stages");
  });
}

export {
  mockAppSetupBlocked,
  mockBootstrapBlocked,
  mockCurrentAppInspection,
  mockProjectGateReady,
  mockProtectedRouteReady,
  mockSessionHistoryArchives,
  mockSetupGateReady,
  mockStudioReady,
  mockTargetAppBlocked,
  mockTargetScripts
};
