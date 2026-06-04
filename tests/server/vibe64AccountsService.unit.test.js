import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  authTerminalMetadata,
  canReuseAuthTerminal,
  GITHUB_DEVICE_AUTH_URL,
  parseAuthOutput,
  createService
} from "../../packages/vibe64-accounts/src/server/service.js";
import { withTemporaryRoot } from "./vibe64TestHelpers.js";

function connectedToolchain(calls = []) {
  return async function runToolchain(commandArgs) {
    calls.push(commandArgs);
    return connectedToolchainResult(commandArgs);
  };
}

function connectedToolchainResult(commandArgs) {
  if (commandArgs[0] === "codex") {
    return {
      ok: true,
      output: "Codex is logged in.",
      stdout: "Logged in"
    };
  }
  if (commandArgs[0] === "gh" && commandArgs[1] === "auth") {
    return {
      ok: true,
      output: "github.com\nToken scopes: repo, read:org, gist, workflow",
      stdout: "github.com"
    };
  }
  if (commandArgs[0] === "gh" && commandArgs[1] === "api") {
    return {
      ok: true,
      output: "merc",
      stdout: "merc"
    };
  }
  if (commandArgs[0] === "git" && commandArgs[1] === "config") {
    return {
      ok: true,
      output: "!/usr/bin/gh auth git-credential",
      stdout: "!/usr/bin/gh auth git-credential"
    };
  }
  throw new Error(`Unexpected toolchain command: ${commandArgs.join(" ")}`);
}

function disconnectedGithubGitCredentialToolchain(calls = []) {
  return async function runToolchain(commandArgs) {
    calls.push(commandArgs);
    if (commandArgs[0] === "git" && commandArgs[1] === "config") {
      return {
        ok: false,
        output: "",
        stdout: ""
      };
    }
    return connectedToolchainResult(commandArgs);
  };
}

test("Accounts status reuses a persisted ready status for setup readiness", async () => {
  await withTemporaryRoot(async (root) => {
    const targetRoot = path.join(root, "target");
    const readyStatusCacheRoot = path.join(root, "status-cache");
    const calls = [];
    const service = createService({
      readyStatusCacheRoot,
      runToolchain: connectedToolchain(calls),
      targetRoot
    });

    const first = await service.getStatus();
    assert.equal(first.ok, true);
    assert.equal(first.ready, true);
    assert.equal(calls.length, 4);

    const restored = createService({
      readyStatusCacheRoot,
      runToolchain: async () => {
        throw new Error("Toolchain should not run when ready status is cached.");
      },
      targetRoot
    });
    const second = await restored.getStatus();
    assert.equal(second.ok, true);
    assert.equal(second.ready, true);
  });
});

test("Accounts refresh bypasses and clears a stale ready status", async () => {
  await withTemporaryRoot(async (root) => {
    const targetRoot = path.join(root, "target");
    const readyStatusCacheRoot = path.join(root, "status-cache");

    await createService({
      readyStatusCacheRoot,
      runToolchain: connectedToolchain(),
      targetRoot
    }).getStatus();

    const disconnectedCalls = [];
    const refreshed = await createService({
      readyStatusCacheRoot,
      runToolchain: disconnectedGithubGitCredentialToolchain(disconnectedCalls),
      targetRoot
    }).getStatus({
      refresh: true
    });
    assert.equal(refreshed.ok, true);
    assert.equal(refreshed.ready, false);
    assert.equal(disconnectedCalls.length, 4);

    const connectedCalls = [];
    const afterClear = await createService({
      readyStatusCacheRoot,
      runToolchain: connectedToolchain(connectedCalls),
      targetRoot
    }).getStatus();
    assert.equal(afterClear.ok, true);
    assert.equal(afterClear.ready, true);
    assert.equal(connectedCalls.length, 4);
  });
});

test("OpenCode provider OAuth accepts method index zero", async () => {
  let forwarded = null;
  const service = createService({
    agentRuntimeService: {
      async startOpenCodeProviderOAuth(providerId, input = {}) {
        forwarded = {
          input,
          providerId
        };
        return {
          authorization: {
            url: "https://auth.example/openai"
          },
          ok: true
        };
      }
    },
    runToolchain: connectedToolchain(),
    targetRoot: "/workspace/project"
  });

  const result = await service.startOpenCodeProviderOAuth({
    methodIndex: 0,
    providerId: "openai"
  });

  assert.equal(result.ok, true);
  assert.deepEqual(forwarded, {
    input: {
      methodIndex: "0"
    },
    providerId: "openai"
  });
});

test("Accounts status requires GitHub Git credential helper for remote operations", async () => {
  await withTemporaryRoot(async (root) => {
    const targetRoot = path.join(root, "target");
    const calls = [];
    const status = await createService({
      readyStatusCacheRoot: path.join(root, "status-cache"),
      runToolchain: disconnectedGithubGitCredentialToolchain(calls),
      targetRoot
    }).getStatus({
      refresh: true
    });

    assert.equal(status.ok, true);
    assert.equal(status.ready, false);
    assert.match(status.blockedReason, /Git credential helper is not configured/u);
    assert.equal(calls.length, 4);
  });
});

test("GitHub auth output falls back to the device URL when gh only prints a code", () => {
  const parsed = parseAuthOutput({
    accountId: "github",
    output: [
      "! First copy your one-time code: A1B2-C3D4",
      "Press Enter to open github.com in your browser..."
    ].join("\n")
  });

  assert.equal(parsed.authUrl, GITHUB_DEVICE_AUTH_URL);
  assert.equal(parsed.userCode, "A1B2-C3D4");
});

test("Account auth terminal reuse is scoped to the requested account and mode", () => {
  const metadata = authTerminalMetadata("github", "browser");
  const canReuse = canReuseAuthTerminal("github", "browser");

  assert.deepEqual(metadata, {
    accountId: "github",
    mode: "browser"
  });
  assert.equal(canReuse({
    metadata
  }), true);
  assert.equal(canReuse({
    metadata: authTerminalMetadata("codex", "browser")
  }), false);
  assert.equal(canReuse({
    metadata: authTerminalMetadata("github", "device")
  }), false);
});
