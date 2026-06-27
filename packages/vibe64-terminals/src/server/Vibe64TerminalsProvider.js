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

const VIBE64_TERMINALS_SERVICE = "feature.vibe64-terminals.service";
const TERMINAL_SESSION_MUTATION_EVENT_METHODS = Object.freeze([
  "closeCodexTerminal",
  "closeCommandTerminal",
  "closeLaunchTargetTerminal",
  "closeShellTerminal",
  "injectCodexPrompt",
  "startCodexTerminal",
  "startCommandTerminal",
  "startLaunchTargetTerminal",
  "stopLaunchTargetTerminal"
]);
const TERMINAL_SESSION_MUTATION_EVENT_REASONS = Object.freeze({
  closeCodexTerminal: "codex-terminal-closed",
  closeCommandTerminal: "command-terminal-closed",
  closeLaunchTargetTerminal: "launch-target-closed",
  closeShellTerminal: "shell-terminal-closed",
  injectCodexPrompt: "codex-prompt-injected",
  startCodexTerminal: "codex-terminal-started",
  startCommandTerminal: "command-terminal-started",
  startLaunchTargetTerminal: "launch-target-started",
  stopLaunchTargetTerminal: "launch-target-stopped"
});

class Vibe64TerminalsProvider {
  static id = "feature.vibe64-terminals";

  static dependsOn = [
    "runtime.actions",
    "feature.vibe64-project"
  ];

  register(app) {
    if (
      !app ||
      typeof app.service !== "function" ||
      typeof app.actions !== "function"
    ) {
      throw new Error("Vibe64TerminalsProvider requires application service()/actions().");
    }
    const appProviderEnv = {
      ...jskitRuntimeEnv(app)
    };

    app.service(
      VIBE64_TERMINALS_SERVICE,
      (scope) => {
        const providerEnv = {
          ...appProviderEnv,
          ...jskitRuntimeEnv(scope, appProviderEnv)
        };
        const domainEvents = typeof scope.has === "function" && scope.has("domainEvents")
          ? scope.make("domainEvents")
          : null;
        const publishCommandTerminalChanged = createVibe64SessionChangedPublisher({
          domainEvents,
          methodName: "startCommandTerminal",
          serviceToken: VIBE64_TERMINALS_SERVICE
        });
        const publishCodexTerminalChanged = createVibe64SessionChangedPublisher({
          domainEvents,
          methodName: "startCodexTerminal",
          serviceToken: VIBE64_TERMINALS_SERVICE
        });
        const publishCodexPromptChanged = createVibe64SessionChangedPublisher({
          domainEvents,
          methodName: "injectCodexPrompt",
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
        const publishCodexTerminalClosed = createVibe64SessionChangedPublisher({
          domainEvents,
          methodName: "closeCodexTerminal",
          serviceToken: VIBE64_TERMINALS_SERVICE
        });
        const publishCommandTerminalClosed = createVibe64SessionChangedPublisher({
          domainEvents,
          methodName: "closeCommandTerminal",
          serviceToken: VIBE64_TERMINALS_SERVICE
        });
        const publishShellTerminalClosed = createVibe64SessionChangedPublisher({
          domainEvents,
          methodName: "closeShellTerminal",
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
          env: providerEnv,
          logger: app.logger || console,
          projectService: scope.make("feature.vibe64-project.service"),
          publishProjectChanged: publishProjectRuntimeChanged,
          publishSessionChanged: {
            codexPrompt: publishCodexPromptChanged,
            codexTerminal: publishCodexTerminalChanged,
            codexTerminalClosed: publishCodexTerminalClosed,
            commandTerminal: publishCommandTerminalChanged,
            commandTerminalClosed: publishCommandTerminalClosed,
            launchTarget: publishLaunchTargetChanged,
            launchTargetClosed: publishLaunchTargetClosed,
            launchTargetStopped: publishLaunchTargetStopped,
            shellTerminalClosed: publishShellTerminalClosed
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
    });
    void dormantRuntimeCleanup.runNow();
  }
}

export { Vibe64TerminalsProvider };
