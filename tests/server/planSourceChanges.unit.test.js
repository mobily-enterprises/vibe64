import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, stat, symlink, unlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { promisify } from "node:util";
import { parseStatus, planChangesSinceMark, readSourceState, sourceChangesSince } from "../../packages/vibe64-terminals/src/server/planSourceChanges.js";
import { manageWorkPlan, readWorkPlan, readWorkPlanMark, readWorkPlanPage } from "../../packages/vibe64-terminals/src/server/assistantWorkPlan.js";

const run = promisify(execFile);

/** A session whose source and one connected copy are Git repositories with one commit each. */
async function session(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-plan-source-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const source = path.join(root, "sessions", "active", "session-1", "source");
  const copy = path.join(root, "sessions", "active", "session-1", "connected", "shared-kit");
  const repositories = {};
  for (const [name, folder] of [["source", source], ["copy", copy]]) {
    await mkdir(folder, { recursive: true });
    const git = async (...args) => (await run("git", args, { cwd: folder })).stdout.trim();
    await git("init", "--quiet", "--initial-branch=main");
    await git("config", "user.name", "Vibe64 Test");
    await git("config", "user.email", "vibe64@example.test");
    await writeFile(path.join(folder, "README.md"), "Start\n");
    await git("add", "-A");
    await git("commit", "--quiet", "-m", "Start");
    repositories[name] = { folder, git, head: await git("rev-parse", "HEAD") };
  }
  const metadata = {
    source_path: source,
    source_path_authority: "managed_session_source",
    source_kind: "session_clone",
    connected_copies: JSON.stringify({ "shared-kit": { repository: "acme/shared-kit", branch: "main", path: copy,
      baseCommit: repositories.copy.head, canonicalCommit: repositories.copy.head } })
  };
  const store = { paths: () => ({ sessionRoot: path.join(root, "sessions", "session-1") }) };
  return { root, source, copy, repositories, session: { sessionId: "session-1", metadata },
    context: { runtime: { store, stateRoot: root }, session: { sessionId: "session-1", metadata } } };
}

const write = (folder, file, text) => mkdir(path.dirname(path.join(folder, file)), { recursive: true })
  .then(() => writeFile(path.join(folder, file), text));

test("Git's porcelain status gives HEAD and every changed, renamed, conflicted and untracked path", () => {
  const head = "a".repeat(40);
  const output = [
    `# branch.oid ${head}`, "# branch.head main",
    "1 .M N... 100644 100644 100644 abc abc src/changed file.js",
    "2 R. N... 100644 100644 100644 abc abc R100 src/new.js", "src/old.js",
    "u UU N... 100644 100644 100644 100644 a b c src/conflict.js",
    "? notes/todo.md", ""
  ].join("\0");
  assert.deepEqual(parseStatus(output), { head, paths: ["notes/todo.md", "src/changed file.js", "src/conflict.js", "src/new.js", "src/old.js"] });
  // A repository with no commit yet has no HEAD to compare.
  assert.equal(parseStatus("# branch.oid (initial)\0").head, "");
});

test("the files changed since a source state: commits, new, changed again, reverted and deleted files, in the source and its connected copies", async (t) => {
  const f = await session(t);
  const { source: own, copy } = f.repositories;
  await write(f.source, "draft.md", "kept as it was\n");
  await write(f.source, "README.md", "Dirty before\n");
  const before = await readSourceState(f.session);
  assert.deepEqual(before.repositories.map(({ name, head }) => [name, head]), [["", own.head], ["shared-kit", copy.head]]);
  assert.deepEqual(await sourceChangesSince(before, f.session), { files: [], more: false }, "nothing changed yet");
  // Committed work, a new untracked file, a file changed again, and work in the connected copy.
  await write(f.source, "src/threads.js", "export const threads = [];\n");
  await own.git("add", "src/threads.js");
  await own.git("commit", "--quiet", "-m", "Threads");
  await write(f.source, "src/list.js", "export const list = [];\n");
  await write(f.source, "README.md", "Dirty before, and changed again in the turn\n");
  await write(f.copy, "lib/thread.js", "export {};\n");
  assert.deepEqual(await sourceChangesSince(before, f.session), {
    files: ["README.md", "connected/shared-kit/lib/thread.js", "src/list.js", "src/threads.js"], more: false
  });
  // A file put back to the last commit, or deleted, changed too; a file left as it was did not.
  await own.git("checkout", "--quiet", "--", "README.md");
  await unlink(path.join(f.source, "src/list.js"));
  assert.deepEqual((await sourceChangesSince(before, f.session)).files,
    ["README.md", "connected/shared-kit/lib/thread.js", "src/threads.js"]);
  // A HEAD Git no longer has can't be compared: the count says there may be more.
  const lost = structuredClone(before);
  lost.repositories[0].head = "f".repeat(40);
  assert.equal((await sourceChangesSince(lost, f.session)).more, true);
  // No earlier state, or no source, compares nothing.
  assert.equal(await sourceChangesSince(null, f.session), null);
  assert.equal(await readSourceState({ sessionId: "session-1", metadata: {} }), null);
});

test("reading the source's state never writes its Git index", async (t) => {
  const f = await session(t);
  const index = path.join(f.source, ".git", "index");
  const { mtimeMs } = await stat(index);
  // Touched, not changed: an ordinary git status would refresh the index entry and write the index.
  const later = new Date(Date.now() + 60_000);
  await utimes(path.join(f.source, "README.md"), later, later);
  await readSourceState(f.session);
  await readSourceState(f.session);
  assert.equal((await stat(index)).mtimeMs, mtimeMs, "git status ran without optional locks");
});

const PLAN = "# Contact threads\n\n- [ ] Store contact threads\n- [ ] List a contact's threads\n";

test("the plan's update record: each AI change and plan checked record when and the source then; the plan view counts files changed since", async (t) => {
  const f = await session(t);
  const sourceState = () => readSourceState(f.session);
  const revisions = async () => {
    const current = await readWorkPlan(f.context);
    return { expectedRevision: current.revision, expectedProgressRevision: current.progressRevision || "" };
  };
  // Without a record (a plan from before this change), the view has only when the plan was saved.
  await manageWorkPlan(f.context, { operation: "new", text: PLAN }, "senior");
  let page = await readWorkPlanPage(f.context);
  assert.equal(page.current.updatedHow, "saved");
  assert.ok(Number.isFinite(Date.parse(page.current.updatedAt)));
  assert.equal(await planChangesSinceMark(f.context), null, "no record, no count");
  // Senior's write records the source as it was.
  await manageWorkPlan(f.context, { operation: "write", text: PLAN.replace("threads\n-", "threads (the store the others use)\n-"), ...await revisions() },
    "senior", { sourceState });
  const written = await readWorkPlanMark(f.context);
  assert.equal(written.how, "updated");
  assert.equal(written.source.repositories.length, 2);
  page = await readWorkPlanPage(f.context);
  assert.deepEqual([page.current.updatedAt, page.current.updatedHow], [written.at, "updated"]);
  assert.deepEqual(await planChangesSinceMark(f.context), { files: 0, more: false });
  // Work since: two files, which the record counts.
  await write(f.source, "src/threads.js", "export const threads = [];\n");
  await write(f.copy, "lib/thread.js", "export {};\n");
  assert.deepEqual((await sourceChangesSince(written.source, f.session)).files, ["connected/shared-kit/lib/thread.js", "src/threads.js"]);
  const { revision } = await readWorkPlan(f.context);
  // plan checked changes nothing in the plan, records that it was checked, and needs the paired revisions and a role that ticks.
  await assert.rejects(manageWorkPlan(f.context, { operation: "checked", expectedRevision: "0".repeat(64) }, "junior", { sourceState }),
    { code: "vibe64_work_plan_changed" });
  await assert.rejects(manageWorkPlan(f.context, { operation: "checked", ...await revisions() }, "user", { sourceState }),
    { code: "vibe64_work_plan_senior_required" });
  const checked = await manageWorkPlan(f.context, { operation: "checked", ...await revisions() }, "junior", { sourceState });
  assert.match(checked.notice, /its marks and Progress stay as they are/u);
  assert.equal((await readWorkPlan(f.context)).revision, revision, "the plan is unchanged");
  const mark = await readWorkPlanMark(f.context);
  assert.equal(mark.how, "checked");
  assert.ok(Date.parse(mark.at) >= Date.parse(written.at));
  assert.deepEqual(await sourceChangesSince(mark.source, f.session), { files: [], more: false }, "checked counts as up to date");
  // The plan view counts what changed since the latest record.
  await write(f.source, "src/list.js", "export const list = [];\n");
  assert.deepEqual(await planChangesSinceMark(f.context), { files: 1, more: false });
  page = await readWorkPlanPage(f.context);
  assert.deepEqual([page.current.updatedAt, page.current.updatedHow], [mark.at, "checked"]);
  // An unreadable record is refused, never read as current: the plan stays readable with no update time to show.
  const markFile = path.join(f.root, "sessions", "session-1", "plans", "updated.json");
  await writeFile(markFile, "{\"schemaVersion\":1,\"at\":\"later\",\"how\":\"updated\",\"source\":null}\n");
  await assert.rejects(readWorkPlanMark(f.context), { code: "vibe64_work_plan_mark_invalid" });
  await assert.rejects(planChangesSinceMark(f.context), { code: "vibe64_work_plan_mark_invalid" });
  page = await readWorkPlanPage(f.context);
  assert.deepEqual([page.current.updatedAt, page.current.updatedHow], ["", ""]);
  // So is a link in its place.
  await unlink(markFile);
  await symlink(path.join(f.root, "elsewhere.json"), markFile);
  await assert.rejects(readWorkPlanMark(f.context), { code: "vibe64_work_plan_mark_invalid" });
  assert.equal((await readWorkPlanPage(f.context)).current.updatedHow, "");
  // And so is a record Vibe64 is not allowed to read (another account's, or one whose permissions changed).
  if (process.getuid?.() !== 0) {
    await unlink(markFile);
    await writeFile(markFile, JSON.stringify(mark) + "\n");
    await chmod(markFile, 0o000);
    page = await readWorkPlanPage(f.context);
    assert.deepEqual([page.current.updatedAt, page.current.updatedHow], ["", ""]);
    await chmod(markFile, 0o600);
  }
  await unlink(markFile);
  // The AI's next change writes a new record.
  await manageWorkPlan(f.context, { operation: "checked", ...await revisions() }, "junior", { sourceState });
  assert.equal((await readWorkPlanMark(f.context)).how, "checked");
  // Archiving the plan drops its record: the next plan starts without one.
  await manageWorkPlan(f.context, { operation: "archive", ...await revisions() }, "senior");
  assert.equal(await readWorkPlanMark(f.context), null);
});
