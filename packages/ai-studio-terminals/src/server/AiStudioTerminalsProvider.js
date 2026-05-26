import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";

import { createService } from "./service.js";
import { featureActions } from "./actions.js";
import { registerRoutes } from "./registerRoutes.js";
import {
  aiStudioSessionChangedServiceEvent,
  createAiStudioSessionChangedPublisher
} from "@local/ai-studio-core/server/sessionRealtimeEvents";

const AI_STUDIO_TERMINALS_SERVICE = "feature.ai-studio-terminals.service";
const TERMINAL_SESSION_MUTATION_EVENT_METHODS = Object.freeze([
  "injectCodexPrompt",
  "startCodexTerminal",
  "startCommandTerminal",
  "startLaunchTargetTerminal"
]);

class AiStudioTerminalsProvider {
  static id = "feature.ai-studio-terminals";

  static dependsOn = [
    "runtime.actions",
    "feature.ai-studio-project"
  ];

  register(app) {
    if (
      !app ||
      typeof app.service !== "function" ||
      typeof app.actions !== "function"
    ) {
      throw new Error("AiStudioTerminalsProvider requires application service()/actions().");
    }

    app.service(
      AI_STUDIO_TERMINALS_SERVICE,
      (scope) => {
        const domainEvents = typeof scope.has === "function" && scope.has("domainEvents")
          ? scope.make("domainEvents")
          : null;
        const publishCommandTerminalChanged = createAiStudioSessionChangedPublisher({
          domainEvents,
          methodName: "startCommandTerminal",
          serviceToken: AI_STUDIO_TERMINALS_SERVICE
        });
        const publishCodexTerminalChanged = createAiStudioSessionChangedPublisher({
          domainEvents,
          methodName: "startCodexTerminal",
          serviceToken: AI_STUDIO_TERMINALS_SERVICE
        });
        const publishCodexPromptChanged = createAiStudioSessionChangedPublisher({
          domainEvents,
          methodName: "injectCodexPrompt",
          serviceToken: AI_STUDIO_TERMINALS_SERVICE
        });
        const publishLaunchTargetChanged = createAiStudioSessionChangedPublisher({
          domainEvents,
          methodName: "startLaunchTargetTerminal",
          serviceToken: AI_STUDIO_TERMINALS_SERVICE
        });
        return createService({
          projectService: scope.make("feature.ai-studio-project.service"),
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
            [aiStudioSessionChangedServiceEvent()]
          ])
        )
      }
    );

    app.actions(
      withActionDefaults(featureActions, {
        domain: "feature",
        dependencies: {
          featureService: "feature.ai-studio-terminals.service"
        }
      })
    );
  }

  boot(app) {
    registerRoutes(app, {
      routeRelativePath: "ai-studio",
      routeSurface: "home"
    });
  }
}

export { AiStudioTerminalsProvider };
