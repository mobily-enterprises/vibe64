import assert from "node:assert/strict";
import test from "node:test";

import { publicationWatchSource } from "../../packages/vibe64-publishing/src/server/publicationWatch.js";
import { createWatchSources, stateObservation, stateWatchUpdate } from "../../packages/vibe64-colleague/src/server/watchSources.js";

// The project's latest release, watched by Colleague: one reader of the
// publication state action, under the watcher's own access.
function stateActions(states) {
  const calls = [];
  return {
    calls,
    async execute({ actionId, input, context }) {
      calls.push({ actionId, input, projectSlug: context.projectSlug, channel: context.channel });
      return structuredClone(states.shift());
    }
  };
}

const release = (id, status) => ({ id, kind: "release", status, tags: [`v${id}`], versions: { app: id } });
const dryRun = { id: "d1", kind: "dry-run", status: "succeeded", tags: [], versions: {} };
const none = { ok: true, releases: [dryRun] };
const running = { ok: true, releases: [release("1.0.0", "running"), dryRun] };
const live = { ok: true, releases: [release("1.0.0", "succeeded"), dryRun] };
const failed = { ok: true, releases: [release("1.0.1", "failed"), release("1.0.0", "succeeded")] };
const partial = { ok: true, releases: [release("1.0.2", "partial")] };

test("the publication watch source registers with Colleague and reports live once the release is live", async () => {
  const actions = stateActions([none, running, live, live]);
  const registry = createWatchSources();
  registry.register(publicationWatchSource({ actions }));
  const [listed] = registry.list();
  assert.equal(listed.source, "publication");
  assert.equal(listed.scope, "project");
  assert.deepEqual(Object.keys(listed.conditions), ["live", "failed", "changed"]);
  const source = registry.get("publication");
  const context = { channel: "automation", projectSlug: "elsewhere" };
  let cursor;
  const reasons = [];
  for (let reading = 0; reading < 4; reading += 1) {
    const observation = stateObservation(source, await source.read({ projectSlug: "books" }, context));
    const update = stateWatchUpdate({ condition: "live", cursor }, observation);
    cursor = update.cursor;
    reasons.push([observation.summary, update.reason]);
  }
  assert.deepEqual(reasons, [["Nothing has been released from this project yet.", ""], ["v1.0.0 is being released.", ""],
    ["v1.0.0 is live on every target.", "live"], ["v1.0.0 is live on every target.", ""]]);
  assert.ok(actions.calls.every(call => call.actionId === "vibe64.publication.state.read" && call.projectSlug === "books" &&
    call.channel === "automation"), "every reading names the watched project under the watcher's own context");
});

test("failed reports a failed or partial release and changed reports every change", async () => {
  const source = publicationWatchSource({ actions: stateActions([live, failed, partial]) });
  const update = (condition, cursor, value) => stateWatchUpdate({ condition, cursor }, stateObservation(source, value));
  const first = await source.read({ projectSlug: "books" }, {});
  const second = await source.read({ projectSlug: "books" }, {});
  const third = await source.read({ projectSlug: "books" }, {});
  assert.deepEqual(first.conditionsMet, ["live"]);
  assert.deepEqual(second.conditionsMet, ["failed"]);
  assert.equal(second.summary, "v1.0.1 failed.");
  assert.deepEqual(third.conditionsMet, ["failed"]);
  assert.equal(third.summary, "v1.0.2 reached only some of its targets.");
  const changed = update("changed", undefined, first);
  assert.equal(changed.reason, "");
  assert.equal(update("changed", changed.cursor, second).reason, "changed");
  assert.equal(update("failed", changed.cursor, second).reason, "failed");
});

test("a refused reading surfaces its reason instead of a guess", async () => {
  const source = publicationWatchSource({ actions: { async execute() { return { ok: false, error: "Open a project to publish it." }; } } });
  const refused = await source.read({ projectSlug: "books" }, {});
  assert.throws(() => stateObservation(source, refused), { message: "Open a project to publish it.", statusCode: 409 });
});
