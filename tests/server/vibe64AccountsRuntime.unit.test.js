import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  VIBE64_PROVIDER_HOMES_ROOT_ENV,
  VIBE64_SYSTEM_ROOT_ENV,
  VIBE64_TARGET_ROOT_ENV
} from "@local/vibe64-core/server/studioRoots";
import {
  Vibe64AccountsProvider
} from "../../packages/vibe64-accounts/src/server/Vibe64AccountsProvider.js";
import {
  VIBE64_ACCOUNTS_SERVICE
} from "../../packages/vibe64-accounts/src/server/service.js";

async function withTempDir(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-accounts-runtime-"));
  try {
    return await callback(root);
  } finally {
    await rm(root, {
      force: true,
      recursive: true
    });
  }
}

async function writeReadyLocalAccounts(providerHomesRoot) {
  await mkdir(path.join(providerHomesRoot, "codex"), {
    recursive: true
  });
  await writeFile(
    path.join(providerHomesRoot, "codex", "status.json"),
    `${JSON.stringify({
      connected: true,
      updatedAt: "2026-06-17T00:00:00.000Z",
      version: 1
    }, null, 2)}\n`,
    "utf8"
  );

  const githubHome = path.join(providerHomesRoot, "github", "local");
  await mkdir(path.join(githubHome, ".config", "gh"), {
    recursive: true
  });
  await writeFile(
    path.join(githubHome, ".config", "gh", "hosts.yml"),
    [
      "github.com:",
      "    users:",
      "        local-user:",
      "            oauth_token: test-token",
      "    git_protocol: https",
      "    oauth_token: test-token",
      "    user: local-user",
      ""
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    path.join(githubHome, ".gitconfig"),
    [
      "[credential \"https://github.com\"]",
      "\thelper = ",
      "\thelper = !/usr/bin/gh auth git-credential",
      "[user]",
      "\tname = Local User",
      "\temail = local@example.test",
      ""
    ].join("\n"),
    "utf8"
  );
}

function withEnv(values, callback) {
  const previous = new Map();
  for (const key of Object.keys(values)) {
    previous.set(key, process.env[key]);
    if (values[key] == null) {
      delete process.env[key];
    } else {
      process.env[key] = values[key];
    }
  }
  try {
    return callback();
  } finally {
    for (const [key, value] of previous) {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function createProviderApp({
  env = null
} = {}) {
  const services = new Map();
  return {
    actions() {},
    has(token) {
      return token === "jskit.env" && env !== null;
    },
    make(token) {
      if (token === "jskit.env" && env !== null) {
        return env;
      }
      throw new Error(`Unexpected app lookup: ${token}`);
    },
    service(id, factory) {
      services.set(id, factory);
    },
    services
  };
}

function accountServiceScope() {
  return {
    has() {
      return false;
    },
    make(id) {
      if (id === "feature.vibe64-project.service") {
        return {
          currentTargetRoot() {
            return "";
          }
        };
      }
      throw new Error(`Unexpected service lookup: ${id}`);
    }
  };
}

test("accounts provider captures local account roots before lazy service creation", async () => {
  await withTempDir(async (root) => {
    const systemRoot = path.join(root, "system");
    const providerHomesRoot = path.join(systemRoot, "provider-homes");
    const targetRoot = path.join(root, "target");
    const wrongRoot = path.join(root, "wrong-provider-homes");
    await mkdir(targetRoot, {
      recursive: true
    });
    await writeReadyLocalAccounts(providerHomesRoot);

    const app = createProviderApp();

    await withEnv({
      [VIBE64_PROVIDER_HOMES_ROOT_ENV]: providerHomesRoot,
      [VIBE64_SYSTEM_ROOT_ENV]: systemRoot,
      [VIBE64_TARGET_ROOT_ENV]: targetRoot
    }, () => {
      new Vibe64AccountsProvider().register(app);
    });

    const serviceFactory = app.services.get(VIBE64_ACCOUNTS_SERVICE);
    assert.equal(typeof serviceFactory, "function");

    const service = await withEnv({
      [VIBE64_PROVIDER_HOMES_ROOT_ENV]: wrongRoot,
      [VIBE64_SYSTEM_ROOT_ENV]: path.join(root, "wrong-system"),
      [VIBE64_TARGET_ROOT_ENV]: path.join(root, "wrong-target")
    }, () => serviceFactory(accountServiceScope()));

    const status = await service.getStatus({});
    assert.equal(status.ok, true);
    assert.equal(status.ready, true);
    assert.equal(status.accounts.find((account) => account.id === "github")?.username, "local-user");
    assert.equal(status.accounts.find((account) => account.id === "codex")?.connected, true);
    assert.equal(status.targetRoot, targetRoot);
  });
});

test("accounts provider reads local account roots from JSKIT runtime env", async () => {
  await withTempDir(async (root) => {
    const systemRoot = path.join(root, "system");
    const providerHomesRoot = path.join(systemRoot, "provider-homes");
    const targetRoot = path.join(root, "target");
    await mkdir(targetRoot, {
      recursive: true
    });
    await writeReadyLocalAccounts(providerHomesRoot);

    const app = createProviderApp({
      env: {
        [VIBE64_PROVIDER_HOMES_ROOT_ENV]: providerHomesRoot,
        [VIBE64_SYSTEM_ROOT_ENV]: systemRoot,
        [VIBE64_TARGET_ROOT_ENV]: targetRoot
      }
    });

    await withEnv({
      [VIBE64_PROVIDER_HOMES_ROOT_ENV]: null,
      [VIBE64_SYSTEM_ROOT_ENV]: null,
      [VIBE64_TARGET_ROOT_ENV]: null
    }, () => {
      new Vibe64AccountsProvider().register(app);
    });

    const serviceFactory = app.services.get(VIBE64_ACCOUNTS_SERVICE);
    assert.equal(typeof serviceFactory, "function");

    const service = await withEnv({
      [VIBE64_PROVIDER_HOMES_ROOT_ENV]: null,
      [VIBE64_SYSTEM_ROOT_ENV]: null,
      [VIBE64_TARGET_ROOT_ENV]: null
    }, () => serviceFactory(accountServiceScope()));

    const status = await service.getStatus({});
    assert.equal(status.ok, true);
    assert.equal(status.ready, true);
    assert.equal(status.accounts.find((account) => account.id === "github")?.username, "local-user");
    assert.equal(status.accounts.find((account) => account.id === "codex")?.connected, true);
    assert.equal(status.targetRoot, targetRoot);
  });
});
