import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { appendFile, chmod, lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough, Readable } from "node:stream";
import test from "node:test";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { registerVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { SESSION_SOURCE_PATH_AUTHORITY_MANAGED } from "@local/vibe64-core/server/sessionSourcePath";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server";
import { BACKUP_RETENTION_MS, maintainProjectBackups, withProjectBackupsLock, withProjectDropZoneLock } from "@local/vibe64-runtime/server/projectBackups";
import { runVibe64AgentWriteExclusive } from "@local/vibe64-runtime/server/agentWriteLock";
import { currentProjectRequestContext, runWithProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { createService } from "../../packages/vibe64-source-editor/src/server/service.js";
import { registerRoutes } from "../../packages/vibe64-source-editor/src/server/registerRoutes.js";
import { createSourceEditorActions } from "../../packages/vibe64-source-editor/src/server/actions.js";
import { testRouteApp } from "./vibe64RouteTestHelpers.js";

// Each project has one live session with a managed source checkout (Repo, a
// clean Git checkout), its Session Dropzone and Session tree, plus the
// project's Dropzone and Backups. `sourcesBase` puts the checkouts elsewhere,
// such as on another filesystem.
async function fixture(t, { sourcesBase } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-file-transfers-"));
  const sourcesRoot = sourcesBase ? await mkdtemp(path.join(sourcesBase, "vibe64-file-transfers-")) : root;
  const stores = new Map();
  const sources = new Map();
  for (const slug of ["one", "two"]) {
    const projectRoot = path.join(root, slug);
    await mkdir(projectRoot);
    const store = createVibe64SessionStore({ projectContextRoot: projectRoot, projectRuntimeRoot: path.join(root, `${slug}-state`) });
    await store.createSession({ sessionId: "session-1", runtimeKind: "genesis" });
    const sourceRoot = path.join(sourcesRoot, `${slug}-sources`, "sessions", "active", "session-1", "source");
    await mkdir(path.join(sourceRoot, "src", "lib"), { recursive: true });
    await writeFile(path.join(sourceRoot, "src", "app.js"), `${slug} app`);
    await writeFile(path.join(sourceRoot, "src", "lib", "util.js"), `${slug} util`);
    git(sourceRoot, "init", "--quiet");
    git(sourceRoot, "add", "-A");
    git(sourceRoot, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--quiet", "-m", "Start");
    for (const [name, value] of Object.entries({
      source_kind: "session_clone", source_path: sourceRoot, source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED
    })) await store.writeMetadataValue("session-1", name, value);
    await writeFile(path.join(store.paths("session-1").sessionRoot, "private.txt"), `${slug} private`);
    await writeFile(path.join(store.paths("session-1").dropZoneRoot, "notes.txt"), `${slug} notes`);
    stores.set(slug, store);
    sources.set(slug, sourceRoot);
  }
  const service = createService({ projectService: { async createRuntime() {
    const store = stores.get(currentProjectRequestContext().slug);
    return { store, getSession: store.readSession };
  } } });
  t.after(async () => {
    service.close();
    await rm(root, { recursive: true, force: true });
    await rm(sourcesRoot, { recursive: true, force: true });
  });
  // Session-scoped calls carry the route's session; project-scoped calls have none.
  const call = (operation, input = {}, { role = "member", slug = "one", options } = {}) => runWithProjectRequestContext({
    slug, targetRoot: path.join(root, slug), vibe64User: { username: role, role }
  }, () => service.fileArea({ sessionId: "session-1", area: "drop-zone", ...input }, operation, options));
  const project = (operation, input = {}, options = {}) => call(operation, { sessionId: undefined, ...input }, options);
  const paths = (slug = "one") => ({
    ...stores.get(slug).paths("session-1"), repo: sources.get(slug), repoStaging: path.join(sources.get(slug), ".git", "vibe64-file-staging")
  });
  return { root, stores, service, call, project, paths };
}

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
}

const upload = (text) => ({ readUpload: async function* () {
  yield { type: "file", fieldname: "file", file: Readable.from([Buffer.from(text)]) };
} });

// What Files left behind: stray hidden items in a folder plus anything in its
// staging folder (or, given Repo's staging folder, everything in it).
const STAGING = ".vibe64-staging";
async function leftovers(directory) {
  const names = await readdir(directory).catch(() => []);
  if (path.basename(directory) === "vibe64-file-staging") return names;
  const staged = names.includes(STAGING) ? await readdir(path.join(directory, STAGING)) : [];
  return [...names.filter((name) => name.startsWith(".vibe64") && name !== STAGING), ...staged];
}
// A folder's items as Files shows them.
const visible = async (directory) => (await readdir(directory)).filter((name) => name !== STAGING);

async function waitFor(condition) {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting.");
}

// An upload whose body the test feeds by hand.
function slowUpload() {
  const body = new PassThrough();
  return { body, options: { readUpload: async function* () {
    yield { type: "file", fieldname: "file", file: body };
  } } };
}

test("session Files lists Repo, Session Dropzone and owner-only Session; Project Backups moved to the project", async (t) => {
  const { call } = await fixture(t);
  assert.deepEqual((await call("areas")).areas, ["repo", "drop-zone"]);
  assert.deepEqual((await call("areas", {}, { role: "owner" })).areas, ["repo", "drop-zone", "session"]);
});

test("project areas need no session, keep project boundaries, and start empty without creating folders", async (t) => {
  const { project, call, paths } = await fixture(t);
  for (const area of ["project-drop-zone", "backups"]) {
    const empty = await project("tree", { area });
    assert.equal(empty.ok, true, area);
    assert.deepEqual(empty.tree.children, []);
    await assert.rejects(lstat(empty.location), { code: "ENOENT" });
    assert.equal((await project("upload", { area, path: "shared.txt" }, { options: upload(`${area} bytes`) })).ok, true);
    assert.equal((await project("file", { area, path: "shared.txt" })).file.text, `${area} bytes`);
    // A session route reaches the same project folder, so it can be a destination.
    assert.equal((await call("file", { area, path: "shared.txt" })).file.text, `${area} bytes`);
    assert.equal((await project("file", { area, path: "shared.txt" }, { slug: "two" })).ok, false);
    assert.equal((await project("file", { area, path: "../one-state/sessions/active/session-1/private.txt" })).ok, false);
  }
  assert.equal((await project("tree", { area: "project-drop-zone" })).location, path.join(paths().stateRoot, "drop-zone"));
  for (const area of ["repo", "drop-zone", "session"]) {
    assert.equal((await project("tree", { area }, { role: "owner" })).statusCode, 400, area);
  }
});

test("new text files are created once in writable areas and never in Session or Repo through Files", async (t) => {
  const { call, project, paths } = await fixture(t);
  for (const [run, area] of [[call, "drop-zone"], [project, "project-drop-zone"], [project, "backups"]]) {
    await run("mkdir", { area, path: "docs" });
    const created = await run("create", { area, path: "docs/todo.md", text: "# Todo\n" });
    assert.equal(created.ok, true, area);
    assert.equal(created.file.text, "# Todo\n");
    assert.equal(created.file.path, "docs/todo.md");
    const again = await run("create", { area, path: "docs/todo.md", text: "replaced?" });
    assert.equal(again.statusCode, 409, area);
    assert.equal((await run("file", { area, path: "docs/todo.md" })).file.text, "# Todo\n");
    const saved = await run("save", { area, path: "docs/todo.md", baseHash: created.file.hash, text: "# Done\n" });
    assert.equal(saved.ok, true);
    assert.equal((await run("create", { area, path: "binary.txt", text: "a\u0000b" })).ok, false);
  }
  assert.equal((await call("create", { area: "session", path: "x.txt", text: "x" }, { role: "owner" })).statusCode, 403);
  assert.equal((await call("create", { area: "repo", path: "x.txt", text: "x" }, { role: "owner" })).statusCode, 404);
  assert.deepEqual(await leftovers(paths().dropZoneRoot), []);
});

test("uploads ask about conflicts: fail by default, replace atomically, or keep both under a new name", async (t) => {
  const { call, paths } = await fixture(t);
  const zone = paths().dropZoneRoot;
  assert.deepEqual((await call("conflicts", { path: "", names: ["notes.txt", "fresh.txt"] })).existing, ["notes.txt"]);
  assert.equal((await call("conflicts", { path: "", names: ["../private.txt"] })).ok, false);
  assert.equal((await call("upload", { path: "notes.txt" }, { options: upload("second") })).statusCode, 409);
  assert.equal(await readFile(path.join(zone, "notes.txt"), "utf8"), "one notes");
  const kept = await call("upload", { path: "notes.txt", conflict: "keep-both" }, { options: upload("second") });
  assert.equal(kept.path, "notes (1).txt");
  assert.equal(await readFile(path.join(zone, "notes (1).txt"), "utf8"), "second");
  assert.equal((await call("upload", { path: "notes.txt", conflict: "replace" }, { options: upload("third") })).path, "notes.txt");
  assert.equal(await readFile(path.join(zone, "notes.txt"), "utf8"), "third");
  assert.deepEqual(await leftovers(zone), []);
});

test("Repo uploads stage inside Git, where status never sees them, and publish as ordinary changes", async (t) => {
  const { call, paths } = await fixture(t);
  const p = paths();
  const status = () => git(p.repo, "status", "--porcelain", "--untracked-files=all");
  const { body, options } = slowUpload();
  const pending = call("upload", { area: "repo", path: "src/lib/data.csv" }, { options });
  body.write("a,b\n");
  await waitFor(async () => (await readdir(p.repoStaging).catch(() => [])).length === 1);
  assert.equal(status(), "");
  assert.deepEqual(await leftovers(path.join(p.repo, "src", "lib")), []);
  // An arriving upload holds no exclusive write: other Repo writes still run.
  assert.equal((await call("transfer", { area: "repo", path: "src/app.js", mode: "copy", targetArea: "repo", targetPath: "", conflict: "keep-both" })).ok, true);
  body.end("1,2\n");
  assert.deepEqual(await pending, { ok: true, path: "src/lib/data.csv" });
  assert.equal(await readFile(path.join(p.repo, "src/lib/data.csv"), "utf8"), "a,b\n1,2\n");
  assert.equal(status(), "?? app.js\n?? src/lib/data.csv\n");
  // Conflicts behave as in every other area.
  assert.equal((await call("upload", { area: "repo", path: "src/app.js" }, { options: upload("again") })).statusCode, 409);
  assert.equal((await call("upload", { area: "repo", path: "src/app.js", conflict: "keep-both" }, { options: upload("both") })).path, "src/app (1).js");
  assert.equal((await call("upload", { area: "repo", path: "src/app.js", conflict: "replace" }, { options: upload("new app") })).path, "src/app.js");
  assert.equal(await readFile(path.join(p.repo, "src/app.js"), "utf8"), "new app");
  assert.match(status(), /^ M src\/app\.js$/mu);
  // A cancelled upload leaves nothing behind, in Repo or in Git.
  const cancelled = slowUpload();
  const failing = call("upload", { area: "repo", path: "src/cancelled.bin" }, { options: cancelled.options });
  cancelled.body.write("partial");
  await waitFor(async () => (await readdir(p.repoStaging)).length === 1);
  cancelled.body.destroy(new Error("The browser cancelled the upload."));
  assert.equal((await failing).ok, false);
  await assert.rejects(lstat(path.join(p.repo, "src/cancelled.bin")), { code: "ENOENT" });
  assert.deepEqual(await readdir(p.repoStaging), []);
  assert.deepEqual(await leftovers(path.join(p.repo, "src")), []);
});

test("Repo uploads refuse protected paths, a held exclusive write and a Git folder outside the checkout", async (t) => {
  const { call, paths, stores } = await fixture(t);
  const p = paths();
  for (const target of [".git/hooks/pre-commit", "src/.git/config", ".vibe64/contract.md", ".GIT/hooks/pre-commit", "src/.Git/config", ".VIBE64/contract.md"]) {
    const refused = await call("upload", { area: "repo", path: target }, { options: upload("x") });
    assert.equal(refused.statusCode, 403, target);
  }
  await assert.rejects(lstat(path.join(p.repo, ".git", "hooks", "pre-commit")), { code: "ENOENT" });
  await assert.rejects(lstat(path.join(p.repo, ".vibe64")), { code: "ENOENT" });
  await assert.rejects(lstat(path.join(p.repo, ".VIBE64")), { code: "ENOENT" });
  // Save, Update and the assistant hold the same exclusive write: a move or
  // copy refuses at once, and a finished upload waits for it to finish.
  let entered;
  let release;
  const holding = new Promise((resolve) => { entered = resolve; });
  const holder = runVibe64AgentWriteExclusive({ store: stores.get("one") }, "session-1", () => new Promise((resolve) => {
    release = resolve;
    entered();
  }));
  await holding;
  const busy = await call("transfer", { path: "notes.txt", mode: "copy", targetArea: "repo", targetPath: "" });
  assert.equal(busy.statusCode, 409);
  assert.equal(busy.code, "vibe64_agent_write_mode_busy");
  let finished = false;
  const waiting = call("upload", { area: "repo", path: "src/waited.txt" }, { options: upload("waited") }).finally(() => { finished = true; });
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.equal(finished, false, "the upload waits for the exclusive write");
  await assert.rejects(lstat(path.join(p.repo, "src/waited.txt")), { code: "ENOENT" });
  release();
  await holder;
  assert.deepEqual(await waiting, { ok: true, path: "src/waited.txt" });
  assert.equal(await readFile(path.join(p.repo, "src/waited.txt"), "utf8"), "waited");
  assert.deepEqual(await readdir(p.repoStaging), []);
  // A checkout whose Git folder lives elsewhere is never staged into.
  const other = paths("two");
  const outside = path.join(path.dirname(other.repo), "elsewhere.git");
  await rename(path.join(other.repo, ".git"), outside);
  await writeFile(path.join(other.repo, ".git"), `gitdir: ${outside}\n`);
  const elsewhere = await call("upload", { area: "repo", path: "src/x.txt" }, { slug: "two", options: upload("x") });
  assert.equal(elsewhere.statusCode, 409);
  assert.equal(elsewhere.code, "vibe64_files_repo_git_unavailable");
  await assert.rejects(lstat(path.join(other.repo, "src/x.txt")), { code: "ENOENT" });
  await assert.rejects(lstat(path.join(outside, "vibe64-file-staging")), { code: "ENOENT" });
});

test("copy and move work between every writable area without downloading", async (t) => {
  const { call, project, paths } = await fixture(t);
  const p = paths();
  const projectZone = path.join(p.stateRoot, "drop-zone");
  // Repo folder -> Session Dropzone (copy keeps the source).
  const copied = await call("transfer", { area: "repo", path: "src", mode: "copy", targetArea: "drop-zone", targetPath: "" });
  assert.equal(copied.ok, true, JSON.stringify(copied));
  assert.equal(copied.path, "src");
  assert.equal(await readFile(path.join(p.dropZoneRoot, "src/lib/util.js"), "utf8"), "one util");
  assert.equal(await readFile(path.join(p.repo, "src/lib/util.js"), "utf8"), "one util");
  // Session Dropzone -> Project Dropzone (move removes the source).
  assert.equal((await call("transfer", { path: "notes.txt", mode: "move", targetArea: "project-drop-zone", targetPath: "" })).ok, true);
  await assert.rejects(lstat(path.join(p.dropZoneRoot, "notes.txt")), { code: "ENOENT" });
  assert.equal(await readFile(path.join(projectZone, "notes.txt"), "utf8"), "one notes");
  // Project Dropzone -> Project Backups on the dashboard (no session).
  await project("mkdir", { area: "backups", path: "kept" });
  assert.equal((await project("transfer", { area: "project-drop-zone", path: "notes.txt", mode: "copy", targetArea: "backups", targetPath: "kept" })).ok, true);
  const backups = await project("tree", { area: "backups", path: "kept" });
  assert.ok(Date.parse(backups.tree.children[0].expiresAt) > Date.now() + 13 * 86400000);
  // Project Dropzone -> a session's Repo from the dashboard.
  const intoRepo = await project("transfer", { area: "project-drop-zone", path: "notes.txt", mode: "move", targetArea: "repo", targetPath: "src", targetSessionId: "session-1" });
  assert.equal(intoRepo.ok, true, JSON.stringify(intoRepo));
  assert.equal(await readFile(path.join(p.repo, "src/notes.txt"), "utf8"), "one notes");
  // Session Dropzone folder -> Repo folder (move within the session).
  assert.equal((await call("transfer", { path: "src/lib", mode: "move", targetArea: "repo", targetPath: "src" })).statusCode, 409);
  const movedFolder = await call("transfer", { path: "src/lib", mode: "move", targetArea: "repo", targetPath: "src", conflict: "keep-both" });
  assert.equal(movedFolder.path, "src/lib (1)");
  assert.equal(await readFile(path.join(p.repo, "src/lib (1)/util.js"), "utf8"), "one util");
  await assert.rejects(lstat(path.join(p.dropZoneRoot, "src/lib")), { code: "ENOENT" });
  for (const directory of [p.dropZoneRoot, projectZone, p.repo, path.join(p.repo, "src"), path.join(p.stateRoot, "backups", "kept"), p.repoStaging]) {
    assert.deepEqual(await leftovers(directory), [], directory);
  }
});

test("name conflicts replace, keep both or skip exactly as chosen", async (t) => {
  const { call, project, paths } = await fixture(t);
  const projectZone = path.join(paths().stateRoot, "drop-zone");
  await project("upload", { area: "project-drop-zone", path: "notes.txt" }, { options: upload("project copy") });
  const refused = await call("transfer", { path: "notes.txt", mode: "move", targetArea: "project-drop-zone", targetPath: "" });
  assert.equal(refused.statusCode, 409);
  assert.equal(refused.code, "vibe64_files_exists");
  assert.equal(await readFile(path.join(paths().dropZoneRoot, "notes.txt"), "utf8"), "one notes");
  const skipped = await call("transfer", { path: "notes.txt", mode: "move", targetArea: "project-drop-zone", targetPath: "", conflict: "skip" });
  assert.equal(skipped.skipped, true);
  assert.equal(await readFile(path.join(projectZone, "notes.txt"), "utf8"), "project copy");
  assert.equal(await readFile(path.join(paths().dropZoneRoot, "notes.txt"), "utf8"), "one notes");
  const both = await call("transfer", { path: "notes.txt", mode: "copy", targetArea: "project-drop-zone", targetPath: "", conflict: "keep-both" });
  assert.equal(both.path, "notes (1).txt");
  const replaced = await call("transfer", { path: "notes.txt", mode: "move", targetArea: "project-drop-zone", targetPath: "", conflict: "replace" });
  assert.equal(replaced.ok, true);
  assert.equal(await readFile(path.join(projectZone, "notes.txt"), "utf8"), "one notes");
  // A folder replaces a folder of the same name as a whole.
  await project("mkdir", { area: "project-drop-zone", path: "src/old" });
  assert.equal((await call("transfer", { area: "repo", path: "src", mode: "copy", targetArea: "project-drop-zone", targetPath: "", conflict: "replace" })).ok, true);
  assert.deepEqual((await readdir(path.join(projectZone, "src"))).sort(), ["app.js", "lib"]);
  // Copying into the same folder keeps both, as a duplicate; a runnable file stays runnable.
  await chmod(path.join(paths().repo, "src", "app.js"), 0o755);
  assert.equal((await call("transfer", { area: "repo", path: "src/app.js", mode: "copy", targetArea: "repo", targetPath: "src", conflict: "keep-both" })).path, "src/app (1).js");
  assert.equal((await lstat(path.join(paths().repo, "src", "app (1).js"))).mode & 0o100, 0o100);
  assert.equal((await lstat(path.join(projectZone, "src", "lib", "util.js"))).mode & 0o111, 0);
  assert.equal((await call("transfer", { area: "repo", path: "src/app.js", mode: "move", targetArea: "repo", targetPath: "src" })).statusCode, 400);
  assert.equal((await call("transfer", { area: "repo", path: "src", mode: "move", targetArea: "repo", targetPath: "src/lib" })).statusCode, 400);
  assert.deepEqual(await leftovers(projectZone), []);
});

test("Session is a copy source for the owner only, never a move source or destination", async (t) => {
  const { call, paths } = await fixture(t);
  assert.equal((await call("transfer", { area: "session", path: "private.txt", mode: "copy", targetArea: "drop-zone", targetPath: "" })).statusCode, 403);
  assert.equal((await call("transfer", { area: "session", path: "private.txt", mode: "move", targetArea: "drop-zone", targetPath: "" }, { role: "owner" })).statusCode, 403);
  assert.equal((await call("transfer", { path: "notes.txt", mode: "copy", targetArea: "session", targetPath: "" }, { role: "owner" })).statusCode, 403);
  const copied = await call("transfer", { area: "session", path: "private.txt", mode: "copy", targetArea: "drop-zone", targetPath: "" }, { role: "owner" });
  assert.equal(copied.ok, true, JSON.stringify(copied));
  assert.equal(await readFile(path.join(paths().dropZoneRoot, "private.txt"), "utf8"), "one private");
  assert.equal(await readFile(path.join(paths().sessionRoot, "private.txt"), "utf8"), "one private");
});

test("transfers refuse links, traversal, protected Repo paths, other projects and busy locks, leaving nothing partial", async (t) => {
  const { call, project, paths } = await fixture(t);
  const p = paths();
  await mkdir(path.join(p.dropZoneRoot, "linked"));
  await symlink(p.sessionRoot, path.join(p.dropZoneRoot, "linked", "escape"));
  assert.equal((await call("transfer", { path: "linked", mode: "copy", targetArea: "project-drop-zone", targetPath: "" })).ok, false);
  assert.equal((await call("transfer", { path: "linked/escape/private.txt", mode: "copy", targetArea: "project-drop-zone", targetPath: "" })).ok, false);
  await symlink(p.sessionRoot, path.join(p.dropZoneRoot, "to-session"));
  assert.equal((await call("transfer", { area: "repo", path: "src/app.js", mode: "copy", targetArea: "drop-zone", targetPath: "to-session" })).ok, false);
  assert.equal((await call("transfer", { area: "repo", path: "src/app.js", mode: "copy", targetArea: "drop-zone", targetPath: "../" })).ok, false);
  assert.equal((await call("transfer", { area: "repo", path: "../one-state/backups", mode: "copy", targetArea: "drop-zone", targetPath: "" })).ok, false);
  // Repo never receives the Git directory or the protected source contract.
  for (const [item, inside] of [["bundle", ".git"], [".vibe64", ""]]) {
    await mkdir(path.join(p.dropZoneRoot, item, inside), { recursive: true });
    await writeFile(path.join(p.dropZoneRoot, item, inside, "config"), "x");
    assert.equal((await call("transfer", { path: item, mode: "copy", targetArea: "repo", targetPath: "" })).statusCode, 403, item);
    await rm(path.join(p.dropZoneRoot, item), { recursive: true });
  }
  assert.deepEqual((await readdir(p.repo)).sort(), [".git", "src"]);
  assert.equal((await call("transfer", { area: "repo", path: ".git", mode: "copy", targetArea: "drop-zone", targetPath: "" })).statusCode, 403);
  // A session from another project never resolves.
  assert.equal((await project("transfer", { area: "backups", path: "x", mode: "copy", targetArea: "drop-zone", targetSessionId: "session-1", targetPath: "" }, { slug: "two" })).ok, false);
  assert.equal((await call("transfer", { path: "notes.txt", mode: "copy", targetArea: "drop-zone", targetSessionId: "../two-state", targetPath: "" })).ok, false);
  // Project Backups maintenance holds its lock: the transfer reports busy and changes nothing.
  await withProjectBackupsLock(p.stateRoot, async () => {
    const busy = await call("transfer", { path: "notes.txt", mode: "move", targetArea: "backups", targetPath: "" });
    assert.equal(busy.ok, false);
  });
  assert.equal(await readFile(path.join(p.dropZoneRoot, "notes.txt"), "utf8"), "one notes");
  // A copy that fails midway removes everything it staged.
  if (process.getuid?.() !== 0) {
    await mkdir(path.join(p.dropZoneRoot, "partial"));
    await writeFile(path.join(p.dropZoneRoot, "partial", "a.txt"), "a");
    await writeFile(path.join(p.dropZoneRoot, "partial", "b.txt"), "b");
    await chmod(path.join(p.dropZoneRoot, "partial", "b.txt"), 0o000);
    const failed = await call("transfer", { path: "partial", mode: "copy", targetArea: "project-drop-zone", targetPath: "" });
    assert.equal(failed.ok, false);
    const projectZone = path.join(p.stateRoot, "drop-zone");
    assert.deepEqual((await visible(projectZone)).filter((name) => name !== "notes.txt"), []);
    assert.deepEqual(await leftovers(projectZone), []);
    await chmod(path.join(p.dropZoneRoot, "partial", "b.txt"), 0o600);
  }
});

test("HTTP project routes, transfers and inline image previews keep trusted identity and content types", async (t) => {
  const { root, service, paths } = await fixture(t);
  const server = Fastify();
  await server.register(multipart);
  server.addHook("preHandler", async (request) => {
    request.vibe64User = { username: "test", role: request.headers["x-test-role"] || "member" };
  });
  const app = testRouteApp();
  const projectContext = {
    projectsRoot: root,
    async readWorkspaceProject({ slug }) {
      if (!["one", "two"].includes(slug)) throw Object.assign(new Error("Missing project"), { code: "vibe64_project_route_unavailable" });
      return { project: { path: path.join(root, slug) } };
    }
  };
  const actions = createActionCatalogue();
  actions.register({ contributorId: "source", domain: "source", actions: createSourceEditorActions({ sourceEditor: service }).map((action) => ({
    channels: ["api"], surfaces: ["app"], ...action
  })) });
  registerVibe64ActionContext(actions, { projectContext,
    resolveUser: async ({ request }) => request.vibe64User, authorizeProject: async () => {}
  });
  server.addHook("preHandler", async (request) => {
    request.executeAction = ({ actionId, input, context }) => actions.execute({ actionId, input,
      context: { ...context, channel: "api", surface: "app", requestMeta: { request } }
    });
  });
  registerRoutes(app.http, { sourceEditor: service, routeRelativePath: "vibe64", projectContext });
  for (const route of app.registeredRoutes) server.route({ method: route.method, url: route.path, handler: route.handler, bodyLimit: route.options.bodyLimit });
  await server.listen({ host: "127.0.0.1", port: 0 });
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.server.address().port}/api/app/one/vibe64`;
  const projectFiles = `${origin}/project-files`;
  const json = (body) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
  const data = new FormData();
  data.append("file", new Blob([png]), "pixel.png");
  assert.equal((await fetch(`${projectFiles}/project-drop-zone/upload?path=pixel.png`, { method: "POST", body: data })).status, 200);
  const created = await fetch(`${projectFiles}/backups/file`, json({ path: "readme.txt", text: "hello" }));
  assert.equal(created.status, 200, await created.text());
  assert.equal((await fetch(`${projectFiles}/session/tree`)).status, 403);
  assert.equal((await fetch(`${projectFiles}/session/tree`, { headers: { "x-test-role": "owner" } })).status, 400);
  const conflicts = await (await fetch(`${projectFiles}/backups/conflicts`, json({ path: "", names: ["readme.txt", "other"] }))).json();
  assert.deepEqual(conflicts.existing, ["readme.txt"]);
  const moved = await fetch(`${projectFiles}/project-drop-zone/transfer`, json({ path: "pixel.png", mode: "move", targetArea: "backups", targetPath: "" }));
  assert.equal(moved.status, 200, await moved.text());
  const inline = await fetch(`${projectFiles}/backups/download?path=pixel.png&inline=1`);
  assert.equal(inline.headers.get("content-type"), "image/png");
  assert.equal(inline.headers.get("content-disposition"), "inline");
  assert.match(inline.headers.get("content-security-policy"), /sandbox/u);
  assert.deepEqual(Buffer.from(await inline.arrayBuffer()), png);
  await writeFile(path.join(paths().stateRoot, "backups", "logo.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script></svg>");
  const svg = await fetch(`${projectFiles}/backups/download?path=logo.svg&inline=1`);
  assert.equal(svg.headers.get("content-type"), "image/svg+xml");
  assert.match(svg.headers.get("content-security-policy"), /script-src 'none'|default-src 'none'/u);
  assert.match(svg.headers.get("content-security-policy"), /sandbox/u);
  const text = await fetch(`${projectFiles}/backups/download?path=readme.txt&inline=1`);
  assert.equal(text.headers.get("content-type"), "application/octet-stream");
  assert.match(text.headers.get("content-disposition"), /^attachment;/u);
  const repoImage = await fetch(`${origin}/sessions/session-1/source-editor/download?path=src/app.js&inline=1`);
  assert.match(repoImage.headers.get("content-disposition"), /^attachment;/u);
  // The session route reaches project areas as destinations with the same rules.
  const sessionFiles = `${origin}/sessions/session-1/files`;
  const copied = await fetch(`${sessionFiles}/repo/transfer`, json({ path: "src/app.js", mode: "copy", targetArea: "project-drop-zone", targetPath: "" }));
  assert.equal(copied.status, 200, await copied.text());
  const repoUpload = await fetch(`${sessionFiles}/repo/upload?path=src/pixel.png`, { method: "POST", body: data });
  assert.equal(repoUpload.status, 200, await repoUpload.text());
  assert.deepEqual(await readFile(path.join(paths().repo, "src", "pixel.png")), png);
  const spoofed = await fetch(`${sessionFiles}/session/transfer?vibe64User[role]=owner`, json({ path: "private.txt", mode: "copy", targetArea: "drop-zone", targetPath: "" }));
  assert.equal(spoofed.status, 403);
});

// Swaps <dir>/sub between a real folder and a link to <target> until killed,
// as an agent racing a Files copy could.
const SWAP_FOLDER_FOR_LINK = `
import { renameSync, symlinkSync, unlinkSync } from "node:fs";
import path from "node:path";
const [dir, target] = process.argv.slice(1);
const sub = path.join(dir, "sub");
const real = path.join(dir, "sub.real");
for (;;) {
  try {
    renameSync(sub, real);
    symlinkSync(target, sub);
    for (let spin = 0; spin < 200000; spin += 1);
    unlinkSync(sub);
    renameSync(real, sub);
    for (let spin = 0; spin < 200000; spin += 1);
  } catch { /* keep racing */ }
}`;

test("a folder swapped for a link mid-copy never pulls in files from outside the area", { timeout: 60_000 }, async (t) => {
  const { call, paths } = await fixture(t);
  const p = paths();
  const bait = path.join(p.dropZoneRoot, "bait");
  await mkdir(path.join(bait, "sub"), { recursive: true });
  await writeFile(path.join(bait, "sub", "private.txt"), "decoy");
  assert.equal((await call("file", { area: "session", path: "private.txt" })).statusCode, 403);
  const racer = spawn(process.execPath, ["--input-type=module", "-e", SWAP_FOLDER_FOR_LINK, bait, p.sessionRoot], { stdio: "ignore" });
  const exited = new Promise((resolve) => racer.once("exit", resolve));
  const projectZone = path.join(p.stateRoot, "drop-zone");
  const leaked = [];
  try {
    const deadline = Date.now() + 4000;
    for (let attempt = 0; attempt < 3000 && Date.now() < deadline && !leaked.length; attempt += 1) {
      const result = await call("transfer", { path: "bait", mode: "copy", targetArea: "project-drop-zone", targetPath: "", conflict: "keep-both" });
      if (!result.ok) continue;
      const copied = await readFile(path.join(projectZone, result.path, "sub", "private.txt"), "utf8").catch(() => "");
      if (copied === "one private") leaked.push(result.path);
    }
  } finally {
    racer.kill("SIGKILL");
    await exited;
  }
  assert.deepEqual(leaked, []);
  assert.deepEqual(await leftovers(projectZone), []);
});

test("Replace refuses to delete the item's own source or a folder holding it", async (t) => {
  const { call, paths } = await fixture(t);
  const p = paths();
  await mkdir(path.join(p.dropZoneRoot, "docs", "sub", "docs"), { recursive: true });
  await writeFile(path.join(p.dropZoneRoot, "docs", "sub", "docs", "a.txt"), "a");
  await writeFile(path.join(p.dropZoneRoot, "docs", "keep.txt"), "unrelated work");
  await mkdir(path.join(p.repo, "src", "src"));
  await writeFile(path.join(p.repo, "src", "src", "x.js"), "x");
  for (const [area, source] of [["drop-zone", "docs/sub/docs"], ["repo", "src/src"]]) {
    for (const mode of ["copy", "move"]) {
      const refused = await call("transfer", { area, path: source, mode, targetArea: area, targetPath: "", conflict: "replace" });
      assert.equal(refused.statusCode, 400, `${area} ${mode}`);
      assert.equal(refused.code, "vibe64_files_invalid_destination");
    }
  }
  assert.equal(await readFile(path.join(p.dropZoneRoot, "docs", "sub", "docs", "a.txt"), "utf8"), "a");
  assert.equal(await readFile(path.join(p.dropZoneRoot, "docs", "keep.txt"), "utf8"), "unrelated work");
  assert.equal(await readFile(path.join(p.repo, "src", "src", "x.js"), "utf8"), "x");
  assert.equal(await readFile(path.join(p.repo, "src", "app.js"), "utf8"), "one app");
});

test("Replace into Repo never deletes a folder holding protected content", async (t) => {
  const { call, paths } = await fixture(t);
  const p = paths();
  await mkdir(path.join(p.repo, "src", "lib", ".git"));
  await writeFile(path.join(p.repo, "src", "lib", ".git", "HEAD"), "ref: refs/heads/main\n");
  await mkdir(path.join(p.dropZoneRoot, "lib"));
  await writeFile(path.join(p.dropZoneRoot, "lib", "new.js"), "new");
  const refused = await call("transfer", { path: "lib", mode: "copy", targetArea: "repo", targetPath: "src", conflict: "replace" });
  assert.equal(refused.statusCode, 403);
  assert.equal(refused.code, "vibe64_files_protected_entry");
  assert.equal(await readFile(path.join(p.repo, "src", "lib", ".git", "HEAD"), "utf8"), "ref: refs/heads/main\n");
  assert.equal(await readFile(path.join(p.repo, "src", "lib", "util.js"), "utf8"), "one util");
  assert.deepEqual(await leftovers(p.repoStaging), []);
});

test("a folder moved into Project Backups starts its 14 days at the move, keeping modification times", async (t) => {
  const { call, project, paths } = await fixture(t);
  const p = paths();
  await mkdir(path.join(p.dropZoneRoot, "folder"));
  await writeFile(path.join(p.dropZoneRoot, "folder", "inside.txt"), "inside");
  const before = await lstat(path.join(p.dropZoneRoot, "folder", "inside.txt"));
  await new Promise((resolve) => setTimeout(resolve, 100));
  const moveTime = Date.now();
  assert.equal((await call("transfer", { path: "folder", mode: "move", targetArea: "backups", targetPath: "" })).ok, true);
  const backups = path.join(p.stateRoot, "backups");
  const inside = await lstat(path.join(backups, "folder", "inside.txt"));
  assert.equal(inside.ino, before.ino, "moved by rename, not copied");
  assert.ok(Math.abs(inside.mtimeMs - before.mtimeMs) < 1, "modification time kept");
  const listed = (await project("tree", { area: "backups", path: "folder" })).tree.children[0];
  assert.ok(Date.parse(listed.expiresAt) >= moveTime + BACKUP_RETENTION_MS - 50, listed.expiresAt);
  await maintainProjectBackups({ stateRoot: p.stateRoot, now: moveTime + BACKUP_RETENTION_MS - 60 });
  assert.equal(await readFile(path.join(backups, "folder", "inside.txt"), "utf8"), "inside");
});

test("Project Dropzone is created for agents, refuses a file in its place, and takes a lock like Backups", async (t) => {
  const { project, paths, stores } = await fixture(t);
  const p = paths();
  await writeFile(p.projectDropZoneRoot, "what `cp report.pdf \"$VIBE64_PROJECT_DROP_ZONE\"` makes");
  for (const [operation, options] of [["tree", {}], ["upload", { options: upload("x") }]]) {
    const refused = await project(operation, { area: "project-drop-zone", path: operation === "upload" ? "x.txt" : "" }, options);
    assert.equal(refused.statusCode, 409, operation);
    assert.equal(refused.code, "vibe64_files_area_not_folder");
  }
  // Preparing for an agent leaves a file at either path alone and prepares the other.
  await writeFile(p.projectBackupsRoot, "an older agent's copy");
  await stores.get("one").prepareProjectFileAreas();
  assert.equal(await readFile(p.projectDropZoneRoot, "utf8"), "what `cp report.pdf \"$VIBE64_PROJECT_DROP_ZONE\"` makes");
  assert.equal(await readFile(p.projectBackupsRoot, "utf8"), "an older agent's copy");
  await rm(p.projectBackupsRoot);
  await stores.get("one").prepareProjectFileAreas();
  assert.ok((await lstat(p.projectBackupsRoot)).isDirectory());
  await rm(p.projectDropZoneRoot);
  await stores.get("one").prepareProjectFileAreas();
  for (const root of [p.projectDropZoneRoot, p.projectBackupsRoot]) assert.ok((await lstat(root)).isDirectory(), root);
  await withProjectDropZoneLock(p.stateRoot, async () => {
    const busy = await project("upload", { area: "project-drop-zone", path: "busy.txt" }, { options: upload("busy") });
    assert.equal(busy.statusCode, 409);
    assert.equal(busy.code, "project_drop_zone_busy");
    assert.equal((await project("mkdir", { area: "project-drop-zone", path: "later" })).code, "project_drop_zone_busy");
  });
  assert.deepEqual(await visible(p.projectDropZoneRoot), []);
  assert.deepEqual(await leftovers(p.projectDropZoneRoot), []);
});

test("each area stages in its own hidden folder; its next write clears only items abandoned there over a week ago", async (t) => {
  const { call, project, paths } = await fixture(t);
  const p = paths();
  const projectZone = path.join(p.stateRoot, "drop-zone");
  const stagingFolders = [p.repoStaging, path.join(p.dropZoneRoot, STAGING), path.join(projectZone, STAGING)];
  for (const folder of stagingFolders) await mkdir(path.join(folder, "old"), { recursive: true });
  // A person's or agent's own item that merely looks like a staged one.
  await writeFile(path.join(p.dropZoneRoot, ".vibe64-incoming-mine"), "mine");
  await new Promise((resolve) => setTimeout(resolve, 50));
  for (const folder of stagingFolders) await writeFile(path.join(folder, "recent"), "recent");
  const old = await lstat(path.join(p.repoStaging, "old"));
  const recent = await lstat(path.join(p.repoStaging, "recent"));
  t.mock.timers.enable({ apis: ["Date"], now: Math.round((old.ctimeMs + recent.ctimeMs) / 2) + 7 * 24 * 60 * 60 * 1000 });
  assert.equal((await call("upload", { area: "repo", path: "fresh.txt" }, { options: upload("fresh") })).ok, true);
  assert.equal((await call("mkdir", { path: "fresh" })).ok, true);
  assert.equal((await project("mkdir", { area: "project-drop-zone", path: "fresh" })).ok, true);
  t.mock.timers.reset();
  for (const folder of stagingFolders) assert.deepEqual(await readdir(folder), ["recent"], folder);
  assert.equal(await readFile(path.join(p.dropZoneRoot, ".vibe64-incoming-mine"), "utf8"), "mine");
  // Files hides the staging folder and never lets anyone use its name.
  const listed = (await call("tree", { path: "" })).tree.children.map((entry) => entry.name);
  assert.ok(listed.includes(".vibe64-incoming-mine") && !listed.includes(STAGING), listed.join(", "));
  for (const [operation, input, options] of [
    ["upload", { path: `${STAGING}/x.txt` }, { options: upload("x") }],
    ["mkdir", { path: STAGING }],
    ["create", { path: `${STAGING}/x.txt`, text: "x" }],
    ["rename", { path: "fresh", destination: STAGING }],
    ["delete", { path: STAGING }],
    ["tree", { path: STAGING }],
    ["file", { path: `${STAGING}/recent` }],
    ["transfer", { path: "notes.txt", mode: "copy", targetArea: "drop-zone", targetPath: STAGING }]
  ]) {
    assert.equal((await call(operation, input, options)).statusCode, 403, operation);
  }
  assert.deepEqual(await readdir(path.join(p.dropZoneRoot, STAGING)), ["recent"]);
});

test("a staging folder that is not a folder of the area is never written through", async (t) => {
  const { call, paths } = await fixture(t);
  const p = paths();
  const before = (await readdir(p.sessionRoot)).sort();
  await symlink(p.sessionRoot, path.join(p.dropZoneRoot, STAGING));
  await symlink(p.sessionRoot, p.repoStaging);
  for (const [area, target, folder] of [["drop-zone", "in.txt", ""], ["repo", "src/in.txt", "src"]]) {
    const refused = await call("upload", { area, path: target }, { options: upload("diverted?") });
    assert.equal(refused.statusCode, 409, area);
    assert.equal(refused.code, "vibe64_files_staging_unavailable");
    const copied = await call("transfer", { path: "notes.txt", mode: "copy", targetArea: area, targetPath: folder, conflict: "keep-both" });
    assert.equal(copied.code, "vibe64_files_staging_unavailable", area);
  }
  assert.deepEqual((await readdir(p.sessionRoot)).sort(), before);
});

test("one move or copy carries at most 2 GiB; a move on one filesystem renames whatever its size", async (t) => {
  const { call, paths } = await fixture(t);
  const p = paths();
  const large = await open(path.join(p.dropZoneRoot, "large.bin"), "w");
  await large.truncate(2 * 1024 ** 3 + 1);
  await large.close();
  const refused = await call("transfer", { path: "large.bin", mode: "copy", targetArea: "project-drop-zone", targetPath: "" });
  assert.equal(refused.statusCode, 413);
  assert.equal(refused.code, "vibe64_files_transfer_too_large");
  const projectZone = path.join(p.stateRoot, "drop-zone");
  assert.deepEqual(await visible(projectZone), []);
  assert.deepEqual(await leftovers(projectZone), []);
  assert.equal((await call("transfer", { path: "large.bin", mode: "move", targetArea: "project-drop-zone", targetPath: "" })).ok, true);
  assert.equal((await lstat(path.join(projectZone, "large.bin"))).size, 2 * 1024 ** 3 + 1);
});

test("a move across filesystems copies, then removes exactly what it copied", async (t) => {
  const other = await lstat("/dev/shm").catch(() => null);
  if (!other?.isDirectory() || other.dev === (await lstat(tmpdir())).dev) {
    t.skip("No second filesystem at /dev/shm.");
    return;
  }
  const { call, paths } = await fixture(t, { sourcesBase: "/dev/shm" });
  const p = paths();
  await mkdir(path.join(p.dropZoneRoot, "kit", "deep"), { recursive: true });
  await writeFile(path.join(p.dropZoneRoot, "kit", "deep", "a.txt"), "a");
  await writeFile(path.join(p.dropZoneRoot, "kit", "b.txt"), "b");
  const moved = await call("transfer", { path: "kit", mode: "move", targetArea: "repo", targetPath: "src" });
  assert.equal(moved.ok, true, JSON.stringify(moved));
  assert.equal(await readFile(path.join(p.repo, "src", "kit", "deep", "a.txt"), "utf8"), "a");
  assert.equal(await readFile(path.join(p.repo, "src", "kit", "b.txt"), "utf8"), "b");
  await assert.rejects(lstat(path.join(p.dropZoneRoot, "kit")), { code: "ENOENT" });
  assert.deepEqual(await leftovers(p.dropZoneRoot), []);
  assert.deepEqual(await leftovers(p.repoStaging), []);
});

test("a cross-filesystem move never removes a file that changed while it was copied", async (t) => {
  const other = await lstat("/dev/shm").catch(() => null);
  if (!other?.isDirectory() || other.dev === (await lstat(tmpdir())).dev) {
    t.skip("No second filesystem at /dev/shm.");
    return;
  }
  const { call, paths } = await fixture(t, { sourcesBase: "/dev/shm" });
  const p = paths();
  const size = 128 * 1024 ** 2;
  const source = path.join(p.dropZoneRoot, "big.bin");
  const created = await open(source, "w");
  await created.truncate(size);
  await created.close();
  const moving = call("transfer", { path: "big.bin", mode: "move", targetArea: "repo", targetPath: "src" });
  await waitFor(async () => (await readdir(p.repoStaging).catch(() => [])).length > 0);
  await appendFile(source, "appended");
  const result = await moving;
  // Whether the change landed during or just after the copy, the original stays.
  assert.equal((await lstat(source)).size, size + 8, JSON.stringify(result));
  if (!result.ok) {
    assert.equal(result.code, "vibe64_source_editor_file_changed");
    await assert.rejects(lstat(path.join(p.repo, "src", "big.bin")), { code: "ENOENT" });
  }
  assert.deepEqual(await readdir(p.repoStaging), []);
});
