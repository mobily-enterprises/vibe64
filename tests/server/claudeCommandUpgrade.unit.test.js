import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";
import { upgradeClaudeCommandMessages } from "../../packages/vibe64-terminals/src/server/assistantClaudeCommandUpgrade.js";
import { assistantGoalManagementMessage } from "@local/vibe64-runtime/shared/assistantRouting";

const nativeId = "c117ec52-748a-4b8a-8a1b-d70653ab3732";
const commandId = "8d9f8b5f-81a2-4a08-a0ee-bf2e0ed1160b";
const commandText = "Goal cleared: [Vibe64 role: Junior. Older generated instructions.]\n\nSmash all outstanding items";
const native = { engineId: "claude", type: "system", subtype: "local_command", command: "goal", output: "stdout" };
const exec = promisify(execFile);

async function fixture(t, kind = "main") {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-command-upgrade-"));
  const systemRoot = path.join(root, "state"), workdir = path.join(root, "source"), configRoot = path.join(root, "claude");
  await mkdir(workdir);
  const previousConfig = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = configRoot;
  t.after(async () => {
    if (previousConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previousConfig;
    await rm(root, { recursive: true, force: true });
  });
  const projectRuntimeRoot = path.join(systemRoot, "projects", "example");
  const store = createVibe64SessionStore({ projectContextRoot: root, projectRuntimeRoot });
  await store.createSession({ sessionId: "one", runtimeKind: "genesis" });
  await store.writeMetadataValue("one", "source_path", workdir);
  await store.writeMetadataValue("one", "claude_conversation_id", nativeId);
  await store.writeMetadataValue("one", `claude_conversation_${nativeId}`, JSON.stringify({ nativeWorkdir: workdir }));
  let logRoot = store.paths("one").conversationLogRoot;
  if (kind === "temporary") {
    await store.writeSessionConversation("one", "temporary", { providerConversationId: nativeId,
      assistantSelection: { engineId: "claude" }, nativeBindings: {} });
    logRoot = path.join(store.paths("one").conversationsRoot, "temporary/conversation-log");
  }
  await mkdir(logRoot, { recursive: true });
  const file = path.join(logRoot, "transcript.json");
  const message = { messageId: `claude_${commandId}_0`, role: "assistant", text: commandText,
    at: "2026-10-16T02:00:56.166Z", receipt: true, data: { retained: "application data" } };
  const document = { version: 1, metadata: { retained: true }, rewound: [], extra: "preserved",
    turns: [["000001", { metadata: { engineId: "claude", receipt: "accepted" }, messages: [message,
      { ...message, messageId: "claude_authored_0", text: "Goal cleared: This is my explanation", data: undefined },
      { ...message, messageId: "claude_error_0", text: "Cannot change goal", data: undefined }
    ] }]] };
  const original = JSON.stringify(document, null, 2) + "\n";
  await writeFile(file, original);
  const nativePath = path.join(configRoot, "projects", workdir.replace(/[^a-zA-Z0-9]/gu, "-"), `${nativeId}.jsonl`);
  await mkdir(path.dirname(nativePath), { recursive: true });
  const nativeBytes = [
    { type: "system", subtype: "local_command", uuid: commandId, commandRun: { command: "goal", args: "clear" },
      content: `<local-command-stdout>${commandText}</local-command-stdout>` },
    { type: "system", subtype: "local_command", uuid: "error", commandRun: { command: "goal", args: "clear" },
      content: "<local-command-stderr>Cannot change goal</local-command-stderr>" }
  ].map(JSON.stringify).join("\n") + "\n";
  await writeFile(nativePath, nativeBytes);
  const backupRoot = path.join(systemRoot, "upgrades/backups/20261016-claude-command-messages");
  const reports = [];
  const context = { systemRoot, backupRoot, report: (level, message) => reports.push({ level, message }) };
  return { root, systemRoot, store, file, original, document: JSON.parse(original), nativePath, nativeBytes, backupRoot, reports,
    upgrade: (apply = false, report = context.report) => upgradeClaudeCommandMessages({ ...context, apply, report }) };
}

for (const kind of ["main", "temporary", "closing", "archived", "prepared"])
  test(`Claude command repair preserves history and uses the session inventory: ${kind}`, async t => {
    const f = await fixture(t, kind);
    let file = f.file;
    if (kind === "closing") {
      const root = path.join(f.store.paths().closingSessionsRoot, "one");
      await mkdir(path.dirname(root), { recursive: true });
      await rename(f.store.paths("one").sessionRoot, root);
      file = path.join(root, "conversation-log/transcript.json");
    } else if (["archived", "prepared"].includes(kind)) {
      await f.store.writeStatus("one", "archived");
      await f.store.publishSessionArchive("one");
      file = path.join(f.store.paths().archivedSessionsRoot, "one.tar.gz");
      if (kind === "prepared") {
        const prepared = path.join(f.store.paths().archivedSessionsRoot, ".renewals/checkpoint");
        await mkdir(prepared, { recursive: true });
        for (const suffix of [".tar.gz", ".json"]) await copyFile(file.replace(/\.tar\.gz$/u, suffix), path.join(prepared, `one${suffix}`));
      }
    }
    const before = await readFile(file);
    await f.upgrade();
    assert.deepEqual(await readFile(file), before);
    await assert.rejects(readFile(path.join(f.backupRoot, "manifest.json")), { code: "ENOENT" });
    await f.upgrade(true);
    const backup = path.join(f.backupRoot, "before", path.relative(f.systemRoot, file));
    assert.deepEqual(await readFile(backup), before);
    let updated;
    if (["archived", "prepared"].includes(kind)) updated = await f.store.withReadableSessionPaths("one",
      paths => readFile(path.join(paths.conversationLogRoot, "transcript.json"), "utf8").then(JSON.parse));
    else updated = JSON.parse(await readFile(file, "utf8"));
    const messages = updated.turns[0][1].messages;
    if (kind === "prepared") {
      const archive = path.join(f.store.paths().archivedSessionsRoot, ".renewals/checkpoint/one.tar.gz");
      const members = (await exec("tar", ["-tzf", archive])).stdout.split("\n");
      const member = members.find(name => name.endsWith("/conversation-log/transcript.json"));
      assert.ok(member);
      assert.deepEqual(JSON.parse((await exec("tar", ["-xOf", archive, member])).stdout), updated);
    }
    assert.deepEqual(messages[0].data, { retained: "application data", native });
    assert.equal(messages[1].data, undefined);
    assert.equal(messages[2].data.native.output, "stderr");
    assert.equal(assistantGoalManagementMessage(messages[0]), true);
    assert.equal(assistantGoalManagementMessage(messages[1], { metadata: { engineId: "claude" } }), false);
    assert.equal(assistantGoalManagementMessage(messages[2]), false);
    delete messages[0].data.native;
    delete messages[2].data;
    assert.deepEqual(updated, f.document);
    assert.equal(await readFile(f.nativePath, "utf8"), f.nativeBytes);
    const after = await readFile(file);
    await f.upgrade(true);
    assert.deepEqual(await readFile(file), after);
  });

test("Claude command repair refuses conflicting identity/text and warns without guessing when history is missing", async t => {
  const f = await fixture(t);
  const changed = structuredClone(f.document);
  changed.turns[0][1].messages[0].text += " changed";
  await writeFile(f.file, JSON.stringify(changed));
  await assert.rejects(f.upgrade(true), /evidence conflicts/);
  assert.deepEqual(JSON.parse(await readFile(f.file)), changed);
  await assert.rejects(readFile(path.join(f.backupRoot, "manifest.json")), { code: "ENOENT" });
  await writeFile(f.file, f.original);
  await rm(f.nativePath);
  await f.upgrade(true);
  assert.equal(await readFile(f.file, "utf8"), f.original);
  assert.ok(f.reports.some(value => value.level === "warning" && value.message.includes("unavailable")));
});

test("interrupted command repair keeps immutable backups and resumes exact prepared output", async t => {
  const f = await fixture(t);
  await assert.rejects(f.upgrade(true, (_level, message) => {
    if (message.startsWith("Published state:")) throw new Error("interrupted");
  }), /interrupted/);
  const backup = path.join(f.backupRoot, "before", path.relative(f.systemRoot, f.file));
  assert.equal(await readFile(backup, "utf8"), f.original);
  await f.upgrade(true);
  assert.deepEqual(JSON.parse(await readFile(f.file)).turns[0][1].messages[0].data.native, native);
  await writeFile(f.file, "external change");
  await assert.rejects(f.upgrade(true), /differs from both upgrade copies/);
  assert.equal(await readFile(backup, "utf8"), f.original);
});

test("already proven synthetic command messages remain unchanged", async t => {
  const f = await fixture(t);
  const document = structuredClone(f.document);
  document.turns[0][1].messages[0].data.native = { engineId: "claude", type: "assistant", command: "goal", output: "stdout" };
  document.turns[0][1].messages[2].data = { native: { engineId: "claude", type: "assistant", command: "goal", output: "stderr" } };
  const before = JSON.stringify(document);
  await writeFile(f.file, before);
  await f.upgrade(true);
  assert.equal(await readFile(f.file, "utf8"), before);
  await assert.rejects(readFile(path.join(f.backupRoot, "manifest.json")), { code: "ENOENT" });
});

test("older local-command subtype data is retained while exact command proof is added", async t => {
  const f = await fixture(t);
  f.document.turns[0][1].messages[0].data.native = { engineId: "claude", type: "system", subtype: "local_command_output", retained: "native detail" };
  await writeFile(f.file, JSON.stringify(f.document));
  await f.upgrade(true);
  const message = JSON.parse(await readFile(f.file)).turns[0][1].messages[0];
  assert.deepEqual(message.data.native, { engineId: "claude", type: "system", subtype: "local_command_output", retained: "native detail", command: "goal", output: "stdout" });
  assert.equal(assistantGoalManagementMessage(message), true);
});

for (const defect of ["duplicate identity", "malformed transcript", "symlink", "incomplete native history"])
  test(`command repair refuses unsafe evidence before backup or publication: ${defect}`, async t => {
    const f = await fixture(t);
    if (defect === "duplicate identity") {
      f.document.turns[0][1].messages.push(f.document.turns[0][1].messages[0]);
      await writeFile(f.file, JSON.stringify(f.document));
    } else if (defect === "malformed transcript") await writeFile(f.file, "invalid json");
    else if (defect === "symlink") {
      const outside = path.join(f.root, "outside.json");
      await rename(f.file, outside);
      await symlink(outside, f.file);
    } else await writeFile(f.nativePath, f.nativeBytes + '{"type":');
    const before = await readFile(f.file);
    await assert.rejects(f.upgrade(true), /conflicts|valid JSON|symbolic link|incomplete/);
    assert.deepEqual(await readFile(f.file), before);
    await assert.rejects(readFile(path.join(f.backupRoot, "manifest.json")), { code: "ENOENT" });
  });
