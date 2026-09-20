import assert from "node:assert/strict";
import test from "node:test";

import {
  prepareAgentSessionCommandEnvironment
} from "../../packages/vibe64-terminals/src/server/agentCommandEnvironment.js";
import {
  genesisCommandShimDirectory
} from "../../packages/vibe64-genesis/src/server/index.js";

test("assistant engines share one complete session command environment", async () => {
  const calls = [];
  const service = (name) => ({ name });
  const prepared = await prepareAgentSessionCommandEnvironment({
    agentDatabaseCommand: service("database-service"),
    agentEnvCommand: service("environment-service"),
    agentPreviewCommand: service("preview-service"),
    agentSessionCommand: service("session-command-service"),
    env: { LIVE_ENV: "yes", GENESIS_PARSER_ROOT: "/release/genesis-parsers", GENESIS_PARSER_AUTO_INSTALL: "0" },
    gitCommand: service("git-service"),
    gitEnvironment: { ATTACHMENT_ENV: "yes" },
    prepareDatabaseCommand: async (input) => {
      calls.push(["database", input]);
      return { env: { DATABASE_BOUNDARY: "ready" }, ok: true };
    },
    prepareEnvironmentCommand: async (input) => {
      calls.push(["environment", input]);
      return { env: { ENV_BOUNDARY: "ready" }, ok: true };
    },
    prepareGitCommand: async (input) => {
      calls.push(["git", input]);
      return {
        env: { GIT_BOUNDARY: "ready" },
        hostWrapperDir: "/managed/session-wrappers",
        ok: true
      };
    },
    preparePreviewCommand: async (input) => {
      calls.push(["preview", input]);
      return { env: { PREVIEW_BOUNDARY: "ready" }, ok: true };
    },
    prepareHelperCommand: async (input) => {
      calls.push(["helper", input]);
      return { ok: true };
    },
    prepareSessionCommand: async (input) => {
      calls.push(["session", input]);
      return { env: { SESSION_BOUNDARY: "ready" }, ok: true };
    },
    project: { slug: "catalogue" },
    runtime: { stateRoot: "/managed/project-state", store: { paths: (id) => ({ dropZoneRoot: `/managed/project-state/sessions/active/${id}/drop-zone` }) } },
    sessionId: "session-1",
    worktreePath: "/managed/session/source"
  });

  assert.deepEqual(calls.map(([name]) => name), [
    "git",
    "session",
    "preview",
    "environment",
    "database",
    "helper"
  ]);
  assert.equal(calls[0][1].env.ATTACHMENT_ENV, "yes");
  for (const [name, input] of calls.slice(1)) {
    assert.equal(input.wrapperHostDir, "/managed/session-wrappers");
    if (name !== "helper") {
      assert.equal(input.sessionId, "session-1");
    }
  }
  assert.deepEqual(prepared, {
    env: {
      GENESIS_PARSER_ROOT: "/release/genesis-parsers",
      GENESIS_PARSER_AUTO_INSTALL: "0",
      DATABASE_BOUNDARY: "ready",
      ENV_BOUNDARY: "ready",
      GIT_BOUNDARY: "ready",
      PREVIEW_BOUNDARY: "ready",
      SESSION_BOUNDARY: "ready",
      VIBE64_DROP_ZONE: "/managed/project-state/sessions/active/session-1/drop-zone"
    },
    hostWrapperDir: "/managed/session-wrappers",
    ok: true,
    shimDirs: [
      "/managed/session-wrappers",
      genesisCommandShimDirectory()
    ]
  });
});

test("a configured assistant command boundary fails closed when preparation is incomplete", async () => {
  await assert.rejects(
    prepareAgentSessionCommandEnvironment({
      agentDatabaseCommand: {},
      gitCommand: {},
      prepareDatabaseCommand: async () => ({ env: {}, ok: false }),
      prepareGitCommand: async () => ({
        env: {},
        hostWrapperDir: "/managed/session-wrappers",
        ok: true
      }),
      sessionId: "session-1"
    }),
    {
      boundary: "database",
      code: "vibe64_agent_command_boundary_unavailable"
    }
  );
});

test("the shared command environment requires the helper dispatcher to be installed", async () => {
  await assert.rejects(prepareAgentSessionCommandEnvironment({
    gitCommand: {},
    prepareGitCommand: async () => ({ ok: true, hostWrapperDir: "/managed/session-wrappers" }),
    prepareHelperCommand: async () => ({ ok: false }),
    sessionId: "session-1"
  }), { boundary: "helper", code: "vibe64_agent_command_boundary_unavailable" });
});
