import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createService
} from "../../packages/vibe64-accounts/src/server/service.js";

function fakeRunToolchain(commandArgs = []) {
  const command = commandArgs.join(" ");
  if (command === "codex login status") {
    return Promise.resolve({
      ok: false,
      output: "Codex is not logged in."
    });
  }
  if (command === "gh auth status --hostname github.com") {
    return Promise.resolve({
      ok: true,
      output: "Logged in to github.com\nToken scopes: repo, read:org, gist, workflow"
    });
  }
  if (command === "gh api user --jq .login") {
    return Promise.resolve({
      ok: true,
      output: "octocat",
      stdout: "octocat"
    });
  }
  if (command === "git config --global --get-urlmatch credential.helper https://github.com") {
    return Promise.resolve({
      ok: true,
      output: "gh auth git-credential",
      stdout: "gh auth git-credential"
    });
  }
  return Promise.resolve({
    ok: false,
    output: `Unexpected command: ${command}`
  });
}

function fakeRunToolchainWithCodex(commandArgs = []) {
  const command = commandArgs.join(" ");
  if (command === "codex login status") {
    return Promise.resolve({
      ok: true,
      output: "Codex is logged in."
    });
  }
  return fakeRunToolchain(commandArgs);
}

test("account readiness defaults to OpenCode and does not require Codex authentication", async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-accounts-"));
  try {
    const service = createService({
      runToolchain: fakeRunToolchain,
      targetRoot
    });
    const status = await service.getStatus({
      refresh: true
    });

    assert.equal(status.ok, true);
    assert.equal(status.ready, true);
    assert.equal(status.ai.defaultRuntimeId, "opencode");
    assert.equal(status.ai.ready, true);

    const opencode = status.agentRuntimes.find((runtime) => runtime.id === "opencode");
    assert.equal(opencode.ready, true);
    assert.equal(opencode.default, true);
    assert.equal(opencode.mode, "free");

    const codexAccount = status.accounts.find((account) => account.id === "codex");
    assert.equal(codexAccount.connected, false);
    assert.equal(codexAccount.required, false);

    const githubAccount = status.accounts.find((account) => account.id === "github");
    assert.equal(githubAccount.connected, true);
    assert.equal(githubAccount.required, true);
  } finally {
    await rm(targetRoot, {
      force: true,
      recursive: true
    });
  }
});

test("default OpenCode runtime gates account and AI readiness", async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-accounts-"));
  try {
    const service = createService({
      agentRuntimeService: {
        async opencodeRuntimeStatus() {
          return {
            error: "OpenCode server is not ready.",
            healthy: false,
            ready: false
          };
        }
      },
      runToolchain: fakeRunToolchainWithCodex,
      targetRoot
    });
    const status = await service.getStatus({
      refresh: true
    });

    assert.equal(status.ok, true);
    assert.equal(status.ready, false);
    assert.equal(status.ai.ready, false);
    assert.match(status.blockedReason, /OpenCode server is not ready/u);

    const opencode = status.agentRuntimes.find((runtime) => runtime.id === "opencode");
    assert.equal(opencode.ready, false);
    assert.equal(opencode.default, true);

    const codex = status.agentRuntimes.find((runtime) => runtime.id === "codex");
    assert.equal(codex.ready, true);
  } finally {
    await rm(targetRoot, {
      force: true,
      recursive: true
    });
  }
});

test("account status does not reuse persisted ready cache with runtime service", async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-accounts-"));
  try {
    let opencodeReady = true;
    let runtimeStatusCalls = 0;
    const service = createService({
      agentRuntimeService: {
        async opencodeRuntimeStatus() {
          runtimeStatusCalls += 1;
          return {
            error: opencodeReady ? "" : "OpenCode server is not ready.",
            healthy: opencodeReady,
            ready: opencodeReady
          };
        }
      },
      readyStatusCacheRoot: path.join(targetRoot, "status-cache"),
      runToolchain: fakeRunToolchain,
      targetRoot
    });

    const first = await service.getStatus({
      refresh: true
    });
    assert.equal(first.ok, true);
    assert.equal(first.ready, true);
    assert.equal(runtimeStatusCalls, 1);

    opencodeReady = false;
    const second = await service.getStatus();
    assert.equal(second.ok, true);
    assert.equal(second.ready, false);
    assert.equal(second.ai.ready, false);
    assert.equal(runtimeStatusCalls, 2);
  } finally {
    await rm(targetRoot, {
      force: true,
      recursive: true
    });
  }
});

test("account readiness includes OpenCode provider status from the runtime service", async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-accounts-"));
  try {
    const service = createService({
      agentRuntimeService: {
        async opencodeRuntimeStatus() {
          return {
            connectedProviderCount: 1,
            connectedProviders: ["openai"],
            healthy: true,
            providers: [
              {
                connected: true,
                defaultModelId: "gpt-5",
                id: "openai",
                label: "OpenAI",
                modelCount: 1,
                models: [
                  {
                    id: "gpt-5",
                    label: "GPT-5"
                  }
                ]
              }
            ],
            ready: true,
            server: {
              url: "http://127.0.0.1:4096"
            },
            version: "1.15.13"
          };
        }
      },
      runToolchain: fakeRunToolchain,
      targetRoot
    });
    const status = await service.getStatus({
      refresh: true
    });

    const opencode = status.agentRuntimes.find((runtime) => runtime.id === "opencode");
    assert.equal(opencode.ready, true);
    assert.equal(opencode.connectedProviderCount, 1);
    assert.deepEqual(opencode.connectedProviders, ["openai"]);
    assert.equal(opencode.providers[0].defaultModelId, "gpt-5");
    assert.equal(opencode.version, "1.15.13");
  } finally {
    await rm(targetRoot, {
      force: true,
      recursive: true
    });
  }
});
