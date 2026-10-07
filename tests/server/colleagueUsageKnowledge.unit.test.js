import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { registerVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { createColleagueActions } from "../../packages/vibe64-colleague/src/server/actions.js";
import { createColleagueUsageKnowledge } from "../../packages/vibe64-colleague/src/server/usageKnowledge.js";

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "colleague-guides-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, usage: createColleagueUsageKnowledge({ directory }) };
}

test("usage discovery is bounded, searchable, deterministic and omits guide bodies", async t => {
  const { directory, usage } = await fixture(t);
  for (let i = 0; i < 23; i++) await writeFile(path.join(directory, `topic-${String(i).padStart(2, "0")}.md`),
    `# Task ${i}\n\nShort introduction.\n\n## Recovery\nClick Retry for a preview error.\n`);
  const first = await usage.topics();
  assert.equal(first.topics.length, 20);
  assert.equal(first.total, 23);
  assert.equal(first.nextOffset, 20);
  assert.ok(first.topics.every(topic => !Object.hasOwn(topic, "text")));
  const last = await usage.topics({ offset: first.nextOffset });
  assert.equal(last.topics.length, 3);
  assert.equal(last.hasMore, false);
  assert.deepEqual([...first.topics, ...last.topics].map(topic => topic.topicId),
    Array.from({ length: 23 }, (_, i) => `topic-${String(i).padStart(2, "0")}`));
  assert.equal((await usage.topics({ query: "PREVIEW Retry" })).total, 23);
  assert.equal((await usage.topics({ query: "not-present" })).total, 0);
});

test("guide lookup reads a complete Unicode document and refreshes documentation edits", async t => {
  const { directory, usage } = await fixture(t);
  const filename = path.join(directory, "preview.md");
  const text = "# Preview 🐈\n\nOpen Preview.\n\nChoose **Run**.\n";
  await writeFile(filename, text);
  assert.deepEqual(await usage.guide({ topicId: "preview" }), {
    ok: true, topicId: "preview", title: "Preview 🐈", summary: "Open Preview.", text
  });
  await writeFile(filename, text.replace("Run", "Restart preview"));
  assert.match((await usage.guide({ topicId: "preview" })).text, /Restart preview/u);
});

test("topic IDs cannot read outside released Markdown guides or follow links", async t => {
  const { directory, usage } = await fixture(t);
  const outside = path.join(directory, "private.txt");
  await writeFile(outside, "private sentinel");
  await symlink(outside, path.join(directory, "linked.md"));
  await mkdir(path.join(directory, "nested.md"));
  for (const topicId of ["../private", "/tmp/private", "preview.md", "nested/file", "", "a".repeat(65)]) {
    await assert.rejects(usage.guide({ topicId }), /topic ID/u);
  }
  const linked = await usage.guide({ topicId: "linked" });
  assert.equal(linked.ok, false);
  assert.doesNotMatch(JSON.stringify(linked), /private sentinel/u);
  assert.deepEqual((await usage.topics()).topics, []);
  assert.equal((await usage.guide({ topicId: "missing" })).ok, false);
});

test("missing releases and malformed or oversized guides give actionable failures", async t => {
  const { directory, usage } = await fixture(t);
  assert.equal((await createColleagueUsageKnowledge({ directory: path.join(directory, "missing") }).topics()).ok, false);
  await writeFile(path.join(directory, "large.md"), "# Large\n\n" + "x".repeat(65536));
  await assert.rejects(usage.guide({ topicId: "large" }), /too large/u);
  await writeFile(path.join(directory, "large.md"), "# Large\n\n" + "x".repeat(16000));
  await assert.rejects(usage.guide({ topicId: "large" }), /split into smaller/u);
  await writeFile(path.join(directory, "untitled.md"), "No heading\n");
  await assert.rejects(usage.guide({ topicId: "untitled" }), /no title/u);
});

test("usage actions share native authentication, require no project and validate all inputs", async t => {
  const { directory, usage } = await fixture(t);
  await writeFile(path.join(directory, "preview.md"), "# Preview\n\nChoose Run.\n");
  const actions = createActionCatalogue();
  let user = { uid: "member-1", username: "member", role: "member" };
  registerVibe64ActionContext(actions, { resolveUser: async () => user,
    authorizeProject: () => { assert.fail("Usage lookup must not open or authorize a project."); } });
  const definitions = createColleagueActions({}, usage).filter(definition => definition.id.includes(".usage."));
  assert.equal(definitions.length, 2);
  assert.ok(definitions.every(definition => definition.kind === "query"));
  actions.register({ contributorId: "usage-proof", domain: "vibe64", actions: definitions.map(definition => ({
    channels: ["api", "automation"], surfaces: ["app"], ...definition
  })) });
  const execute = (operation, input = {}, context = {}) => actions.execute({
    actionId: `vibe64.colleague.usage.${operation}.read`, input, context: { surface: "app", channel: "automation", ...context }
  });
  assert.equal((await execute("topics")).topics[0].topicId, "preview");
  assert.equal((await execute("guide", { topicId: "preview" })).text, "# Preview\n\nChoose Run.\n");
  for (const input of [{ limit: 21 }, { offset: -1 }, { query: "x".repeat(201) }]) await assert.rejects(execute("topics", input));
  await assert.rejects(execute("guide"));
  await assert.rejects(execute("topics", {}, { vibe64Action: { user } }), /authority is resolved/u);
  user = null;
  await assert.rejects(execute("topics"), /Log in/u);
  await assert.rejects(execute("guide", { topicId: "preview" }), /Log in/u);
});

test("all shipped public usage topics are discoverable and fit a complete bounded read", async () => {
  const directory = new URL("../../docs/colleague-usage/", import.meta.url);
  const usage = createColleagueUsageKnowledge({ directory: fileURLToPath(directory) });
  const filenames = (await readdir(directory)).filter(name => name.endsWith(".md")).sort();
  const topics = [];
  let offset = 0;
  for (;;) {
    const page = await usage.topics({ offset });
    topics.push(...page.topics);
    if (!page.hasMore) break;
    offset = page.nextOffset;
  }
  assert.deepEqual(topics.map(topic => `${topic.topicId}.md`), filenames);
  for (const topic of topics) {
    const guide = await usage.guide({ topicId: topic.topicId });
    assert.equal(guide.ok, true);
    assert.ok(guide.text.length > 40);
  }
  const authoring = await usage.topics({ query: "author lesson publish" });
  assert.ok(authoring.topics.some(topic => topic.topicId === "lesson-authoring"));
});
