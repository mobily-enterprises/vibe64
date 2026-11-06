import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
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
  const pages = createPagesService({ now: () => new Date().toISOString(), clock: Date.now, project, logger: quietLogger });
  let provider = pages;
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
  assert.match(help.stdout, /vibe64-helper pages guide\n/u);
  const guide = await pagesCommand("guide");
  assert.equal(guide.code, 0, guide.stderr);
  assert.match(guide.stdout, /^# How to design a Vibe64 page\n/u, "the guide prints the page design guide");
  assert.match(guide.stdout, /<link rel="stylesheet" href="_vibe64\/page\.css">/u);

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
    [["publish"], 2, /accepts publish, update, revert, data, refresh, list or guide/u],
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

test("the pages command replaces only a page's data, and sets, shows and stops its refresh", async (t) => {
  const { pages, pagesCommand, work, inProject } = await commandFixture(t);
  t.after(() => pages.closeRefreshes());
  await mkdir(path.join(work, "board"), { recursive: true });
  await writeFile(path.join(work, "board", "index.html"), "<p>Board</p>");
  await writeFile(path.join(work, "board", "data.json"), "{\"open\":1}");
  const { page } = JSON.parse((await pagesCommand("publish", "board", "--json")).stdout);
  await writeFile(path.join(work, "new-data.json"), "{\"open\":2}");
  const data = await pagesCommand("data", page.id, "new-data.json");
  assert.equal(data.code, 0, data.stderr);
  assert.match(data.stdout, new RegExp(`Updated the data of "board"\\. Page ${page.id} is now at version 2\\.`, "u"));
  const viewed = await inProject(() => pages.openPageView({ pageId: page.id }));
  const { versionFolder } = await pages.viewedPage(viewed.viewPath.split("/").at(-1));
  assert.equal(await readFile(path.join(versionFolder, "data.json"), "utf8"), "{\"open\":2}");
  assert.equal(await readFile(path.join(versionFolder, "index.html"), "utf8"), "<p>Board</p>", "the layout stays as it was");

  await writeFile(path.join(work, "refresh.mjs"), "console.log('counting');\n");
  const set = await pagesCommand("refresh", page.id, "--every", "30m", "--command", "refresh.mjs");
  assert.equal(set.code, 0, set.stderr);
  assert.match(set.stdout, new RegExp(`^Page ${page.id} now refreshes every 30 minutes by running refresh\\.mjs on Vibe64's server, as Alice Example\\.\\nThe next refresh is at \\S+\\. The Pages list shows each refresh`, "u"));
  assert.match((await pagesCommand("list")).stdout, new RegExp(`^${page.id}  board  version 2  .*refreshes every 30 minutes by script, next `, "mu"));
  const prompt = await pagesCommand("refresh", page.id, "--daily", "07:30", "--time-zone", "Europe/Rome", "--prompt", "Count the open issues", "--json");
  assert.equal(prompt.code, 0, prompt.stderr);
  const { refresh } = JSON.parse(prompt.stdout).page;
  assert.deepEqual([refresh.kind, refresh.schedule, refresh.scheduledBy], ["prompt", "Daily at 07:30 (Europe/Rome)", { id: "alice", name: "Alice Example" }]);
  const off = await pagesCommand("refresh", page.id, "--off");
  assert.equal(off.code, 0, off.stderr);
  assert.equal(off.stdout, `Page ${page.id} no longer refreshes; it keeps version 2.\n`);

  await writeFile(path.join(work, "notes.txt"), "plain words");
  const cases = [
    [["refresh", page.id, "--every", "5m", "--command", "refresh.mjs"], 1, /at most every 15 minutes/u],
    [["refresh", page.id, "--every", "30m"], 2, /--command <script> or --prompt/u],
    [["refresh", page.id, "--command", "refresh.mjs"], 2, /--every \(such as 30m or 2h\) or --daily/u],
    [["refresh", page.id, "--off", "--every", "30m"], 2, /--off takes no other option/u],
    [["refresh", page.id, "--every", "30m", "--time-zone", "Europe/Rome", "--prompt", "Count"], 2, /--time-zone goes with --daily/u],
    [["refresh", page.id, "--every", "30m", "--command", "notes.txt"], 1, /\.mjs, \.js, \.cjs, \.py or \.sh file/u],
    [["refresh", page.id, "--every", "30m", "--command", "missing.mjs"], 2, /There is no file at missing\.mjs/u],
    [["publish", "board", "--every", "30m"], 2, /go with refresh/u],
    [["data", page.id, "notes.txt"], 1, /not valid JSON/u],
    [["data", page.id], 2, /accepts publish, update, revert, data, refresh, list or guide/u]
  ];
  for (const [args, code, message] of cases) {
    const result = await pagesCommand(...args);
    assert.equal(result.code, code, `${args.join(" ")}: ${result.stderr}`);
    assert.match(result.stderr, message, args.join(" "));
  }
});
