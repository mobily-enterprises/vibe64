import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  Vibe64ProjectProvider
} from "../../packages/vibe64-project/src/server/Vibe64ProjectProvider.js";
import {
  Vibe64SessionsProvider
} from "../../packages/vibe64-sessions/src/server/Vibe64SessionsProvider.js";
import {
  createService as createSessionsService
} from "../../packages/vibe64-sessions/src/server/service.js";

test("project and sessions expose only named Feature capabilities", () => {
  assert.equal(Vibe64ProjectProvider.id, "vibe64.project");
  assert.deepEqual(Vibe64ProjectProvider.requires, {
    env: "runtime.env",
    logger: "runtime.logger",
    http: "runtime.http",
    actionCatalogue: "runtime.actions"
  });
  assert.deepEqual(Vibe64ProjectProvider.provides, {
    project: "vibe64.project"
  });
  assert.equal(Vibe64ProjectProvider.boot, null);

  assert.equal(Vibe64SessionsProvider.id, "vibe64.sessions");
  assert.deepEqual(Vibe64SessionsProvider.requires, {
    events: "runtime.events",
    http: "runtime.http",
    project: "vibe64.project",
    terminals: "vibe64.terminals",
    actionCatalogue: "runtime.actions"
  });
  assert.deepEqual(Vibe64SessionsProvider.provides, {
    sessions: "vibe64.sessions"
  });
  assert.equal(typeof Vibe64SessionsProvider.boot, "function");
  assert.equal(typeof Vibe64SessionsProvider.shutdown, "function");
});

test("project and sessions register routes and captured actions during setup", async () => {
  const projectActions = [];
  const projectRoutes = [];
  const projectOutputs = await Vibe64ProjectProvider.setup({
    actionCatalogue: {
      register(contributor) {
        projectActions.push(contributor);
      }
    },
    env: {},
    logger: console,
    http: {
      router: {
        register(...args) {
          projectRoutes.push(args);
        }
      }
    }
  }, {});

  assert.equal(typeof projectOutputs.project.createRuntime, "function");
  assert.equal(projectActions.length, 1);
  assert.equal(projectActions[0].contributorId, "vibe64.project");
  assert.deepEqual(projectActions[0].actions.map(({ id }) => id).sort(), [
    "vibe64.project.collaboration.save",
    "vibe64.project.development-database.scope.save",
    "vibe64.project.engineering.profile.save",
    "vibe64.project.engineering.read",
    "vibe64.project.env.read",
    "vibe64.project.env.user-values.save",
    "vibe64.project.onboarding.read",
    "vibe64.project.preview-identities.read",
    "vibe64.project.preview-identities.save",
    "vibe64.project.projects.create",
    "vibe64.project.projects.list",
    "vibe64.project.projects.select",
    "vibe64.project.prompt-hints.save",
    "vibe64.project.settings.read",
    "vibe64.project.templates.apply"
  ]);
  assert.equal(projectRoutes.length, projectActions[0].actions.length + 1);
  assert.equal(
    projectRoutes.some(([method, path]) => method === "POST" && path.endsWith("/env/reveal")),
    true,
    "the owner-only secret reveal service route is registered beside captured actions"
  );
  assert.equal(projectActions[0].actions.some((action) => Object.hasOwn(action, "dependencies")), false);

  const sessionActions = [];
  const sessionRoutes = [];
  const sessionOutputs = await Vibe64SessionsProvider.setup({
    actionCatalogue: {
      register(contributor) {
        sessionActions.push(contributor);
      }
    },
    events: {
      async publish() {}
    },
    http: {
      router: {
        register(...args) {
          sessionRoutes.push(args);
        }
      }
    },
    project: {},
    terminals: {}
  }, {});

  assert.equal(typeof sessionOutputs.sessions.createSession, "function");
  assert.equal(typeof sessionOutputs.sessions.setRenewalActorResolver, "function");
  assert.doesNotThrow(() => sessionOutputs.sessions.setRenewalActorResolver(async () => null));
  assert.throws(
    () => sessionOutputs.sessions.setRenewalActorResolver({}),
    /must be a function or null/u
  );
  assert.equal(sessionActions.length, 1);
  assert.equal(sessionActions[0].contributorId, "vibe64.sessions");
  assert.deepEqual(sessionActions[0].actions.map(({ id }) => id).sort(), [
    "vibe64.assistants.capabilities.list",
    "vibe64.assistants.model-access.update",
    "vibe64.repository.history.diff.inspect",
    "vibe64.repository.history.files.inspect",
    "vibe64.repository.history.inspect",
    "vibe64.sessions.agent-message.send",
    "vibe64.sessions.agent-turn.interrupt",
    "vibe64.sessions.archive",
    "vibe64.sessions.archived.list",
    "vibe64.sessions.assistant-access.inspect",
    "vibe64.sessions.assistant-selection.update",
    "vibe64.sessions.changes.diff.inspect",
    "vibe64.sessions.changes.inspect",
    "vibe64.sessions.conversation-log.read",
    "vibe64.sessions.create",
    "vibe64.sessions.current.update",
    "vibe64.sessions.inspect",
    "vibe64.sessions.list",
    "vibe64.sessions.message-suggestions.approve",
    "vibe64.sessions.message-suggestions.create",
    "vibe64.sessions.message-suggestions.discard",
    "vibe64.sessions.message-suggestions.list",
    "vibe64.sessions.message-suggestions.withdraw",
    "vibe64.sessions.presence.update",
    "vibe64.sessions.preview-state.broadcast",
    "vibe64.sessions.renewal.cancel",
    "vibe64.sessions.renewal.confirm",
    "vibe64.sessions.renewal.draft.request",
    "vibe64.sessions.renewal.draft.update",
    "vibe64.sessions.renewal.inspect",
    "vibe64.sessions.renewal.retry",
    "vibe64.sessions.updates.apply",
    "vibe64.sessions.updates.check",
    "vibe64.sessions.work.inspect",
    "vibe64.sessions.work.save",
    "vibe64.sessions.workspace-setup.retry"
  ]);
  assert.equal(sessionRoutes.length, sessionActions[0].actions.length);
  assert.equal(sessionActions[0].actions.some((action) => Object.hasOwn(action, "dependencies")), false);
});

test("sessions start standalone renewal recovery without blocking Feature boot", async () => {
  let resumeCalls = 0;
  let renewalWorkClosed = false;
  const shutdownEvents = [];
  let finishRecovery;
  const recovery = new Promise((resolve) => {
    finishRecovery = resolve;
  });
  const sessions = {
    async closeSessionRenewalWork() {
      renewalWorkClosed = true;
      shutdownEvents.push("close-renewal-admission");
    },
    async resumeSessionArchives() { return { failures: [] }; },
    async resumeSessionRenewals() {
      resumeCalls += 1;
      return recovery;
    }
  };
  const bootResult = Vibe64SessionsProvider.boot({
    project: { targetRoot: "/tmp/selected-project" }
  }, {
    outputs: { sessions }
  });

  assert.equal(bootResult, undefined);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(resumeCalls, 1);
  let shutdownSettled = false;
  const shutdown = Vibe64SessionsProvider.shutdown({
    terminals: {
      async invalidateAgentRuntimes(input) {
        assert.deepEqual(input, { reason: "server-shutdown" });
        shutdownEvents.push("invalidate-agent-runtimes");
        finishRecovery();
        return { ok: true };
      }
    }
  }, {
    outputs: { sessions }
  }).then(() => {
    shutdownSettled = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(renewalWorkClosed, true);
  assert.deepEqual(shutdownEvents, [
    "close-renewal-admission",
    "invalidate-agent-runtimes"
  ]);
  await shutdown;
  assert.equal(shutdownSettled, true);

  Vibe64SessionsProvider.boot({
    project: { targetRoot: "/tmp/selected-project" }
  }, {
    outputs: { sessions }
  });
  assert.equal(resumeCalls, 1, "Feature shutdown permanently closes its recovery task");

  Vibe64SessionsProvider.boot({
    project: { targetRoot: "" }
  }, {
    outputs: {
      sessions: {
        async resumeSessionArchives() { return { failures: [] }; },
    async resumeSessionRenewals() {
          resumeCalls += 1;
        }
      }
    }
  });
  assert.equal(
    resumeCalls,
    1,
    "hosted boot recovery is owned by the catalog-aware Online boundary"
  );

  Vibe64SessionsProvider.boot({
    project: { targetRoot: "/tmp/selected-project" }
  }, {
    outputs: {
      sessions: {
        async resumeSessionArchives() { return { failures: [] }; },
    async resumeSessionRenewals() {
          throw new Error("Expected detached recovery failure");
        }
      }
    }
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.throws(
    () => createSessionsService({
      project: {},
      renewalActorResolver: {},
      terminals: {}
    }),
    /must be a function or null/u
  );
});

test("sessions reject a fulfilled but unsuccessful agent-runtime shutdown", async () => {
  const invalidation = {
    failed: [{ code: "test_runtime_exit_unverified" }],
    ok: false
  };
  await assert.rejects(
    () => Vibe64SessionsProvider.shutdown({
      terminals: {
        async invalidateAgentRuntimes(input) {
          assert.deepEqual(input, { reason: "server-shutdown" });
          return invalidation;
        }
      }
    }, {
      outputs: {
        sessions: {
          async closeSessionRenewalWork() {}
        }
      }
    }),
    (error) => (
      error instanceof AggregateError &&
      error.errors.some((failure) => (
        failure?.code === "vibe64_agent_runtime_shutdown_failed" &&
        failure.details === invalidation
      ))
    )
  );
});

test("project and sessions package declarations contain no scaffold or container metadata", async () => {
  for (const packagePath of [
    "packages/vibe64-project/package.json",
    "packages/vibe64-sessions/package.json"
  ]) {
    const source = await readFile(packagePath, "utf8");
    const declaration = JSON.parse(source);
    assert.equal(Object.hasOwn(declaration.jskit, "mutations"), false);
    assert.doesNotMatch(source, /containerTokens|scaffoldMode|scaffoldShape/u);
  }
});
