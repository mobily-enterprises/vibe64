import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createSessionTimelineWriter,
  sessionTimelinePaths
} from "@local/vibe64-core/server/sessionTimeline";

async function withProjectRoot(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-session-timeline-"));
  try {
    return await callback(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

async function readLines(file) {
  const text = await readFile(file, "utf8").catch((error) => (error.code === "ENOENT" ? "" : Promise.reject(error)));
  return text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

test("a timeline line keeps the time, kind, event and short scalar fields, and drops everything else", async () => {
  await withProjectRoot(async (root) => {
    const writer = createSessionTimelineWriter({ now: () => Date.parse("2026-11-14T05:00:00.000Z") });
    const options = { projectRuntimeRoot: root };
    assert.equal(writer.record("2026-11-14_05-00-00", {
      kind: "turn",
      event: "failed",
      engine: "claude",
      turn: "t-1",
      exitCode: 1,
      steer: false,
      error: `Bearer abcdefghijklmnop ${"x".repeat(400)}`,
      message: { text: "the person's words" },
      attachments: ["a"],
      at: "forged",
      "bad field": "dropped",
      empty: "  "
    }, options), true);
    assert.equal(writer.record("2026-11-14_05-00-00", { kind: "chat", event: "said" }, options), false, "unknown kind");
    assert.equal(writer.record("2026-11-14_05-00-00", { kind: "turn" }, options), false, "no event");
    assert.equal(writer.record("../escape", { kind: "turn", event: "started" }, options), false, "unsafe session id");
    assert.equal(writer.record("2026-11-14_05-00-00", { kind: "turn", event: "started" }, { projectRuntimeRoot: "relative" }), false);
    const paths = sessionTimelinePaths(root, "2026-11-14_05-00-00");
    await assert.rejects(stat(paths.current), { code: "ENOENT" }, "recording returns before anything is written");
    await writer.flush();
    const [line, ...rest] = await readLines(paths.current);
    assert.deepEqual(rest, []);
    assert.equal(line.at, "2026-11-14T05:00:00.000Z");
    assert.deepEqual(Object.keys(line), ["at", "kind", "event", "engine", "turn", "exitCode", "steer", "error"]);
    assert.equal(line.exitCode, 1);
    assert.equal(line.steer, false);
    assert.equal(line.error.length, 200);
    assert.doesNotMatch(line.error, /abcdefghijklmnop/u, "a bearer token is redacted");
    assert.equal((await stat(paths.current)).mode & 0o777, 0o600);
    assert.equal((await stat(paths.directory)).mode & 0o777, 0o700);
  });
});

test("one tick's events are appended together, in order, for each session", async () => {
  await withProjectRoot(async (root) => {
    const writer = createSessionTimelineWriter();
    for (let index = 0; index < 50; index += 1) {
      writer.record(index % 2 ? "session-b" : "session-a", { kind: "connection", event: "connected", tab: `tab:${index}` },
        { projectRuntimeRoot: root });
    }
    await writer.flush();
    const a = await readLines(sessionTimelinePaths(root, "session-a").current);
    const b = await readLines(sessionTimelinePaths(root, "session-b").current);
    assert.deepEqual(a.map(({ tab }) => tab), Array.from({ length: 25 }, (_, index) => `tab:${index * 2}`));
    assert.deepEqual(b.map(({ tab }) => tab), Array.from({ length: 25 }, (_, index) => `tab:${index * 2 + 1}`));
    assert.equal(writer.recordForActiveSessions({ kind: "server", event: "stopping", reason: "server-shutdown" }), 2);
    await writer.flush();
    assert.equal((await readLines(sessionTimelinePaths(root, "session-a").current)).at(-1).event, "stopping");
    assert.equal((await readLines(sessionTimelinePaths(root, "session-b").current)).at(-1).event, "stopping");
  });
});

/**
 * Writes ten times a file's bound, a few events at a time, and answers what the
 * session keeps: its files and their sizes, and its newest and oldest events.
 */
async function keptAfterBusyDay(fileBytes) {
  return withProjectRoot(async (root) => {
    const writer = createSessionTimelineWriter({ fileBytes });
    const options = { projectRuntimeRoot: root };
    const event = (index) => ({ kind: "turn", event: "started", engine: "codex", chat: "main", message: `message_tab_${index}` });
    const lineBytes = Buffer.byteLength(`${JSON.stringify({ at: new Date().toISOString(), ...event(0) })}\n`);
    const total = Math.ceil((fileBytes * 10) / lineBytes);
    for (let index = 0; index < total; index += 5) {
      for (let offset = index; offset < Math.min(total, index + 5); offset += 1) writer.record("busy", event(offset), options);
      await writer.flush();
    }
    const paths = sessionTimelinePaths(root, "busy");
    const current = await readLines(paths.current);
    const previous = await readLines(paths.previous);
    return {
      files: (await readdir(paths.directory)).sort(),
      currentBytes: (await stat(paths.current)).size,
      previousBytes: (await stat(paths.previous)).size,
      newest: current.at(-1).message,
      oldestKept: Number(previous[0].message.split("_").at(-1)),
      kept: previous.length + current.length,
      total
    };
  });
}

test("a busy session keeps two bounded files at any file size, newest events last", async () => {
  for (const fileBytes of [4 * 1024, 64 * 1024]) {
    const kept = await keptAfterBusyDay(fileBytes);
    assert.deepEqual(kept.files, ["busy.1.jsonl", "busy.jsonl"], `${fileBytes}: two files`);
    assert.ok(kept.currentBytes <= fileBytes, `${fileBytes}: current ${kept.currentBytes}`);
    assert.ok(kept.previousBytes <= fileBytes, `${fileBytes}: previous ${kept.previousBytes}`);
    assert.ok(kept.previousBytes > fileBytes / 2, `${fileBytes}: the rotated file was full`);
    assert.equal(kept.newest, `message_tab_${kept.total - 1}`, `${fileBytes}: the newest event is kept`);
    // What is kept follows the bound, never the ten times as many events written.
    assert.ok(kept.kept < kept.total / 4, `${fileBytes}: kept ${kept.kept} of ${kept.total}`);
    assert.equal(kept.oldestKept, kept.total - kept.kept, `${fileBytes}: kept events are the most recent, in order`);
  }
});

test("a burst within one tick keeps one bounded file of its newest events, at any file size", async () => {
  for (const fileBytes of [4 * 1024, 64 * 1024]) {
    await withProjectRoot(async (root) => {
      const writer = createSessionTimelineWriter({ fileBytes });
      const event = (index) => ({ kind: "connection", event: "reconnected", tab: "tab:storm", offlineMs: index, message: `message_tab_${index}` });
      const lineBytes = Buffer.byteLength(`${JSON.stringify({ at: new Date().toISOString(), ...event(0) })}\n`);
      const total = Math.ceil((fileBytes * 10) / lineBytes);
      // A reconnect storm: every event before the writer's next turn.
      for (let index = 0; index < total; index += 1) writer.record("storm", event(index), { projectRuntimeRoot: root });
      await writer.flush();
      const paths = sessionTimelinePaths(root, "storm");
      const lines = await readLines(paths.current);
      assert.ok((await stat(paths.current)).size <= fileBytes, `${fileBytes}: one file's worth`);
      assert.ok(lines.length > fileBytes / lineBytes / 2, `${fileBytes}: the file is filled`);
      assert.deepEqual(lines.map(({ offlineMs }) => offlineMs), Array.from({ length: lines.length }, (_, index) => total - lines.length + index),
        `${fileBytes}: the newest events, in order`);
    });
  }
});

test("files untouched past the retention are removed when the folder is next written", async () => {
  await withProjectRoot(async (root) => {
    const now = Date.parse("2026-11-14T05:00:00.000Z");
    const day = 24 * 60 * 60 * 1000;
    const { directory } = sessionTimelinePaths(root, "fresh");
    await mkdir(directory, { recursive: true });
    const old = path.join(directory, "old.jsonl");
    const oldRotated = path.join(directory, "old.1.jsonl");
    const recent = path.join(directory, "recent.jsonl");
    const unrelated = path.join(directory, "notes.txt");
    for (const file of [old, oldRotated, recent, unrelated]) await writeFile(file, "{}\n", "utf8");
    for (const file of [old, oldRotated, unrelated]) await utimes(file, new Date(now - 15 * day), new Date(now - 15 * day));
    await utimes(recent, new Date(now - 13 * day), new Date(now - 13 * day));
    const writer = createSessionTimelineWriter({ now: () => now, retentionMs: 14 * day });
    writer.record("fresh", { kind: "server", event: "stopping" }, { projectRuntimeRoot: root });
    await writer.flush();
    assert.deepEqual((await readdir(directory)).sort(), ["fresh.jsonl", "notes.txt", "recent.jsonl"]);
  });
});
