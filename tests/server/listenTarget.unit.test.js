import assert from "node:assert/strict";
import { chmod, lstat, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { configureVibe64Host } from "../../packages/vibe64-execution/src/server/hostProfile.js";
import { prepareListenSocket, resolveListenTarget } from "../../server/lib/listenTarget.js";

test("only the shared temporary fallback socket folder must be checked as this user's own", () => {
  const fallback = resolveListenTarget({ env: { PORT: "", XDG_RUNTIME_DIR: "" } });
  assert.equal(fallback.privateDirectory, path.dirname(fallback.socketPath));
  assert.equal(path.dirname(fallback.privateDirectory), path.resolve(tmpdir()));
  const runtimeDir = resolveListenTarget({ env: { PORT: "", XDG_RUNTIME_DIR: "/run/user/1000" } });
  assert.equal(runtimeDir.privateDirectory, undefined);
  const configured = resolveListenTarget({ env: { PORT: "", XDG_RUNTIME_DIR: "" }, options: { listenSocket: "/srv/vibe64/server.sock" } });
  assert.equal(configured.privateDirectory, undefined);
});

test("the fallback socket folder refuses one another account could write to or a link", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-listen-folder-"));
  t.after(async () => {
    configureVibe64Host(null);
    await rm(root, { force: true, recursive: true });
  });
  const prepare = (directory) => prepareListenSocket(path.join(directory, "server.sock"), { privateDirectory: directory });

  const fresh = path.join(root, "fresh");
  await prepare(fresh);
  assert.equal((await lstat(fresh)).mode & 0o777, 0o700, "a new folder is this user's only");
  await prepare(fresh);

  const open = path.join(root, "open");
  await mkdir(open);
  await chmod(open, 0o777);
  await assert.rejects(prepare(open), { code: "vibe64_listen_socket_directory_unsafe" });

  const groupWritable = path.join(root, "group");
  await mkdir(groupWritable);
  await chmod(groupWritable, 0o770);
  await assert.rejects(prepare(groupWritable), { code: "vibe64_listen_socket_directory_unsafe" });
  // A host whose accounts share files through a group keeps its group folder.
  configureVibe64Host({ sharedGroupAccess: true });
  await prepare(groupWritable);
  configureVibe64Host(null);

  const link = path.join(root, "link");
  await symlink(fresh, link);
  await assert.rejects(prepare(link), { code: "vibe64_listen_socket_directory_unsafe" });
});
