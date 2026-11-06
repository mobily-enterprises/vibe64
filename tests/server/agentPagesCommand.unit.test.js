import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { runWithProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { createAgentPagesCommandService, prepareAgentPagesCommand } from "../../packages/vibe64-terminals/src/server/agentPagesCommand.js";
import { prepareAgentHelperCommand } from "../../packages/vibe64-terminals/src/server/agentHelperCommand.js";
import { createPagesService } from "../../packages/vibe64-pages/src/server/service.js";

const run = promisify(execFile);
const SLUG = "demo";
const quietLogger = { debug() {}, info() {}, warn() {}, error() {} };

async function commandFixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-pages-command-"));
  const projectRuntimeRoot = path.join(root, "state");
  const work = path.join(root, "work");
  const wrapperHostDir = path.join(root, "wrappers");
  await Promise.all([mkdir(projectRuntimeRoot, { recursive: true }), mkdir(work, { recursive: true }), mkdir(wrapperHostDir, { recursive: true })]);
  const pages = createPagesService({ now: () => new Date().toISOString(), clock: Date.now });
  let provider = pages;
  const project = {
    readCurrentProject: async () => ({ slug: SLUG, projectRoot: path.join(root, "project") }),
    runInProjectContext: (slug, operation) => runWithProjectRequestContext({ slug, projectRuntimeRoot }, operation),
    createSessionStore: async () => ({
      readConversationTail: async () => [
        { user: { text: "Make a page for my colleague" }, metadata: { actorId: "alice", actorDisplayName: "Alice Example" } },
        { user: { text: "Review it" }, metadata: { actorId: "app", actorDisplayName: "Automatic review" } }
      ]
    })
  };
  const commandService = createAgentPagesCommandService({ logger: quietLogger, project, readPages: () => provider });
  const prepared = await prepareAgentPagesCommand({ commandService, sessionId: "session-1", wrapperHostDir });
  await prepareAgentHelperCommand({ wrapperHostDir, env: process.env });
  t.after(async () => {
    await commandService.closeAllForSession("session-1");
    await rm(root, { force: true, recursive: true });
  });
  const env = { ...process.env, ...prepared.env };
  async function pagesCommand(...args) {
    try {
      const { stdout, stderr } = await run(path.join(wrapperHostDir, "vibe64-helper"), ["pages", ...args], { cwd: work, env });
      return { code: 0, stdout, stderr };
    } catch (error) {
      return { code: error.code, stdout: error.stdout, stderr: error.stderr };
    }
  }
  const inProject = (operation) => runWithProjectRequestContext({ slug: SLUG, projectRuntimeRoot }, operation);
  return { pages, pagesCommand, prepared, work, inProject, setProvider: (next) => { provider = next; } };
}

test("the pages command publishes a file or a folder, prints its link first, and updates, reverts and lists", async (t) => {
  const { pages, pagesCommand, prepared, work, inProject } = await commandFixture(t);
  assert.ok(prepared.env.VIBE64_AGENT_PAGES_COMMAND_SOCKET);
  const groups = await run(path.join(path.dirname(prepared.hostWrapperPath), "vibe64-helper"), ["--help"]);
  assert.match(groups.stdout, /^ {2}pages {8}Publish, update and list pages/mu, "the helper lists the pages group");
  const help = await pagesCommand("--help");
  assert.equal(help.code, 0, help.stderr);
  assert.match(help.stdout, /vibe64-helper pages publish <file\.html \| folder>/u);
  assert.match(help.stdout, /never put secrets in one/u);

  await writeFile(path.join(work, "summary.html"), "<!doctype html><title>Project summary</title><h1>Summary</h1>");
  const published = await pagesCommand("publish", "summary.html");
  assert.equal(published.code, 0, published.stderr);
  const [link, done, markdown] = published.stdout.trim().split("\n");
  const pageId = link.split("/").at(-1);
  assert.match(link, /^\/app\/project\/demo\/dashboard\/pages\/project-summary-[0-9a-f]{6}$/u);
  assert.equal(done, `Published "Project summary". Page ${pageId} is now at version 1.`);
  assert.equal(markdown, `Give it in the chat as: [Project summary](${link})`);
  const page = (await inProject(() => pages.readPage({ pageId }))).page;
  assert.deepEqual(page.createdBy, { id: "alice", name: "Alice Example" }, "the person behind the latest message made it");
  assert.equal(page.sessionId, "session-1");

  const folder = path.join(work, "board");
  await mkdir(path.join(folder, "data"), { recursive: true });
  await writeFile(path.join(folder, "index.html"), "<p>Board</p>");
  await writeFile(path.join(folder, "data", "numbers.json"), "[1,2]");
  await writeFile(path.join(folder, ".notes"), "hidden files stay behind");
  const board = await pagesCommand("publish", "board", "--title", "Team board", "--json");
  assert.equal(board.code, 0, board.stderr);
  const boardPage = JSON.parse(board.stdout).page;
  assert.equal(boardPage.title, "Team board");
  const viewed = await inProject(() => pages.openPageView({ pageId: boardPage.id }));
  const current = await pages.viewedPage(viewed.viewPath.split("/").at(-1));
  assert.ok(current.versionFolder.endsWith(path.join(boardPage.id, "versions", "1")));

  await writeFile(path.join(folder, "index.html"), "<p>Board v2</p>");
  const updated = await pagesCommand("update", boardPage.id, "board");
  assert.equal(updated.code, 0, updated.stderr);
  assert.match(updated.stdout, /Updated "Team board"\. Page .* is now at version 2\./u);
  const reverted = await pagesCommand("revert", boardPage.id, "1");
  assert.equal(reverted.code, 0, reverted.stderr);
  assert.match(reverted.stdout, /Brought back version 1 of "Team board"\. Page .* is now at version 3\./u);

  const listed = await pagesCommand("list");
  assert.equal(listed.code, 0, listed.stderr);
  assert.match(listed.stdout, new RegExp(`^${boardPage.id}  Team board  version 3  updated `, "mu"));
  assert.match(listed.stdout, new RegExp(`^${pageId}  Project summary  version 1 `, "mu"));
  assert.equal(JSON.parse((await pagesCommand("list", "--json")).stdout).pages.length, 2);
});

test("the pages command refuses what a page cannot be, with a usable message", async (t) => {
  const { pagesCommand, work, setProvider } = await commandFixture(t);
  await mkdir(path.join(work, "no-index"), { recursive: true });
  await writeFile(path.join(work, "no-index", "about.html"), "<p>About</p>");
  await mkdir(path.join(work, "linked"), { recursive: true });
  await writeFile(path.join(work, "linked", "index.html"), "<p>Linked</p>");
  // A link to a file elsewhere on the computer, outside the page's folder.
  await writeFile(path.join(work, "secret.txt"), "not for the page");
  await symlink(path.join(work, "secret.txt"), path.join(work, "linked", "secret.txt"));
  await writeFile(path.join(work, "notes.md"), "# Notes");
  const cases = [
    [["publish", "no-index"], 1, /index\.html/u],
    [["publish", "linked"], 2, /secret\.txt is a link/u],
    [["publish", "notes.md"], 2, /Publish an HTML file, or a folder with an index\.html/u],
    [["publish", "missing.html"], 2, /There is no file or folder at missing\.html/u],
    [["publish"], 2, /accepts publish, update, revert or list/u],
    [["publish", "notes.md", "--force"], 2, /Unsupported option: --force/u],
    [["list", "--title", "x"], 2, /--title takes a title/u],
    [["revert", "page-1", "latest"], 2, /revert takes the page id and the version number/u],
    [["update", "no-such-page-000000", "linked/index.html"], 1, /No page no-such-page-000000 exists/u]
  ];
  for (const [args, code, message] of cases) {
    const result = await pagesCommand(...args);
    assert.equal(result.code, code, `${args.join(" ")}: ${result.stderr}`);
    assert.match(result.stderr, message, args.join(" "));
  }
  setProvider(null);
  const unavailable = await pagesCommand("list");
  assert.equal(unavailable.code, 1);
  assert.match(unavailable.stderr, /Vibe64 pages are unavailable here/u);
});
