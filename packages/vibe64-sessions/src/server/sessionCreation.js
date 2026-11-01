import {
  parseSessionConnectedContribution,
  sessionRepositoryProject
} from "@local/vibe64-core/server/projectRepository";
import {
  assertProjectEffectAdmission,
  currentProjectRequestContext
} from "@local/vibe64-core/server/projectRequestContext";
import { vibe64SessionDebugError, vibe64SessionDebugLog } from "@local/vibe64-runtime/server/sessionDebugLog";
import { assertValidVibe64SessionId } from "@local/vibe64-runtime/server/sessionStore";
import { serializeVibe64AssistantSelection, VIBE64_ASSISTANT_SELECTION_METADATA } from "@local/vibe64-runtime/shared";
import { ASSISTANT_ROUTING_METADATA } from "@local/vibe64-runtime/shared/assistantRouting";
import { sessionsOccupyingPolicySlots } from "./sessionPolicySlots.js";
import { publicSession, sessionResult } from "./sessionResults.js";
import { text } from "./trimmedText.js";
import { trustedAssistantUser } from "./trustedAssistantUser.js";

/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@local/vibe64-core/server/types").PublishSessionChanged} PublishSessionChanged */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */
/** @typedef {import("./types.js").WorkspaceSetupRunner} WorkspaceSetupRunner */
/** @typedef {import("./types.js").SessionWorkspaceSetup} SessionWorkspaceSetup */
/** @typedef {ReturnType<typeof import("./sessionAssistant.js").createSessionAssistant>} SessionAssistant */

/** @param {TerminalsService} terminals */
function sessionRuntimeOptions(terminals) {
  return { createSessionSource: (context) => terminals.createSessionSource(context) };
}

function sessionCreationLimitError(policy) {
  const error = new Error(
    text(policy?.creation?.disabledReason) || "No more sessions can be created for this project."
  );
  error.code = "vibe64_session_creation_limit";
  error.details = {
    maxOpenSessions: Number(policy?.limits?.maxOpenSessions || 0),
    openSessionCount: Number(policy?.limits?.openSessionCount || 0)
  };
  error.statusCode = 409;
  return error;
}

/**
 * A new session, admitted under the project's session limit, started on its
 * resolved assistant, and its workspace preparation begun.
 * @param {object} dependencies
 * @param {SessionAssistant} dependencies.assistant
 * @param {ProjectService} dependencies.project
 * @param {PublishSessionChanged} dependencies.publishSessionChanged
 * @param {WorkspaceSetupRunner} dependencies.setupRunner
 * @param {TerminalsService} dependencies.terminals
 * @param {SessionWorkspaceSetup} dependencies.workspaceSetup
 */
function createSessionCreation({
  assistant,
  project,
  publishSessionChanged,
  setupRunner,
  terminals,
  workspaceSetup
}) {
  /**
   * Only an internal caller may supply a server-reserved identity.
   */
  async function createSession(input = {}, {
    sessionId,
    expectedCommit,
    connectedContribution
  } = {}) {
    return sessionResult(async () => {
      assertProjectEffectAdmission();
      if (sessionId !== undefined) assertValidVibe64SessionId(sessionId);
      if (expectedCommit !== undefined) {
        if (sessionId === undefined || typeof expectedCommit !== "string" ||
          !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(expectedCommit)) {
          throw new TypeError("An internal source commit requires a reserved session ID and a complete Git object ID.");
        }
        if (input.repositoryBranch != null || input.pullRequestNumber != null) {
          throw new TypeError("An internal source commit cannot be combined with a branch or pull request selection.");
        }
      }
      let contribution = null;
      if (connectedContribution !== undefined) {
        contribution = parseSessionConnectedContribution(connectedContribution);
        if (!sessionId || !expectedCommit || contribution.baseCommit !== expectedCommit.toLowerCase() ||
            currentProjectRequestContext()?.learningScope) {
          throw new TypeError("Contribution creation requires a reserved working session and its exact source commit.");
        }
        sessionRepositoryProject(await project.readCurrentProject(), {
          metadata: { connected_contribution: JSON.stringify(contribution) }
        }, { sourcePreparation: true });
      }
      const vibe64User = trustedAssistantUser(input);
      let learningRuntime = null;
      if (currentProjectRequestContext()?.learningScope) {
        if (sessionId === undefined) {
          throw new TypeError("Learning creation requires a server-reserved session ID.");
        }
        if ((currentProjectRequestContext().learningScope.noExercise && expectedCommit !== undefined) ||
          ["repositoryBranch", "pullRequestNumber", "expectedCommit",
          "sourceContext", "sourcePath", "sourceRoot", "projectSessionSourceRoot", "createSessionSource"]
          .some(name => Object.hasOwn(input, name))) {
          throw new TypeError(currentProjectRequestContext().learningScope.noExercise
            ? "A source-less learning session cannot select source, branch, pull request or commit options."
            : "A saved practice learning session cannot select different source, branch, pull request or commit options.");
        }
        learningRuntime = await project.createRuntime(sessionRuntimeOptions(terminals));
        if (!learningRuntime.learningScope) {
          throw new TypeError("Learning creation requires the trusted Project learning runtime.");
        }
      }
      const pullRequest = input.pullRequestNumber == null ? null : await project.resolvePullRequestSource({
        number: input.pullRequestNumber,
        vibe64User
      });
      if (pullRequest && input.repositoryBranch) throw new Error("Choose a branch or a pull request for this session.");
      const { assistantSelection, assistantRouting } = await assistant.resolveSessionStart(input, {
        vibe64User,
        mode: learningRuntime ? "junior" : "senior"
      });
      const runtime = learningRuntime || await project.createRuntime(sessionRuntimeOptions(terminals));
      if (runtime.learningScope && !learningRuntime) {
        throw new TypeError("Learning creation requires the trusted Project learning context.");
      }
      const createAdmittedSession = ({ repositoryBranch = null } = {}) => runtime.createSession({
        ...(sessionId === undefined ? {} : { sessionId }),
        metadata: {
          ...(contribution ? { connected_contribution: JSON.stringify(contribution) } : {}),
          ...(repositoryBranch ? { repository_branch: repositoryBranch.name } : {}),
          ...(pullRequest ? { github_pull_request: JSON.stringify(pullRequest) } : {}),
          [ASSISTANT_ROUTING_METADATA]: JSON.stringify(assistantRouting),
          [VIBE64_ASSISTANT_SELECTION_METADATA]: serializeVibe64AssistantSelection(
            assistantSelection
          ),
          created_by: text(vibe64User?.username || vibe64User?.name)
        },
        ...(!runtime.learningScope?.noExercise ? {
          sourceContext: {
            ...(expectedCommit === undefined ? {} : { expectedCommit }),
            ...(repositoryBranch ? { expectedCommit: repositoryBranch.commit } : {}),
            ...(pullRequest ? { expectedCommit: pullRequest.headCommit } : {}),
            vibe64User
          }
        } : {})
      });
      let created;
      if (runtime.learningScope?.noExercise) {
        await runtime.store.assertSessionCreationAbsent(sessionId);
        created = { session: await createAdmittedSession() };
      } else {
        created = await project.runProjectSessionPolicyExclusive(async () => {
          const visibleOpenSessions = await runtime.listSessionSummaries({
            statusGroup: "open"
          });
          const openSessions = await sessionsOccupyingPolicySlots(runtime, visibleOpenSessions);
          const policy = await project.developmentDatabasePolicy({ openSessions });
          if (policy?.creation?.canCreate !== true) {
            throw sessionCreationLimitError(policy);
          }
          if (sessionId !== undefined) {
            // readable-check: allow method-probe - test asserts error: vibe64SessionsDirect refuses reserved creation without the store's absence check
            if (typeof runtime.store?.assertSessionCreationAbsent !== "function") {
              throw new TypeError("Reserved session creation requires the session store's absence check.");
            }
            await runtime.store.assertSessionCreationAbsent(sessionId);
          }
          const repositoryBranch = input.repositoryBranch ? await project.resolveSessionBranch({
            selection: input.repositoryBranch,
            vibe64User
          }) : null;
          const session = await createAdmittedSession({ repositoryBranch });
          const updatedPolicy = await project.developmentDatabasePolicy({
            openSessions: [...openSessions, session]
          });
          return {
            session,
            updatedPolicy
          };
        }, {
          operation: "create-session"
        });
      }
      let setup = null;
      try {
        // Allocation prepares a receiving checkout only. The originating
        // recipe treats its direct sources; starting the receiver's setup
        // here would recursively allocate its connections (including cycles).
        if (!contribution && !runtime.learningScope?.noExercise) setup = await setupRunner.start({
          retry: true,
          runtime,
          session: created.session
        });
      } catch (error) {
        vibe64SessionDebugLog("server.sessions.workspaceSetup.start.error", {
          error: vibe64SessionDebugError(error),
          sessionId: created.session.sessionId
        });
      }
      let currentSession = created.session;
      try {
        currentSession = await runtime.getSession(created.session.sessionId, {
          inspectSource: false
        }) || created.session;
      } catch (error) {
        vibe64SessionDebugLog("server.sessions.createSession.inspect.error", {
          error: vibe64SessionDebugError(error),
          sessionId: created.session.sessionId
        });
      }
      try {
        await publishSessionChanged(created.session.sessionId, {
          operation: "created",
          originId: text(input.originId),
          reason: "session-created",
          session: currentSession
        });
      } catch (error) {
        vibe64SessionDebugLog("server.sessions.createSession.publish.error", {
          error: vibe64SessionDebugError(error),
          sessionId: created.session.sessionId
        });
      }
      if (setup) {
        workspaceSetup.observeWorkspaceSetup(created.session.sessionId, setup.completion, {
          originId: input.originId
        });
      }
      return publicSession(currentSession, runtime.learningScope?.noExercise ? {} : {
        creation: created.updatedPolicy.creation,
        limits: created.updatedPolicy.limits
      });
    }, "Vibe64 could not create a chat session.");
  }

  return Object.freeze({ createSession });
}

export { createSessionCreation };
