import assert from "node:assert/strict";
import test from "node:test";

import {
  listOsUsers,
  osUserEligibility,
  parsePasswdLine,
  resolveOsUser
} from "../../packages/vibe64-core/src/server/osUserIdentity.js";

test("OS user identity parses passwd records without inventing Vibe64 identity", () => {
  assert.deepEqual(parsePasswdLine("ada:x:1001:1001:Ada Lovelace:/home/ada:/bin/bash"), {
    displayName: "Ada Lovelace",
    gid: 1001,
    home: "/home/ada",
    shell: "/bin/bash",
    uid: 1001,
    username: "ada"
  });
});

test("OS user resolver uses getent passwd for the named OS user", async () => {
  const user = await resolveOsUser("ada", {
    async execFileFn(command, args) {
      assert.equal(command, "getent");
      assert.deepEqual(args, ["passwd", "ada"]);
      return {
        stdout: "ada:x:1001:1001:Ada Lovelace:/home/ada:/bin/bash\n"
      };
    }
  });

  assert.equal(user.username, "ada");
  assert.equal(user.home, "/home/ada");
});

test("OS user listing sorts parsed passwd records", async () => {
  const users = await listOsUsers({
    async execFileFn(command, args) {
      assert.equal(command, "getent");
      assert.deepEqual(args, ["passwd"]);
      return {
        stdout: [
          "grace:x:1002:1002:Grace Hopper:/home/grace:/bin/bash",
          "ada:x:1001:1001:Ada Lovelace:/home/ada:/bin/bash"
        ].join("\n")
      };
    }
  });

  assert.deepEqual(users.map((user) => user.username), ["ada", "grace"]);
});

test("OS user eligibility rejects obvious service accounts without treating UID as identity", () => {
  assert.deepEqual(osUserEligibility({
    home: "/home/deploybot",
    shell: "/bin/bash",
    uid: 1003,
    username: "deploybot"
  }), {
    eligible: true,
    reasons: []
  });

  assert.deepEqual(osUserEligibility({
    home: "/nonexistent",
    shell: "/usr/sbin/nologin",
    uid: 1003,
    username: "www-data"
  }), {
    eligible: false,
    reasons: ["non_login_shell", "obvious_service_account"]
  });
});
