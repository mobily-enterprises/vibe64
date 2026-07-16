import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";

import { createService } from "./service.js";
import { featureActions } from "./actions.js";
import { registerRoutes } from "./registerRoutes.js";
import {
  createVibe64SessionChangedPublisher,
  vibe64SessionChangedServiceEvent
} from "@local/vibe64-core/server/sessionRealtimeEvents";
import {
  vibe64ComposerChangedServiceEvent
} from "@local/vibe64-core/server/composerRealtimeEvents";
import {
  vibe64SessionViewChangedServiceEvent
} from "@local/vibe64-core/server/sessionViewRealtimeEvents";
import {
  resolveConnectionSetupService
} from "@local/vibe64-runtime/server/connectionReadiness";
import {
  setupOptionsForRuntimeProfile
} from "@local/vibe64-runtime/server/setupReadiness";
import {
  getStudioProjectContext
} from "@local/vibe64-core/server/studioProjectContext";

const VIBE64_SESSIONS_SERVICE = "feature.vibe64-sessions.service";

class Vibe64SessionsProvider {
  static id = "feature.vibe64-sessions";

  static dependsOn = [
    "runtime.actions",
    "feature.vibe64-project",
    "feature.vibe64-terminals",
    "feature.studio-setup-doctor",
    "feature.project-setup-doctor"
  ];

  register(app) {
    if (
      !app ||
      typeof app.service !== "function" ||
      typeof app.actions !== "function"
    ) {
      throw new Error("Vibe64SessionsProvider requires application service()/actions().");
    }
    const studioProjectContext = getStudioProjectContext();
    const setupOptions = setupOptionsForRuntimeProfile(studioProjectContext.runtimeProfile);

    app.service(
      VIBE64_SESSIONS_SERVICE,
      (scope) => {
        const domainEvents = typeof scope.has === "function" && scope.has("domainEvents")
          ? scope.make("domainEvents")
          : null;
        return createService({
          setupServices: {
            connectionSetupService: resolveConnectionSetupService(scope),
            projectSetupService: scope.make("feature.project-setup-doctor.service"),
            studioSetupService: scope.make("feature.studio-setup-doctor.service")
          },
          setupOptions,
          projectService: scope.make("feature.vibe64-project.service"),
          publishSessionChanged: createVibe64SessionChangedPublisher({
            domainEvents,
            methodName: "sendAgentMessage",
            serviceToken: VIBE64_SESSIONS_SERVICE
          }),
          terminalService: scope.make("feature.vibe64-terminals.service")
        });
      },
      {
        events: {
          abandonSession: [vibe64SessionChangedServiceEvent()],
          advanceSession: [vibe64SessionChangedServiceEvent({
            reason: "session-advanced"
          })],
          broadcastComposerDraft: [vibe64ComposerChangedServiceEvent()],
          broadcastSessionViewState: [vibe64SessionViewChangedServiceEvent()],
          cancelAgentMessage: [vibe64SessionChangedServiceEvent({
            reason: "session-agent-message-cancelled"
          })],
          createSession: [vibe64SessionChangedServiceEvent({
            operation: "created"
          })],
          interruptAgentTurn: [vibe64SessionChangedServiceEvent({
            reason: "session-agent-turn-interrupted"
          })],
          recoverStuckSessionStep: [vibe64SessionChangedServiceEvent({
            reason: "session-step-recovered",
            operation: "updated"
          })],
          resolveSessionRecovery: [vibe64SessionChangedServiceEvent({
            reason: "session-recovery-resolved",
            operation: "updated"
          })],
          returnAgentControl: [vibe64SessionChangedServiceEvent({
            reason: "session-agent-control-returned"
          })],
          sendAgentMessage: [vibe64SessionChangedServiceEvent({
            reason: "session-agent-message-accepted"
          })],
          rewindSession: [vibe64SessionChangedServiceEvent({
            reason: "session-rewound"
          })],
          runSessionAction: [vibe64SessionChangedServiceEvent({
            reason: "session-action-run"
          })],
          runSessionIntent: [vibe64SessionChangedServiceEvent({
            reason: "session-intent-run"
          })]
        }
      }
    );

    app.actions(
      withActionDefaults(featureActions, {
        domain: "feature",
        dependencies: {
          featureService: "feature.vibe64-sessions.service"
        }
      })
    );
  }

  boot(app) {
    registerRoutes(app, {
      routeRelativePath: "vibe64",
      routeSurface: "app"
    });
  }
}

export { Vibe64SessionsProvider };
