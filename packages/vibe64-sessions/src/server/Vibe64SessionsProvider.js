import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";

import { createService } from "./service.js";
import { featureActions } from "./actions.js";
import { registerRoutes } from "./registerRoutes.js";
import { vibe64SessionChangedServiceEvent } from "@local/vibe64-core/server/sessionRealtimeEvents";
import {
  vibe64ComposerChangedServiceEvent
} from "@local/vibe64-core/server/composerRealtimeEvents";
import {
  resolveConnectionSetupService
} from "@local/vibe64-runtime/server/connectionReadiness";

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

    app.service(
      VIBE64_SESSIONS_SERVICE,
      (scope) => {
        return createService({
          setupServices: {
            connectionSetupService: resolveConnectionSetupService(scope),
            projectSetupService: scope.make("feature.project-setup-doctor.service"),
            studioSetupService: scope.make("feature.studio-setup-doctor.service")
          },
          projectService: scope.make("feature.vibe64-project.service"),
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
          createSession: [vibe64SessionChangedServiceEvent({
            operation: "created"
          })],
          recoverSessionWorktree: [vibe64SessionChangedServiceEvent({
            reason: "session-worktree-recovered",
            operation: "updated"
          })],
          recoverStuckSessionStep: [vibe64SessionChangedServiceEvent({
            reason: "session-step-recovered",
            operation: "updated"
          })],
          returnAgentControl: [vibe64SessionChangedServiceEvent({
            reason: "session-agent-control-returned"
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
