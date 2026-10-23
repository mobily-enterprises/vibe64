// The person's publishing keys: an age file under their passphrase (readable by
// any age tool), 0600 in a 0700 folder, unlocked only for a window, with a
// plain index that never holds a value, and a recovery kit under a separate
// passphrase that restores every key. Everything lives in temporary folders.
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ageDecrypt, ageEncrypt, createAgeStore } from "../../packages/vibe64-packaging/src/server/keys/index.js";
import { createRecoveryKit, recoveryKitCovers, restoreRecoveryKit } from "../../packages/vibe64-publishing/src/server/credentials/recoveryKit.js";

const PASSPHRASE = "correct horse battery staple";
const KIT_PASSPHRASE = "a different kit passphrase";
const SECRET = "npm_TESTONLYTOKEN0123456789";

async function folder(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-publishing-keys-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("age files round-trip across chunk boundaries and refuse a wrong passphrase or a changed byte", async () => {
  for (const size of [0, 1, 64 * 1024, 64 * 1024 + 1, 150_000]) {
    const data = Buffer.alloc(size);
    for (let index = 0; index < size; index += 1) data[index] = index % 251;
    const sealed = await ageEncrypt(data, PASSPHRASE, { workFactor: 10 });
    assert.ok(sealed.subarray(0, 22).toString() === "age-encryption.org/v1\n");
    assert.ok((await ageDecrypt(sealed, PASSPHRASE)).equals(data), `${size} bytes`);
  }
  const sealed = await ageEncrypt("hello", PASSPHRASE, { workFactor: 10 });
  await assert.rejects(ageDecrypt(sealed, "not the passphrase"), { code: "vibe64_age_wrong_passphrase" });
  const changed = Buffer.from(sealed);
  changed[changed.length - 1] ^= 1;
  await assert.rejects(ageDecrypt(changed, PASSPHRASE), /changed or truncated/u);
  await assert.rejects(ageEncrypt("x", "short"), { code: "vibe64_age_passphrase_short" });
});

test("keys are sealed under the passphrase, private on disk, and readable only while unlocked", async (t) => {
  const root = await folder(t);
  let clock = Date.parse("2026-10-23T10:00:00Z");
  const store = createAgeStore({ directory: path.join(root, "keys"), workFactor: 10, now: () => clock });
  assert.equal((await store.status()).exists, false);
  await store.create({ passphrase: PASSPHRASE, windowMs: 60_000 });
  await store.put("account:npm-main", { value: SECRET, kind: "account", label: "npm (local)", meta: { accountKind: "npm", address: "http://127.0.0.1:4873/", token: 12 } });
  assert.equal(store.read("account:npm-main").toString(), SECRET);

  const directory = await stat(path.join(root, "keys"));
  assert.equal(directory.mode & 0o777, 0o700);
  for (const name of await readdir(path.join(root, "keys"))) {
    const file = path.join(root, "keys", name);
    assert.equal((await stat(file)).mode & 0o777, 0o600, `${name} is private`);
    assert.equal((await readFile(file)).includes(SECRET), false, `${name} never holds the value in the clear`);
  }
  const status = await store.status();
  assert.deepEqual(status.entries.map(({ id, label, accountKind }) => [id, label, accountKind]), [["account:npm-main", "npm (local)", "npm"]]);
  assert.equal(JSON.stringify(status).includes(SECRET), false);
  assert.ok((await ageDecrypt(await readFile(store.file), PASSPHRASE)).toString().includes(Buffer.from(SECRET).toString("base64")), "any age tool can open the file");

  clock += 61_000;
  assert.equal((await store.status()).unlocked, false, "the unlock window ends by itself");
  assert.throws(() => store.read("account:npm-main"), { code: "vibe64_publishing_keys_locked" });
  await assert.rejects(store.unlock({ passphrase: "the wrong passphrase" }), { code: "vibe64_age_wrong_passphrase" });
  await store.unlock({ passphrase: PASSPHRASE, windowMs: 60_000 });
  assert.equal(store.read("account:npm-main").toString(), SECRET);
  await store.lock();
  assert.equal(store.isUnlocked(), false);
  await assert.rejects(store.create({ passphrase: PASSPHRASE }), { code: "vibe64_publishing_keys_exist" });
});

test("a recovery kit restores every key on a new computer and tells whether it covers a key", async (t) => {
  const root = await folder(t);
  const store = createAgeStore({ directory: path.join(root, "old"), workFactor: 10 });
  await store.create({ passphrase: PASSPHRASE });
  await store.put("android-sideload:app", { value: Buffer.from([1, 2, 3, 250]), kind: "android-sideload-key", label: "Install key for Notes", meta: { certificateSha256: "ab".repeat(32) } });
  assert.equal(recoveryKitCovers(await store.status(), "android-sideload:app"), false, "no kit yet");
  await assert.rejects(createRecoveryKit({ store, passphrase: "short" }), { code: "vibe64_age_passphrase_short" });
  const kit = await createRecoveryKit({ store, passphrase: KIT_PASSPHRASE, workFactor: 10 });
  assert.match(kit.fileName, /^vibe64-publishing-recovery-kit-\d{4}-\d{2}-\d{2}\.age$/u);
  assert.equal(recoveryKitCovers(await store.status(), "android-sideload:app"), true);
  await assert.rejects(ageDecrypt(kit.bytes, PASSPHRASE), { code: "vibe64_age_wrong_passphrase" }, "the kit has its own passphrase");

  const fresh = createAgeStore({ directory: path.join(root, "new"), workFactor: 10 });
  await fresh.create({ passphrase: "a brand new passphrase" });
  await assert.rejects(restoreRecoveryKit({ store: fresh, bytes: kit.bytes, passphrase: PASSPHRASE }), { code: "vibe64_age_wrong_passphrase" });
  const restored = await restoreRecoveryKit({ store: fresh, bytes: kit.bytes, passphrase: KIT_PASSPHRASE });
  assert.deepEqual(restored.restored, ["android-sideload:app"]);
  assert.deepEqual([...fresh.read("android-sideload:app")], [1, 2, 3, 250]);
  assert.equal((await fresh.status()).entries[0].certificateSha256, "ab".repeat(32));

  await new Promise((resolve) => setTimeout(resolve, 5));
  await store.put("android-sideload:app", { value: "replaced", kind: "android-sideload-key", label: "Install key for Notes" });
  assert.equal(recoveryKitCovers(await store.status(), "android-sideload:app"), false, "a replaced key needs a new kit");
});
