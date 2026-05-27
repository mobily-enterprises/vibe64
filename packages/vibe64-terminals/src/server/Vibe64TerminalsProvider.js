import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";

import { createService } from "./service.js";
import { featureActions } from "./actions.js";
import { registerRoutes } from "./registerRoutes.js";
import {
  vibe64SessionChangedServiceEvent,
  createVibe64SessionChangedPublisher
} from "@local/vibe64-core/server/sessionRealtimeEvents";

const VIBE64_TERMINALS_SERVICE = "feature.vibe64-terminals.service";
const TERMINAL_SESSION_MUTATION_EVENT_METHODS = Object.freeze([
  "injectCodexPrompt",
  "startCodexTerminal",
  "startCommandTerminal",
  "startLaunchTargetTerminal"
]);

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

    app.service(
      VIBE64_TERMINALS_SERVICE,
      (scope) => {
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
        return createService({
          projectService: scope.make("feature.vibe64-project.service"),
          publishSessionChanged: {
            codexPrompt: publishCodexPromptChanged,
            codexTerminal: publishCodexTerminalChanged,
            commandTerminal: publishCommandTerminalChanged,
            launchTarget: publishLaunchTargetChanged
          }
        });
      },
      {
        events: Object.fromEntries(
          TERMINAL_SESSION_MUTATION_EVENT_METHODS.map((methodName) => [
            methodName,
            [vibe64SessionChangedServiceEvent()]
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
      routeSurface: "home"
    });
  }
}

export { Vibe64TerminalsProvider };
