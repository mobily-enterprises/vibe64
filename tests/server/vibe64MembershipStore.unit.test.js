import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createVibe64MembershipStore,
  membershipRootFromDaemonStateRoot
} from "../../packages/vibe64-core/src/server/vibe64MembershipStore.js";

test("membership root is derived from daemon state root", () => {
  assert.equal(
    membershipRootFromDaemonStateRoot("/home/owner/.local/state/vibe64"),
    "/home/owner/.local/state/vibe64/users"
  );
});

test("membership files store only Vibe64 metadata keyed by OS username", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-membership-"));
  const resolvedUsers = [];
  const store = createVibe64MembershipStore({
    membershipRoot: root,
    async osUserResolver(username) {
      resolvedUsers.push(username);
      return {
        gid: 1001,
        home: `/home/${username}`,
        shell: "/bin/bash",
        uid: 1001,
        username
      };
    }
  });

  const user = await store.enableUser("ada", {
    role: "owner"
  });

  assert.equal(user.username, "ada");
  assert.equal(user.role, "owner");
  assert.equal(user.status, "active");
  assert.deepEqual(resolvedUsers, ["ada"]);
  assert.equal(Object.hasOwn(user, "uid"), false);
  assert.equal(Object.hasOwn(user, "gid"), false);
  assert.equal(Object.hasOwn(user, "home"), false);
  assert.equal(Object.hasOwn(user, "shell"), false);
});

test("membership requires explicit active enablement", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-membership-"));
  const store = createVibe64MembershipStore({
    membershipRoot: root
  });

  await assert.rejects(
    () => store.requireActiveUser("ada"),
    /OS user is not enabled for Vibe64/u
  );

  await store.enableUser("ada");
  assert.equal((await store.requireActiveUser("ada")).username, "ada");
});
