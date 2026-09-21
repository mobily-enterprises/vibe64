import assert from "node:assert/strict";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
  assert.equal(parsePasswdLine("ada:x::1001:Ada:/home/ada:/bin/bash"), null);
  assert.equal(parsePasswdLine("ada:x:1001:0x10:Ada:/home/ada:/bin/bash"), null);
});

test("OS user resolver uses getent passwd for the named OS user", async () => {
  const user = await resolveOsUser("ada", {
    readFileFn: async () => "",
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

test("local OS identity stays fresh without spawning a process, including after atomic replacement", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-os-identity-"));
  try {
    const passwd = path.join(root, "passwd");
    await writeFile(path.join(root, "nsswitch.conf"), "passwd: files systemd\n");
    await writeFile(passwd, "ada:x:1001:1001:Ada Lovelace:/home/ada:/bin/bash\n");
    let spawns = 0;
    const options = {
      platform: "linux",
      readFileFn: (file, encoding) => readFile(path.join(root, path.basename(file)), encoding),
      execFileFn: async () => {
        spawns += 1;
        return { stdout: "" };
      }
    };
    const users = await Promise.all(Array.from({ length: 40 }, () => resolveOsUser("ada", options)));
    assert.ok(users.every((user) => user.uid === 1001));
    assert.equal(spawns, 0);
    await writeFile(`${passwd}.new`, "ada:x:2001:2002:Updated:/srv/ada:/bin/zsh\n");
    await rename(`${passwd}.new`, passwd);
    assert.deepEqual(await resolveOsUser("ada", options), {
      displayName: "Updated", gid: 2002, home: "/srv/ada", shell: "/bin/zsh", uid: 2001, username: "ada"
    });
    assert.equal(spawns, 0);
    await writeFile(`${passwd}.new`, "");
    await rename(`${passwd}.new`, passwd);
    await assert.rejects(resolveOsUser("ada", options), { code: "vibe64_os_user_not_found" });
    assert.equal(spawns, 1);
    await writeFile(passwd, "ada:x:2001:2002:Updated:/srv/ada:/bin/zsh\n");
    await writeFile(path.join(root, "nsswitch.conf"), "passwd: sss files\n");
    await assert.rejects(resolveOsUser("ada", options), { code: "vibe64_os_user_not_found" });
    assert.equal(spawns, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("OS lookup preserves NSS precedence and actions instead of overriding them with a local record", async () => {
  for (const config of [
    "passwd: sss files\n",
    "passwd: compat\n",
    "passwd: files [SUCCESS=continue] systemd\n",
    "passwd: files [!NOTFOUND=continue] systemd\n",
    "passwd: files\\\n [SUCCESS=continue] systemd\n",
    "passwd: files\npasswd: sss\n",
    "# passwd: files\n"
  ]) {
    let spawns = 0;
    const user = await resolveOsUser("ada", {
      platform: "linux",
      readFileFn: async (file) => file === "/etc/nsswitch.conf"
        ? config : "ada:x:1001:1001:Local:/home/local:/bin/bash\n",
      execFileFn: async () => {
        spawns += 1;
        return { stdout: "ada:x:3001:3002:Directory:/home/directory:/bin/bash\n" };
      }
    });
    assert.equal(user.uid, 3001, config);
    assert.equal(spawns, 1, config);
  }
});

test("OS lookup delegates absent users, unavailable files, and non-Linux systems to getent", async () => {
  for (const scenario of ["absent", "bad-record", "config-error", "passwd-error", "non-linux"]) {
    let spawns = 0;
    const user = await resolveOsUser("ada", {
      platform: scenario === "non-linux" ? "freebsd" : "linux",
      readFileFn: async (file) => {
        assert.notEqual(scenario, "non-linux");
        if ((scenario === "config-error" && file === "/etc/nsswitch.conf") ||
            (scenario === "passwd-error" && file === "/etc/passwd")) throw new Error("unreadable");
        if (file === "/etc/nsswitch.conf") return "passwd: files systemd\n";
        return scenario === "bad-record" ? "ada:x:invalid:1001:Ada:/home/ada:/bin/bash\n" : "";
      },
      execFileFn: async (command, args) => {
        assert.equal(command, "getent");
        assert.deepEqual(args, ["passwd", "ada"]);
        spawns += 1;
        return { stdout: "ada:x:3001:3002:Directory:/home/ada:/bin/bash\n" };
      }
    });
    assert.equal(user.uid, 3001, scenario);
    assert.equal(spawns, 1, scenario);
  }
});

test("numeric lookup keys keep getent's UID interpretation", async () => {
  await assert.rejects(resolveOsUser("1001", {
    platform: "linux",
    readFileFn: async () => { throw new Error("must use NSS"); },
    execFileFn: async () => ({ stdout: "ada:x:1001:1001:Ada:/home/ada:/bin/bash\n" })
  }), { code: "vibe64_os_user_not_found" });
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
