import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";
import {
  createRealtimeEntityChangePublisher
} from "@jskit-ai/kernel/server/runtime/entityChangeEvents";

import {
  createService,
  startProjectRuntimeDormancyCleanupSchedule
} from "./service.js";
import { featureActions } from "./actions.js";
import { registerRoutes } from "./registerRoutes.js";
import {
  vibe64SessionChangedServiceEvent,
  createVibe64SessionChangedPublisher
} from "@local/vibe64-core/server/sessionRealtimeEvents";
import {
  VIBE64_PROJECT_CHANGED_EVENT
} from "@local/vibe64-core/server/projectRealtimeEvents";
import {
  jskitRuntimeEnv
} from "@local/vibe64-core/server/jskitRuntimeEnv";
import {
  VIBE64_PREVIEW_PUBLIC_DOMAIN_ENV,
  VIBE64_PREVIEW_PUBLIC_PROTOCOL_ENV,
  VIBE64_PUBLIC_PROTOCOL_ENV,
  VIBE64_PUBLIC_USER_DOMAIN_ENV
} from "@local/vibe64-core/server/launchPreviewProxyEnv";

const VIBE64_TERMINALS_SERVICE = "feature.vibe64-terminals.service";
const LIVE_PREVIEW_ROUTING_ENV_KEYS = Object.freeze([
  VIBE64_PREVIEW_PUBLIC_DOMAIN_ENV,
  VIBE64_PREVIEW_PUBLIC_PROTOCOL_ENV,
  VIBE64_PUBLIC_PROTOCOL_ENV,
  VIBE64_PUBLIC_USER_DOMAIN_ENV
]);
const TERMINAL_SESSION_MUTATION_EVENT_METHODS = Object.freeze([
  "closeAgentTerminal",
  "closeCommandTerminal",
  "closeLaunchTargetTerminal",
  "deliverAgentPrompt",
  "startAgentTerminal",
  "startCommandTerminal",
  "startLaunchTargetTerminal",
  "stopLaunchTargetTerminal"
]);
const TERMINAL_SESSION_MUTATION_EVENT_REASONS = Object.freeze({
  closeAgentTerminal: "agent-terminal-closed",
  closeCommandTerminal: "command-terminal-closed",
  closeLaunchTargetTerminal: "launch-target-closed",
  deliverAgentPrompt: "agent-prompt-delivered",
  startAgentTerminal: "agent-terminal-started",
  startCommandTerminal: "command-terminal-started",
  startLaunchTargetTerminal: "launch-target-started",
  stopLaunchTargetTerminal: "launch-target-stopped"
});

function terminalsProviderEnv(runtimeEnv = {}, liveEnv = process.env) {
  const env = {
    ...(runtimeEnv && typeof runtimeEnv === "object" && !Array.isArray(runtimeEnv) ? runtimeEnv : {})
  };
  for (const key of LIVE_PREVIEW_ROUTING_ENV_KEYS) {
    const value = String(liveEnv?.[key] || "").trim();
    if (value) {
      env[key] = value;
    }
  }
  return env;
}

class Vibe64TerminalsProvider {
  static id = "feature.vibe64-terminals";

  static dependsOn = [
    "runtime.actions",
    "feature.vibe64-project"
  ];

  constructor({
    codexTerminalController = {}
  } = {}) {
    this.codexTerminalController = codexTerminalController;
  }

  register(app) {
    if (
      !app ||
      typeof app.service !== "function" ||
      typeof app.actions !== "function"
    ) {
      throw new Error("Vibe64TerminalsProvider requires application service()/actions().");
    }
    const appProviderEnv = terminalsProviderEnv(jskitRuntimeEnv(app));

    app.service(
      VIBE64_TERMINALS_SERVICE,
      (scope) => {
        const providerEnv = terminalsProviderEnv({
          ...appProviderEnv,
          ...jskitRuntimeEnv(scope, appProviderEnv)
        });
        const domainEvents = typeof scope.has === "function" && scope.has("domainEvents")
          ? scope.make("domainEvents")
          : null;
        const publishCommandTerminalChanged = createVibe64SessionChangedPublisher({
          domainEvents,
          methodName: "startCommandTerminal",
          serviceToken: VIBE64_TERMINALS_SERVICE
        });
        const publishAgentTerminalChanged = createVibe64SessionChangedPublisher({
          domainEvents,
          methodName: "startAgentTerminal",
          serviceToken: VIBE64_TERMINALS_SERVICE
        });
        const publishLaunchTargetChanged = createVibe64SessionChangedPublisher({
          domainEvents,
          methodName: "startLaunchTargetTerminal",
          serviceToken: VIBE64_TERMINALS_SERVICE
        });
        const publishLaunchTargetStopped = createVibe64SessionChangedPublisher({
          domainEvents,
          methodName: "stopLaunchTargetTerminal",
          serviceToken: VIBE64_TERMINALS_SERVICE
        });
        const publishLaunchTargetClosed = createVibe64SessionChangedPublisher({
          domainEvents,
          methodName: "closeLaunchTargetTerminal",
          serviceToken: VIBE64_TERMINALS_SERVICE
        });
        const publishAgentTerminalClosed = createVibe64SessionChangedPublisher({
          domainEvents,
          methodName: "closeAgentTerminal",
          serviceToken: VIBE64_TERMINALS_SERVICE
        });
        const publishCommandTerminalClosed = createVibe64SessionChangedPublisher({
          domainEvents,
          methodName: "closeCommandTerminal",
          serviceToken: VIBE64_TERMINALS_SERVICE
        });
        const publishProjectRuntimeChanged = domainEvents
          ? createRealtimeEntityChangePublisher({
              domainEvents,
              entity: "project",
              event: VIBE64_PROJECT_CHANGED_EVENT,
              methodName: "projectRuntime",
              serviceToken: VIBE64_TERMINALS_SERVICE,
              source: "vibe64"
            })
          : async function publishNoop() {
              return null;
            };
        return createService({
          codexTerminalController: this.codexTerminalController,
          env: providerEnv,
          logger: app.logger || console,
          projectService: scope.make("feature.vibe64-project.service"),
          publishProjectChanged: publishProjectRuntimeChanged,
          publishSessionChanged: {
            agentTerminal: publishAgentTerminalChanged,
            agentTerminalClosed: publishAgentTerminalClosed,
            commandTerminal: publishCommandTerminalChanged,
            commandTerminalClosed: publishCommandTerminalClosed,
            launchTarget: publishLaunchTargetChanged,
            launchTargetClosed: publishLaunchTargetClosed,
            launchTargetStopped: publishLaunchTargetStopped
          }
        });
      },
      {
        events: Object.fromEntries(
          TERMINAL_SESSION_MUTATION_EVENT_METHODS.map((methodName) => [
            methodName,
            [vibe64SessionChangedServiceEvent({
              reason: TERMINAL_SESSION_MUTATION_EVENT_REASONS[methodName] || ""
            })]
          ])
        )
      }
    );

    app.actions(
      withActionDefaults(featureActions, {
        domain: "feature",
        dependencies: {
          featureService: "feature.vibe64-terminals.service"
        }
      })
    );
  }

  boot(app) {
    registerRoutes(app, {
      routeRelativePath: "vibe64",
      routeSurface: "app"
    });
    if (typeof app?.make !== "function" || typeof app?.addHook !== "function") {
      return;
    }
    const dormantRuntimeCleanup = startProjectRuntimeDormancyCleanupSchedule({
      logger: app.logger || app.log || console,
      serviceFactory: () => app.make(VIBE64_TERMINALS_SERVICE)
    });
    app.addHook("onClose", async () => {
      dormantRuntimeCleanup.stop();
      const service = app.make(VIBE64_TERMINALS_SERVICE);
      await service?.close?.();
    });
    void dormantRuntimeCleanup.runNow();
  }
}

export {
  Vibe64TerminalsProvider,
  terminalsProviderEnv
};
