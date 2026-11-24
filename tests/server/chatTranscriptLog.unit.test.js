import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";

const exec = promisify(execFile);
const at = (turn, second = 0) => new Date(Date.UTC(2026, 9, 1) + turn * 60_000 + second * 1000).toISOString();
const upgradeId = "20261124-chat-transcript-log";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-chat-log-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const systemRoot = path.join(root, "state");
  const createStore = () => createVibe64SessionStore({ projectContextRoot: root, projectRuntimeRoot: path.join(systemRoot, "projects/example") });
  const store = createStore();
  return { root, systemRoot, store, createStore, backupRoot: path.join(systemRoot, "upgrades/backups", upgradeId) };
}

function text(seed, length) {
  const words = ["session", "transcript", "append", "turn", "commentary", "review", "plan", "commit", "branch", "deploy"];
  let value = "";
  for (let index = seed; value.length < length; index += 7) value += `${words[index % words.length]} `;
  return value.slice(0, length);
}

// A realistic turn through the store's own transaction: a request, progress notes, a thinking note, a reply and its status.
async function appendTurn(tx, index) {
  const id = await tx.nextTurnId();
  await tx.appendMessage(id, { role: "user", text: text(index, 420), messageId: `user-${index}`, at: at(index),
    turnMetadata: { actorDisplayName: "Ada", actorId: "ada", engineId: "codex" } });
  await tx.appendMessage(id, { role: "commentary", text: text(index + 1, 150), messageId: `note-${index}`, at: at(index, 1) });
  await tx.appendMessage(id, { role: "thinking", text: text(index + 2, 120), messageId: `think-${index}`, at: at(index, 2) });
  await tx.appendMessage(id, { role: "assistant", text: text(index + 3, 520), messageId: `reply-${index}`, at: at(index, 3) });
  await tx.updateTurnMetadata(id, { runtime: { status: "completed", nativeTurnId: `native-${index}` } });
}

async function seededChat(f, sessionId, turns) {
  await f.store.createSession({ sessionId, runtimeKind: "genesis" });
  await f.store.conversationStorage.write(sessionId, async tx => {
    for (let index = 0; index < turns; index += 1) await appendTurn(tx, index);
  });
}

async function chatFile(store, sessionId) {
  const root = store.paths(sessionId).conversationLogRoot;
  const names = (await readdir(root)).filter(name => name.startsWith("transcript."));
  assert.equal(names.length, 1, `One chat file in ${root}: ${names.join(", ")}`);
  return path.join(root, names[0]);
}

async function processWrites() {
  const counters = Object.fromEntries((await readFile("/proc/self/io", "utf8")).trim().split("\n")
    .map(line => line.split(": ")).map(([key, value]) => [key, Number(value)]));
  return { bytes: counters.wchar, calls: counters.syscw };
}

const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

// Six messages into an open chat: what the process writes for each, and whether the chat file was replaced.
async function measureMessageWrites(f, sessionId, turns) {
  const file = await chatFile(f.store, sessionId);
  const before = await stat(file);
  const bytes = [], calls = [];
  for (let index = 0; index < 6; index += 1) {
    const start = await processWrites();
    if (index % 2 === 0) await f.store.writeConversationUserMessage(sessionId, { text: text(turns + index, 420), messageId: `new-user-${index}` });
    else await f.store.writeConversationAssistantMessage(sessionId, { text: text(turns + index, 520), messageId: `new-reply-${index}` });
    const end = await processWrites();
    bytes.push(end.bytes - start.bytes);
    calls.push(end.calls - start.calls);
  }
  const after = await stat(await chatFile(f.store, sessionId));
  return { bytes: median(bytes), calls: median(calls), replaced: after.ino !== before.ino, grewBy: after.size - before.size };
}

test("a message costs the same few written bytes at 50 turns as at 5,000: the chat is appended, never rewritten", async t => {
  try { await readFile("/proc/self/io", "utf8"); } catch { return t.skip("This measurement needs Linux's /proc/self/io."); }
  const f = await fixture(t);
  await seededChat(f, "small", 50);
  await seededChat(f, "large", 5000);
  const small = await measureMessageWrites(f, "small", 50);
  const large = await measureMessageWrites(f, "large", 5000);
  const largeSize = (await stat(await chatFile(f.store, "large"))).size;
  t.diagnostic(`50 turns: ${small.bytes} bytes in ${small.calls} writes; 5,000 turns: ${large.bytes} bytes in ${large.calls} writes; chat ${largeSize} bytes`);
  assert.equal(small.replaced, false, "A message at 50 turns keeps the chat file (no whole-file replacement).");
  assert.equal(large.replaced, false, "A message at 5,000 turns keeps the chat file (no whole-file replacement).");
  assert.ok(large.bytes < 64 * 1024, `A message at 5,000 turns writes ${large.bytes} bytes; the chat is ${largeSize}.`);
  assert.ok(large.bytes <= small.bytes * 1.25 + 2048, `5,000 turns writes ${large.bytes} bytes per message, 50 turns ${small.bytes}.`);
  assert.ok(large.calls <= small.calls + 2, `5,000 turns makes ${large.calls} write calls per message, 50 turns ${small.calls}.`);
  assert.ok(large.grewBy < 6 * 4096, `Six messages grew the chat by ${large.grewBy} bytes.`);
});

async function threeMessageChat(f) {
  await f.store.createSession({ sessionId: "one", runtimeKind: "genesis" });
  const first = await f.store.writeConversationUserMessage("one", { text: "First question", messageId: "first" });
  await f.store.writeConversationAssistantMessage("one", { text: "First answer", messageId: "first-answer" });
  await f.store.writeConversationUserMessage("one", { text: "Second question", messageId: "second" });
  return { file: await chatFile(f.store, "one"), first };
}

async function messageTexts(store, scope = "one") {
  return (await store.readConversationLog(scope)).flatMap(turn => turn.messages.map(message => message.text));
}

// What a crash leaves after the last complete record: an unfinished line, blocks that never reached the disk, or a
// whole final line whose bytes did not all arrive.
const crashTails = {
  "an unfinished line": Buffer.from('{"turns":[["000003",{"keep":1,"messages":[{"role":"assistant","text":"Lost ans'),
  "zeros where an append never reached the disk": Buffer.alloc(300),
  "a final line whose middle never reached the disk": Buffer.concat([Buffer.from('{"turns":[["000003",{"keep":1,"mes'), Buffer.alloc(40), Buffer.from('"}]}]]}\n')])
};

for (const [name, tail] of Object.entries(crashTails)) {
  test(`a crash mid-append leaves ${name}: the chat keeps every earlier message and the next message repairs the file`, async t => {
    const f = await fixture(t);
    const { file } = await threeMessageChat(f);
    const complete = await readFile(file);
    await writeFile(file, Buffer.concat([complete, tail]));
    const restarted = f.createStore();
    assert.deepEqual(await messageTexts(restarted), ["First question", "First answer", "Second question"]);
    assert.equal(await restarted.conversationMessageIdExists("one", "second"), true);
    await restarted.writeConversationAssistantMessage("one", { text: "Second answer", messageId: "second-answer" });
    const repaired = await readFile(file);
    assert.deepEqual(repaired.subarray(0, complete.length), complete, "Every committed byte stays in place.");
    for (const line of repaired.subarray(complete.length).toString("utf8").split("\n").filter(Boolean)) JSON.parse(line);
    assert.equal(repaired.at(-1), 10, "The repaired chat ends with a complete line.");
    assert.deepEqual(await messageTexts(f.createStore()), ["First question", "First answer", "Second question", "Second answer"]);
  });
}

test("an append that fails part-way leaves the chat as it was, and the next one succeeds", async t => {
  const f = await fixture(t);
  const { file } = await threeMessageChat(f);
  const before = await readFile(file);
  const handle = await (await import("node:fs/promises")).open(file, "r");
  const prototype = Object.getPrototypeOf(handle);
  await handle.close();
  const realWrite = prototype.write;
  prototype.write = async function (buffer, offset = 0, length = buffer.length - offset, position = null) {
    await realWrite.call(this, buffer, offset, Math.floor(length / 2), position);
    throw Object.assign(new Error("No space left on device"), { code: "ENOSPC" });
  };
  try {
    await assert.rejects(f.store.writeConversationAssistantMessage("one", { text: "Lost answer", messageId: "lost" }), /No space left/);
  } finally { prototype.write = realWrite; }
  assert.deepEqual(await readFile(file), before);
  assert.deepEqual(await messageTexts(f.createStore()), ["First question", "First answer", "Second question"]);
  await f.store.writeConversationAssistantMessage("one", { text: "Second answer", messageId: "second-answer" });
  assert.deepEqual(await messageTexts(f.createStore()), ["First question", "First answer", "Second question", "Second answer"]);
});

test("a damaged line before the last is never skipped: the chat is refused and left untouched", async t => {
  const f = await fixture(t);
  const { file } = await threeMessageChat(f);
  const lines = (await readFile(file, "utf8")).split("\n");
  assert.ok(lines.length >= 4, "Each message is its own line.");
  lines[1] = lines[1].slice(0, -3);
  const damaged = lines.join("\n");
  await writeFile(file, damaged);
  await assert.rejects(f.createStore().readConversationLog("one"), { code: "vibe64_invalid_conversation_storage" });
  await assert.rejects(f.createStore().writeConversationUserMessage("one", { text: "Refused" }), { code: "vibe64_invalid_conversation_storage" });
  assert.equal(await readFile(file, "utf8"), damaged);
});

test("a chat whose changes outgrow a thirty-second of its snapshot (64 KiB at least) is saved whole again: a load parses little more than its record, and a message writes the same bounded share at any size", async t => {
  const { parseLegacyTranscript, parseTranscriptLog, writeTranscriptLog } = await import("@local/vibe64-runtime/server/sessionTranscriptLog");
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-chat-checkpoint-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const lineCount = async file => (await readFile(file, "utf8")).split("\n").length - 1;
  const sizes = [];
  // 3 KB messages: two whole saves at 50 turns (each past 64 KiB of lines), one at 1,500 (past a 32nd of 2.9 MB).
  const messages = 45;
  for (const turns of [50, 1500]) {
    const file = path.join(root, `${turns}.jsonl`);
    let saved = await writeTranscriptLog(file, null, parseLegacyTranscript(JSON.stringify(legacyDocument(turns))));
    let written = 0;
    let wholeSaves = 0;
    const appended = [];
    for (let index = 0; index < messages; index += 1) {
      const before = await stat(file, { bigint: true });
      const id = String(turns + 2 + index).padStart(6, "0");
      const next = { ...saved.record, turns: new Map(saved.record.turns).set(id, {
        messages: [{ role: "user", text: text(index, 3000), at: at(turns + 2 + index), messageId: `extra-${index}` }] }) };
      saved = await writeTranscriptLog(file, saved, next);
      const after = await stat(file, { bigint: true });
      if (after.ino === before.ino) {
        appended.push(Number(after.size - before.size));
        written += Number(after.size - before.size);
      } else {
        wholeSaves += 1;
        written += Number(after.size);
        assert.equal(await lineCount(file), 1, "A chat saved whole is one snapshot line.");
      }
      assert.ok(saved.changeBytes <= Math.max(64 * 1024, saved.snapshotBytes / 32),
        `What follows the snapshot stays within its share (${saved.changeBytes} after ${saved.snapshotBytes} at ${turns} turns).`);
    }
    const reread = parseTranscriptLog(await readFile(file));
    assert.equal(JSON.stringify([...reread.record.turns]), JSON.stringify([...saved.record.turns]), "Every message reads back.");
    assert.equal(reread.changeBytes, saved.changeBytes);
    assert.ok(wholeSaves >= 1, `The chat was saved whole again at ${turns} turns.`);
    sizes.push({ turns, line: median(appended), perMessage: written / messages });
  }
  const [small, large] = sizes;
  assert.ok(Math.abs(small.line - large.line) <= 16, `An appended message writes the same at both sizes: ${JSON.stringify(sizes)}.`);
  for (const { turns, line, perMessage } of sizes) {
    assert.ok(perMessage <= 34 * line, `Over many messages, one writes at most 34 of its lines at ${turns} turns: ${JSON.stringify(sizes)}.`);
  }
  // A change no line can say (a turn removed) is the chat whole too, never a second record after the first.
  const file = path.join(root, "removed.jsonl");
  const saved = await writeTranscriptLog(file, null, parseLegacyTranscript(JSON.stringify(legacyDocument(5))));
  const turns = new Map(saved.record.turns);
  turns.delete("000004");
  await writeTranscriptLog(file, saved, { ...saved.record, turns });
  assert.equal(await lineCount(file), 1);
  assert.deepEqual([...parseTranscriptLog(await readFile(file)).record.turns.keys()], [...turns.keys()]);
});

// What a saved record says once written: absent and undefined values alike are left out.
const asSaved = record => JSON.parse(JSON.stringify({ metadata: record.metadata, rewound: record.rewound,
  turns: [...record.turns], summary: record.summary }));

test("every saved change replays to exactly the record its transaction committed", async () => {
  const { parseTranscriptLog, transcriptChangeLine, transcriptLogContents } = await import("@local/vibe64-runtime/server/sessionTranscriptLog");
  let seed = 0;
  const random = limit => (seed = (seed * 1103515245 + 12345) % 2147483648) % limit;
  const pick = values => values[random(values.length)];
  let serial = 0;
  const message = () => ({ role: pick(["user", "assistant", "commentary", "thinking", "system"]), text: `Message ${++serial} ${text(serial, random(80))}`,
    at: at(serial), messageId: `m-${serial}`, ...(random(4) ? {} : { data: { approval: { state: pick(["pending", "approved"]) } } }) });
  const value = () => pick([random(1000), `v${random(50)}`, true, null, [random(9), "x"], { nested: random(9) }, undefined]);
  // A change to an object the way the runtime's writes make one: a set, a removal, a nested edit or a rebuilt object.
  function changed(object = {}) {
    const next = { ...object };
    const keys = Object.keys(next);
    switch (random(6)) {
      // An own key, as JSON and structuredClone make one, even when it is named __proto__.
      case 0: Object.defineProperty(next, pick(["status", "nativeTurnId", "seen", "binding", "__proto__", "007"]),
        { value: value(), enumerable: true, writable: true, configurable: true }); break;
      case 1: if (keys.length) delete next[pick(keys)]; break;
      case 2: if (keys.length) next[pick(keys)] = undefined; break;
      case 3: if (keys.length) next[pick(keys)] = changed(isObject(next[keys[0]]) ? next[keys[0]] : {}); break;
      case 4: return Object.fromEntries(Object.entries(next).reverse());
      default: next.runtime = { ...next.runtime, status: pick(["running", "completed", "interrupted"]), [`seen-${random(5)}`]: random(99) };
    }
    return next;
  }
  const isObject = candidate => candidate !== null && typeof candidate === "object" && !Array.isArray(candidate);
  // Each step checks the whole record, so its cost follows the record's size: three chats of 500 steps each cover
  // 1,500 transactions at a third of the size one 1,500-step chat grows to.
  const steps = 500;
  for (const start of [20261124, 7, 424242]) {
    seed = start;
    let saved = { metadata: { runtime: { version: 3 } }, rewound: [], turns: new Map([["000001", { messages: [message()] }]]) };
    let file = transcriptLogContents(saved);
    let snapshots = 1;
    for (let step = 0; step < steps; step += 1) {
      // A transaction shares every turn and message it does not change, as JSKIT's does.
      const next = { ...saved, turns: new Map(saved.turns) };
      for (let edit = random(3) + 1; edit > 0; edit -= 1) {
        const ids = [...next.turns.keys()];
        const id = pick(ids);
        const turn = next.turns.get(id);
        switch (random(12)) {
          case 0: case 1: next.turns.set(String(Math.max(...ids.map(Number)) + 1).padStart(6, "0"), { messages: [message()],
            ...(random(2) ? { metadata: { actorId: "ada", runtime: { status: "running" } } } : {}) }); break;
          case 2: case 3: next.turns.set(id, { ...turn, messages: [...turn.messages, message()] }); break;
          case 4: if (turn.messages.length) {
            const messages = [...turn.messages];
            messages[random(messages.length)] = { ...messages[random(messages.length)], text: `Edited ${++serial}` };
            next.turns.set(id, { ...turn, messages });
          } break;
          case 5: next.turns.set(id, { ...turn, messages: turn.messages.slice(0, random(turn.messages.length + 1)) }); break;
          case 6: case 7: next.turns.set(id, { ...turn, metadata: changed(turn.metadata) }); break;
          case 8: { const { metadata: _removed, ...bare } = turn; next.turns.set(id, bare); } break;
          case 9: next.metadata = changed(next.metadata); break;
          case 10: next.summary = pick([undefined, { text: `Summary ${++serial}`, throughTurnId: id }]); break;
          default: switch (random(4)) {
            case 0: next.rewound = random(2) ? [...new Set([...next.rewound, id])] : []; break;
            case 1: if (ids.length > 1) next.turns.delete(id); next.rewound = next.rewound.filter(turnId => next.turns.has(turnId)); break;
            case 2: next.turns = new Map([...next.turns].reverse()); break;
            default: next.metadata = JSON.parse('{"__proto__":{"polluted":true},"runtime":{"version":4}}');
          }
        }
      }
      const line = transcriptChangeLine(saved, next);
      let snapshot = false;
      if (line !== null) {
        assert.equal(line.indexOf("\n"), line.length - 1, "One change is one line.");
        snapshot = JSON.parse(line).version === 2;
        file += line;
      } else assert.deepEqual(asSaved(next), asSaved(saved), "Only an unchanged record writes nothing.");
      const { record, validBytes } = parseTranscriptLog(Buffer.from(file));
      assert.equal(validBytes, Buffer.byteLength(file));
      assert.equal(JSON.stringify(asSaved(record)), JSON.stringify(asSaved(next)), `Step ${step} replays exactly, key order included.`);
      // A later snapshot replaces everything before it (just checked), so the file goes on from it alone: each step
      // parses a short file instead of the whole history of whole records.
      if (snapshot) {
        snapshots += 1;
        file = line;
      }
      saved = next;
    }
    assert.ok(snapshots < steps / 4, `Only changes a line cannot say are new snapshots (${snapshots} of ${steps}, seed ${start}).`);
  }
  assert.equal({}.polluted, undefined, "A saved __proto__ key stays a key.");
});

// The saved shape the previous release wrote: one compact transcript.json record per chat.
function legacyDocument(turns, { summary = true } = {}) {
  const document = { version: 1, metadata: { runtime: { version: 3, engine: "codex", segmentId: "segment-1", lastEngine: "codex",
    configuration: { model: "gpt" }, predecessors: [], seen: {}, binding: { threadId: "thread-1" } } }, rewound: [], turns: [] };
  for (let index = 1; index <= turns; index += 1) {
    const id = String(index).padStart(6, "0");
    const messages = [
      { role: "user", text: `Question ${index} ${text(index, 300)}`, at: at(index), messageId: `user-${index}`,
        ...(index % 5 === 0 ? { attachments: [{ id: `upload-${index}`, name: "notes.txt" }] } : {}) },
      { role: "commentary", text: text(index + 1, 150), at: at(index, 1), messageId: `note-${index}`, outputId: `out-${index}` },
      { role: "thinking", text: text(index + 2, 120), at: at(index, 2), messageId: `think-${index}` },
      { role: "assistant", text: `Answer ${index} ${text(index + 3, 500)}`, at: at(index, 3), messageId: `reply-${index}`,
        ...(index % 7 === 0 ? { data: { approval: { id: `approval-${index}`, state: "approved" } } } : {}) }
    ];
    const metadata = { actorDisplayName: "Ada", actorId: "ada", engineId: "codex",
      runtime: { status: index === turns ? "interrupted" : "completed", nativeTurnId: `native-${index}` },
      nativeMessageVersions: Object.fromEntries(messages.filter(message => message.role !== "thinking")
        .map(message => [`${id}:${message.role}:${message.messageId}`, "a".repeat(64)])) };
    document.turns.push([id, { messages, metadata }]);
    document.metadata.runtime.seen[`reply-${index}`] = "b".repeat(64);
  }
  // A red interruption entry is its own system turn; an earlier turn was hidden by a completed Undo.
  const notice = String(turns + 1).padStart(6, "0");
  document.turns.push([notice, { messages: [{ role: "system", text: "The AI was interrupted.", at: at(turns + 1), messageId: "notice-1" }],
    metadata: { kind: "turn_interruption", cause: "server_restart", at: at(turns + 1) } }]);
  document.rewound.push("000002");
  if (summary) document.summary = { text: "Earlier work: the plan and its first steps.", throughTurnId: "000003" };
  return document;
}

async function writeLegacyChat(logRoot, document) {
  await mkdir(logRoot, { recursive: true });
  const file = path.join(logRoot, "transcript.json");
  const contents = `${JSON.stringify(document)}\n`;
  await writeFile(file, contents);
  return { file, contents };
}

// What the previous release read from that record, as the conversation log shows it.
function expectedLog(document) {
  return document.turns.filter(([id]) => !document.rewound.includes(id)).map(([id, turn]) => ({
    turnId: id,
    texts: turn.messages.map(message => message.text),
    metadata: turn.metadata
  }));
}

async function shownLog(store, scope) {
  return (await store.readConversationLog(scope)).map(turn => ({ turnId: turn.turnId,
    texts: turn.messages.map(message => message.text), metadata: turn.metadata }));
}

async function chatUpgrade() {
  const { upgradeChatTranscriptLogs } = await import("@local/vibe64-runtime/server/chatTranscriptLogUpgrade");
  return upgradeChatTranscriptLogs;
}

test("the upgrade converts every old chat (live, temporary, closing, archived, prepared renewal) without losing a message", async t => {
  const f = await fixture(t);
  const upgrade = await chatUpgrade();
  const reports = [];
  const run = (apply, report = (level, message) => reports.push({ level, message })) =>
    upgrade({ systemRoot: f.systemRoot, backupRoot: f.backupRoot, apply, report });
  const documents = {};
  for (const sessionId of ["live", "closing", "archived"]) {
    await f.store.createSession({ sessionId, runtimeKind: "genesis" });
    documents[sessionId] = legacyDocument(sessionId === "live" ? 300 : 12, { summary: sessionId === "live" });
    await writeLegacyChat(f.store.paths(sessionId).conversationLogRoot, documents[sessionId]);
  }
  await f.store.writeSessionConversation("live", "temporary", { title: "A temporary chat" });
  documents.temporary = legacyDocument(4, { summary: false });
  await writeLegacyChat(path.join(f.store.paths("live").conversationsRoot, "temporary/conversation-log"), documents.temporary);
  await f.store.createSession({ sessionId: "empty", runtimeKind: "genesis" });
  await f.store.writeStatus("archived", "archived");
  await f.store.publishSessionArchive("archived");
  const archiveRoot = f.store.paths().archivedSessionsRoot;
  const preparedRoot = path.join(archiveRoot, ".renewals/retained-renewal");
  await mkdir(preparedRoot, { recursive: true });
  for (const suffix of [".tar.gz", ".json"]) await copyFile(path.join(archiveRoot, `archived${suffix}`), path.join(preparedRoot, `archived${suffix}`));
  const closingRoot = path.join(f.store.paths().closingSessionsRoot, "closing");
  await mkdir(path.dirname(closingRoot), { recursive: true });
  await rename(f.store.paths("closing").sessionRoot, closingRoot);
  const liveFile = path.join(f.store.paths("live").conversationLogRoot, "transcript.json");
  const liveOriginal = await readFile(liveFile, "utf8");
  const archiveOriginal = await readFile(path.join(archiveRoot, "archived.tar.gz"));

  // An old chat is never converted by reading or writing it: the person is told to run the upgrade.
  await assert.rejects(f.store.readConversationLog("live"), { code: "vibe64_conversation_upgrade_required" });
  await assert.rejects(f.store.writeConversationUserMessage("live", { text: "Not before the upgrade" }), { code: "vibe64_conversation_upgrade_required" });
  assert.equal(await readFile(liveFile, "utf8"), liveOriginal);
  assert.deepEqual(await shownLog(f.store, "empty"), []);

  await run(false);
  assert.equal(await readFile(liveFile, "utf8"), liveOriginal, "Check changes nothing.");
  assert.deepEqual(await readFile(path.join(archiveRoot, "archived.tar.gz")), archiveOriginal);
  await assert.rejects(readFile(path.join(f.backupRoot, "manifest.json")), { code: "ENOENT" });
  assert.ok(reports.some(({ message }) => /5 chat\(s\) to convert/u.test(message)), JSON.stringify(reports));

  await run(true);
  assert.deepEqual(await shownLog(f.createStore(), "live"), expectedLog(documents.live));
  assert.deepEqual(await shownLog(f.store, { sessionId: "live", conversationId: "temporary" }), expectedLog(documents.temporary));
  assert.deepEqual(await shownLog(f.store, "archived"), expectedLog(documents.archived));
  assert.equal(await f.store.conversationMessageIdExists("live", "user-2"), true, "A hidden turn's message still counts as sent.");
  assert.deepEqual(await f.store.conversationStorage.read("live", tx => tx.readSummary()), documents.live.summary);
  assert.deepEqual(await f.store.conversationStorage.read("live", tx => tx.readMetadata()), documents.live.metadata);
  await assert.rejects(readFile(liveFile), { code: "ENOENT" });
  assert.equal(await readFile(path.join(f.backupRoot, "before", path.relative(f.systemRoot, liveFile)), "utf8"), liveOriginal);
  for (const archive of [path.join(archiveRoot, "archived.tar.gz"), path.join(preparedRoot, "archived.tar.gz")]) {
    const members = (await exec("tar", ["-tzf", archive])).stdout.split("\n");
    assert.equal(members.some(name => name.endsWith("/conversation-log/transcript.json")), false, archive);
    assert.ok(members.some(name => name.endsWith("/conversation-log/transcript.jsonl")), archive);
  }
  assert.deepEqual(await readFile(path.join(f.backupRoot, "before", path.relative(f.systemRoot, path.join(archiveRoot, "archived.tar.gz")))), archiveOriginal);
  const closingStore = await readdir(path.join(closingRoot, "conversation-log"));
  assert.deepEqual(closingStore.filter(name => name.startsWith("transcript")), ["transcript.jsonl"]);

  // Rerunning the finished upgrade (before the services start again) changes nothing.
  const converted = await readFile(await chatFile(f.store, "live"));
  const manifest = await readFile(path.join(f.backupRoot, "manifest.json"), "utf8");
  await run(true);
  await run(false);
  assert.equal(await readFile(path.join(f.backupRoot, "manifest.json"), "utf8"), manifest);
  assert.deepEqual(await readFile(await chatFile(f.store, "live")), converted);

  // The converted chat takes new messages by appending to its converted record.
  await f.store.writeConversationUserMessage("live", { text: "After the upgrade", messageId: "after" });
  assert.deepEqual((await readFile(await chatFile(f.store, "live"))).subarray(0, converted.length), converted);
  assert.equal((await f.createStore().readConversationLog("live")).at(-1).user.text, "After the upgrade");
});

test("an interrupted upgrade resumes its prepared chats and keeps the original copies", async t => {
  const f = await fixture(t);
  const upgrade = await chatUpgrade();
  await f.store.createSession({ sessionId: "one", runtimeKind: "genesis" });
  const document = legacyDocument(20);
  const { file, contents } = await writeLegacyChat(f.store.paths("one").conversationLogRoot, document);
  const run = (apply, report = () => {}) => upgrade({ systemRoot: f.systemRoot, backupRoot: f.backupRoot, apply, report });
  // Stopped after the new chat file is published, before the old one is removed.
  await assert.rejects(run(true, (_level, message) => {
    if (message.startsWith("Published state:")) throw new Error("power cut");
  }), /power cut/);
  assert.equal(await readFile(file, "utf8"), contents, "The old chat stays until the upgrade has finished with it.");
  await run(false);
  await run(true);
  assert.deepEqual(await shownLog(f.createStore(), "one"), expectedLog(document));
  await assert.rejects(readFile(file), { code: "ENOENT" });
  assert.equal(await readFile(path.join(f.backupRoot, "before", path.relative(f.systemRoot, file)), "utf8"), contents);
});

test("the upgrade refuses an unreadable or unknown old chat before changing anything", async t => {
  const f = await fixture(t);
  const upgrade = await chatUpgrade();
  await f.store.createSession({ sessionId: "one", runtimeKind: "genesis" });
  const logRoot = f.store.paths("one").conversationLogRoot;
  const run = apply => upgrade({ systemRoot: f.systemRoot, backupRoot: f.backupRoot, apply, report: () => {} });
  for (const contents of ["not json", JSON.stringify({ ...legacyDocument(2), extra: "unknown" }),
    JSON.stringify({ ...legacyDocument(2), version: 3 })]) {
    await mkdir(logRoot, { recursive: true });
    await writeFile(path.join(logRoot, "transcript.json"), contents);
    await assert.rejects(run(true), /Inspect|Restore/u);
    assert.equal(await readFile(path.join(logRoot, "transcript.json"), "utf8"), contents);
    await assert.rejects(readFile(path.join(f.backupRoot, "manifest.json")), { code: "ENOENT" });
  }
  // A chat in both shapes means an earlier run was disturbed: inspect it rather than guess which is current.
  await writeFile(path.join(logRoot, "transcript.json"), JSON.stringify(legacyDocument(2)));
  await writeFile(path.join(logRoot, "transcript.jsonl"), "");
  await assert.rejects(run(false), /both/u);
});
