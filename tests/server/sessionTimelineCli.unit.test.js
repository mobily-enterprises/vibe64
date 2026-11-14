import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runSessionTimelineCli } from "@local/vibe64-core/server/sessionTimelineCli";

const SESSION = "2026-11-14_04-58-00";
const NOW = Date.parse("2026-11-14T06:00:00.000Z");

function event(at, kind, name, fields = {}) {
  return `${JSON.stringify({ at, kind, event: name, ...fields })}\n`;
}

async function withStateRoot(callback) {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-timeline-cli-"));
  try {
    const timeline = path.join(stateRoot, "projects", "shop", "timeline");
    await mkdir(timeline, { recursive: true });
    await writeFile(path.join(timeline, `${SESSION}.1.jsonl`), [
      event("2026-11-14T05:00:00.000Z", "connection", "connected", { tab: "tab:one", user: "owner" }),
      event("2026-11-14T05:00:05.000Z", "turn", "started", { engine: "claude", chat: "main", message: "message_tab_one_1", by: "owner" })
    ].join(""), "utf8");
    await writeFile(path.join(timeline, `${SESSION}.jsonl`), [
      event("2026-11-14T05:01:00.000Z", "connection", "disconnected", { tab: "tab:one", user: "owner", reason: "ping timeout" }),
      "{\"at\":\"2026-11-14T05:01:01.000Z\",\"kind\":\"turn\",\"ev",
      "\n",
      event("2026-11-14T05:01:30.000Z", "connection", "reconnected", { tab: "tab:one", user: "owner", offlineMs: 30_000 }),
      event("2026-11-14T05:02:00.000Z", "turn", "cancel-requested", {
        engine: "claude", chat: "temporary", conversation: "c-2", reason: "cancel-message", by: "owner",
        trigger: "POST /api/app/:slug/vibe64/sessions/:sessionId/agent-turn/interrupt"
      }),
      event("2026-11-14T05:02:01.000Z", "turn", "cancelled", { engine: "claude", chat: "temporary", conversation: "c-2" }),
      event("2026-11-14T05:03:00.000Z", "request", "failed", { method: "GET", route: "/api/x/:sessionId", status: 503, code: "vibe64_busy" })
    ].join(""), "utf8");
    const other = path.join(stateRoot, "projects", "blog", "timeline");
    await mkdir(other, { recursive: true });
    await writeFile(path.join(other, "2026-11-13_10-00-00.jsonl"), event("2026-11-13T10:00:00.000Z", "server", "stopping"), "utf8");
    await utimes(path.join(other, "2026-11-13_10-00-00.jsonl"), new Date("2026-11-13T10:00:00Z"), new Date("2026-11-13T10:00:00Z"));
    return await callback(stateRoot);
  } finally {
    await rm(stateRoot, { force: true, recursive: true });
  }
}

async function run(argv, env = {}) {
  let stdout = "";
  let stderr = "";
  const status = await runSessionTimelineCli(argv, {
    env,
    now: NOW,
    stdout: { write: (text) => { stdout += text; } },
    stderr: { write: (text) => { stderr += text; } }
  });
  return { status, stdout, stderr, lines: stdout.split("\n").filter(Boolean) };
}

test("vibe64 timeline SESSION prints the session's events in plain words, oldest first, across its two files", async () => {
  await withStateRoot(async (stateRoot) => {
    const { status, lines, stderr } = await run([SESSION, "--state-root", stateRoot]);
    assert.equal(status, 0, stderr);
    assert.deepEqual(lines, [
      "2026-11-14T05:00:00.000Z  Browser tab connected (tab tab:one; user owner)",
      "2026-11-14T05:00:05.000Z  Turn started (Main chat; engine claude; message message_tab_one_1; asked by owner)",
      "2026-11-14T05:01:00.000Z  Browser tab disconnected (tab tab:one; user owner; reason: ping timeout)",
      "2026-11-14T05:01:30.000Z  Browser tab reconnected (tab tab:one; user owner; after 30 s offline)",
      "2026-11-14T05:02:00.000Z  Cancel requested (temporary chat c-2; engine claude; asked by owner; reason: cancel-message; " +
        "via POST /api/app/:slug/vibe64/sessions/:sessionId/agent-turn/interrupt)",
      "2026-11-14T05:02:01.000Z  Turn cancelled (temporary chat c-2; engine claude)",
      "2026-11-14T05:03:00.000Z  Request failed (GET /api/x/:sessionId; status 503; code vibe64_busy)"
    ]);
  });
});

test("vibe64 timeline filters by time window and kind, and prints JSON lines for tools", async () => {
  await withStateRoot(async (stateRoot) => {
    const env = { VIBE64_SYSTEM_ROOT: stateRoot };
    const window = await run([SESSION, "--since", "2026-11-14T05:01:00Z", "--until", "2026-11-14T05:02:00Z"], env);
    assert.deepEqual(window.lines.map((line) => line.split("  ")[1]), [
      "Browser tab disconnected (tab tab:one; user owner; reason: ping timeout)",
      "Browser tab reconnected (tab tab:one; user owner; after 30 s offline)"
    ]);
    const recent = await run([SESSION, "--since", "58m", "--kind", "turn,request"], env);
    assert.deepEqual(recent.lines.map((line) => line.slice(0, 24)), ["2026-11-14T05:02:00.000Z", "2026-11-14T05:02:01.000Z",
      "2026-11-14T05:03:00.000Z"]);
    const json = await run([SESSION, "--json", "--kind", "connection"], env);
    assert.deepEqual(json.lines.map((line) => JSON.parse(line)).map(({ project, session, event }) => [project, session, event]), [
      ["shop", SESSION, "connected"],
      ["shop", SESSION, "disconnected"],
      ["shop", SESSION, "reconnected"]
    ]);
  });
});

test("vibe64 timeline lists the timelines, finds each session's project and refuses what it cannot answer", async () => {
  await withStateRoot(async (stateRoot) => {
    const list = await run(["--state-root", stateRoot]);
    assert.equal(list.status, 0);
    // Both of the session's files count: about 1.2 KB, shown rounded up.
    assert.match(list.lines[0], new RegExp(`^\\S+  shop ${SESSION}  2 KB$`, "u"));
    assert.match(list.lines[1], /^2026-11-13T10:00:00.000Z {2}blog 2026-11-13_10-00-00 {2}1 KB$/u);
    const missing = await run(["2026-01-01_00-00-00", "--state-root", stateRoot]);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /No timeline for session 2026-01-01_00-00-00/u);
    await mkdir(path.join(stateRoot, "projects", "blog", "timeline"), { recursive: true });
    await writeFile(path.join(stateRoot, "projects", "blog", "timeline", `${SESSION}.jsonl`), event(new Date(NOW).toISOString(), "server", "stopping"));
    const ambiguous = await run([SESSION, "--state-root", stateRoot]);
    assert.equal(ambiguous.status, 1);
    assert.match(ambiguous.stderr, /several projects \(blog, shop\)|several projects \(shop, blog\)/u);
    const chosen = await run([SESSION, "--state-root", stateRoot, "--project", "blog"]);
    assert.deepEqual(chosen.lines.map((line) => line.split("  ")[1]), ["Vibe64 server stopping"]);
    for (const argv of [["../etc"], ["--kind", "chat"], ["--since", "yesterday"], ["a", "b"], ["--nope"]]) {
      const refused = await run([...argv, "--state-root", stateRoot]);
      assert.equal(refused.status, 2, argv.join(" "));
      assert.match(refused.stderr, /Usage: vibe64 timeline/u);
    }
  });
});
