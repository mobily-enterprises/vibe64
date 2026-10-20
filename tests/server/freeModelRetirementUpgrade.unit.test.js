import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { retireFreeModelRouting } from "../../packages/vibe64-accounts/src/server/freeModelRetirementUpgrade.js";

const selection = (engineId, modelProviderId, modelId) => ({ schema: "vibe64.assistant-selection.v1", engineId, agentId: "build",
  modelProviderId, modelId, variantId: "", catalogRevision: `sha256:${"a".repeat(64)}`, selectionSource: "recommended" });

test("routing roles on the retired free model become unset with read-only check, backup and retry", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "free-model-routing-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const systemRoot = path.join(root, "state");
  const backupRoot = path.join(systemRoot, "upgrades/backups/20261022-free-model-retirement/routing");
  const reports = [];
  const run = apply => retireFreeModelRouting({ systemRoot, backupRoot, apply, report: (level, message) => reports.push({ level, message }) });
  await run(true);
  await assert.rejects(stat(systemRoot), { code: "ENOENT" }, "a new installation has nothing to retire");
  const pickle = selection("opencode", "opencode", "big-pickle");
  const glm = selection("opencode", "zai", "glm-4.7-flash");
  const sol = selection("codex", "openai", "gpt-6-sol");
  const file = path.join(systemRoot, "ai-connections/routing.json");
  await mkdir(path.dirname(file), { recursive: true });
  const saved = { schemaVersion: 4, revision: 7, orchestrators: {
    opencode: { senior: pickle, junior: pickle, helper: null, router: pickle, sharedBackup: pickle },
    codex: { senior: sol, junior: sol, helper: pickle, router: glm }
  } };
  await writeFile(file, JSON.stringify(saved));
  const before = await readFile(file, "utf8");
  await run(false);
  assert.equal(await readFile(file, "utf8"), before, "check writes nothing");
  await run(true);
  const upgraded = JSON.parse(await readFile(file, "utf8"));
  assert.equal(upgraded.revision, 8);
  assert.deepEqual(upgraded.orchestrators, { opencode: { helper: null }, codex: { senior: sol, junior: sol, router: glm } },
    "an explicitly disabled role stays disabled; other models are kept");
  assert.equal(await readFile(path.join(backupRoot, "before/ai-connections/routing.json"), "utf8"), before);
  await run(true);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), upgraded, "retry changes nothing more");
  await writeFile(file, JSON.stringify({ schemaVersion: 1, revision: 1, orchestrators: {} }));
  await retireFreeModelRouting({ systemRoot, backupRoot: path.join(systemRoot, "upgrades/backups/other"), apply: false,
    report: (level, message) => reports.push({ level, message }) });
  assert.ok(reports.some(({ message }) => /Earlier upgrades will prepare/u.test(message)));
});
