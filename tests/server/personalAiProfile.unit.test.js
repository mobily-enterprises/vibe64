import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createPersonalAiProfileStore
} from "../../packages/vibe64-core/src/server/personalAiProfile.js";

test("personal AI profile persists one installation-wide preferred name privately", async (t) => {
  const systemRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-personal-profile-"));
  t.after(() => rm(systemRoot, { force: true, recursive: true }));
  const store = createPersonalAiProfileStore({ systemRoot });

  assert.deepEqual(await store.read(), {
    preferredName: "",
    version: 1
  });

  assert.deepEqual(await store.write({ preferredName: "  Ada   Lovelace  " }), {
    preferredName: "Ada Lovelace",
    version: 1
  });
  assert.deepEqual(await createPersonalAiProfileStore({ systemRoot }).read(), {
    preferredName: "Ada Lovelace",
    version: 1
  });
  assert.equal((await stat(store.filePath)).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(await readFile(store.filePath, "utf8")), {
    preferredName: "Ada Lovelace",
    version: 1
  });
});

test("personal AI profile validates preferred-name content by Unicode character", async (t) => {
  const systemRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-personal-profile-"));
  t.after(() => rm(systemRoot, { force: true, recursive: true }));
  const store = createPersonalAiProfileStore({ systemRoot });

  await assert.doesNotReject(store.write({ preferredName: "😀".repeat(80), version: 1 }));
  await assert.rejects(
    store.write({ preferredName: "😀".repeat(81), version: 1 }),
    { code: "vibe64_preferred_name_too_long", statusCode: 422, params: { limit: 80 } }
  );
  await assert.rejects(
    store.write({ preferredName: "Ada\u0000", version: 1 }),
    { code: "vibe64_preferred_name_invalid", statusCode: 422 }
  );
  await assert.rejects(
    store.write({ preferredName: "Ada", version: 2 }),
    { code: "vibe64_personal_ai_profile_version_unsupported" }
  );
});
