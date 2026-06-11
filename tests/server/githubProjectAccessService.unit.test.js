import assert from "node:assert/strict";
import test from "node:test";

import {
  createGithubProjectAccessService
} from "../../server/lib/githubProjectAccessService.js";
import { withTemporaryRoot } from "./vibe64TestHelpers.js";

test("GitHub identity sync returns a synthetic local user without tenant persistence", async () => {
  await withTemporaryRoot(async (root) => {
    const calls = [];
    let persisted = false;
    const service = createGithubProjectAccessService({
      auth: {
        runtimeProfile: {
          local: true,
          mode: "local"
        },
        users: {
          async updateGithubIdentity() {
            persisted = true;
            throw new Error("Local identity sync must not write tenant users.");
          }
        }
      },
      dataRoot: root,
      projectContext: {},
      runToolchain: async (args) => {
        calls.push(args);
        return {
          ok: true,
          stdout: JSON.stringify({
            avatar_url: "https://github.com/octocat.png",
            id: 123,
            login: "octocat"
          })
        };
      }
    });

    const user = await service.syncCurrentGithubIdentity({
      email: "local@vibe64.local",
      role: "owner",
      status: "active",
      supabaseUserId: "local:vibe64"
    });

    assert.deepEqual(calls, [
      ["gh", "api", "user"]
    ]);
    assert.equal(persisted, false);
    assert.equal(user.email, "local@vibe64.local");
    assert.equal(user.github.login, "octocat");
    assert.equal(user.github.id, 123);
  });
});

test("GitHub identity sync persists hosted tenant user identity", async () => {
  await withTemporaryRoot(async (root) => {
    const updates = [];
    const service = createGithubProjectAccessService({
      auth: {
        runtimeProfile: {
          local: false,
          mode: "hosted"
        },
        users: {
          async updateGithubIdentity(input, identity) {
            updates.push({
              identity,
              input
            });
            return {
              email: input.email,
              github: identity,
              role: "owner",
              status: "active"
            };
          }
        }
      },
      dataRoot: root,
      projectContext: {},
      runToolchain: async () => ({
        ok: true,
        stdout: JSON.stringify({
          avatar_url: "https://github.com/octocat.png",
          id: 123,
          login: "octocat"
        })
      })
    });

    const user = await service.syncCurrentGithubIdentity({
      email: "owner@example.com"
    });

    assert.equal(updates.length, 1);
    assert.deepEqual(updates[0].input, {
      email: "owner@example.com"
    });
    assert.equal(updates[0].identity.login, "octocat");
    assert.equal(user.github.login, "octocat");
  });
});
