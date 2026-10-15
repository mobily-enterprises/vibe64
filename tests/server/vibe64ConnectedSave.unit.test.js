import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { registerVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { sessionConnectedSubmissions, sessionRepositoryDestination } from "@local/vibe64-core/server/projectRepository";
import { createSessionActions } from "../../packages/vibe64-sessions/src/server/actions.js";
import { createService } from "../../packages/vibe64-sessions/src/server/service.js";
import { withRouteProject } from "./vibe64RouteTestHelpers.js";

test("connected Save commits and records each receiver, resumes after failure, and never publishes the main project", async () => {
  await withRouteProject(async ({ projectContext, slug }) => {
    const base = "a".repeat(40);
    const bindings = ["first", "second"].map((projectSlug, index) => ({
      projectSlug, contribution: {
        schemaVersion: 1, id: `00000000-0000-4000-8000-00000000000${index}`,
        repository: `example/${projectSlug}`, integrationBranch: "main", baseCommit: base
      }
    }));
    for (const binding of bindings) await mkdir(path.join(projectContext.projectsRoot, binding.projectSlug));
    const parent = { sessionId: "parent", status: "active", metadata: {
      base_commit: base, canonical_commit: base,
      connected_sources: JSON.stringify({ schemaVersion: 1, sources: bindings })
    } };
    const sessions = new Map([[slug, parent], ...bindings.map(binding => [binding.projectSlug, {
      sessionId: binding.contribution.id, status: "active", metadata: {
        base_commit: base, canonical_commit: base,
        connected_contribution: JSON.stringify(binding.contribution)
      }
    }])]);
    const tasks = new Map();
    const dirty = new Set(["first", "second"]);
    const pushes = [];
    const published = new Map();
    const writes = [];
    let failSecond = true;
    let failRecord = false;
    let changeBeforePush = false;
    let changeSecondDuringFirst = false;
    let mainPushes = 0;
    let mainLocked = false;
    let allowReceiver = true;
    let capturedSnapshots = [];
    const projectFor = target => ({ repositoryMode: "github",
      repository: { defaultBranch: "main", github: { fullName: `example/${target}` } } });
    const runtimeFor = target => ({
      async getSession(id) { const value = sessions.get(target); assert.equal(value.sessionId, id); return value; },
      store: {
        async readBackgroundTask(id, key) { return tasks.get(`${id}:${key}`) || null; },
        async writeBackgroundTaskEvent(id, key, { patch }) {
          const task = { ...tasks.get(`${id}:${key}`), ...patch };
          tasks.set(`${id}:${key}`, task);
          return task;
        },
        async writeMetadataValue(id, key, value) {
          assert.equal(sessions.get(target).sessionId, id);
          if (key === "connected_submissions") {
            assert.equal(mainLocked, true);
            if (failRecord) { failRecord = false; throw new Error("record write interrupted"); }
            writes.push(JSON.parse(value).submissions.map(entry => entry.submittedCommit));
          }
          sessions.get(target).metadata[key] = value;
        }
      }
    });
    const actions = createActionCatalogue();
    const service = createService({ actions,
      project: {
        createRuntime: async () => runtimeFor(currentProjectRequestContext().slug),
        readCurrentProject: async () => projectFor(currentProjectRequestContext().slug),
        connectedContributionSource: async () => {
          assert.equal(allowReceiver, true, "receiving repository write permission is rechecked");
          const binding = bindings.find(item => item.projectSlug === currentProjectRequestContext().slug);
          return { repository: binding.contribution.repository, integrationBranch: "main", baseCommit: base };
        }
      },
      terminals: {
        openBrowserConversation() {},
        async runConnectedSessionSave(id, _input, operation) {
          assert.equal(currentProjectRequestContext().slug, slug);
          assert.equal(mainLocked, false);
          mainLocked = true;
          try { return await operation({ runtime: runtimeFor(slug), session: parent }); }
          finally { mainLocked = false; }
        },
        async inspectSessionWork(_id, { session, inspectContributionPublication, knownSubmittedCommit }) {
          const target = currentProjectRequestContext().slug;
          return { ok: true, unsaved: dirty.has(target), ahead: dirty.has(target) ? 1 : 0,
            ...(inspectContributionPublication ? { publishedCommit: published.get(target) || knownSubmittedCommit || "" } : {}),
            worktreePath: path.join(projectContext.projectsRoot, target, "source"),
            baseCommit: base, sessionHead: session.metadata.canonical_commit, worktreeTree: "d".repeat(40),
            canonicalCommit: session.metadata.canonical_commit,
            destination: sessionRepositoryDestination(projectFor(target), session) };
        },
        async saveSessionWork(id, input) {
          const target = currentProjectRequestContext().slug;
          await input.onRepositoryWriteAcquired();
          await input.assertConnectedWorkSaved();
          if (target === slug) {
            if (changeBeforePush) dirty.add("first");
            capturedSnapshots = await input.assertConnectedWorkSaved();
            mainPushes++;
          } else {
            assert.equal(mainLocked, true, "parent admission remains held while its receiver saves");
            if (target === "second" && failSecond) throw new Error("second push refused");
            assert.equal(dirty.has(target), true, "a completed receiver must not be saved again");
            pushes.push(target);
            published.set(target, (target === "first" ? "b" : "c").repeat(40));
            dirty.delete(target);
            if (target === "first" && changeSecondDuringFirst) dirty.add("second");
          }
          return { ok: true, saveCommit: (target === "first" ? "b" : "c").repeat(40),
            verifiedCommit: (target === "first" ? "b" : "c").repeat(40), reconciled: true, status: "saved" };
        }
      }
    });
    actions.register({ contributorId: "connected-save", domain: "sessions",
      actions: createSessionActions({ sessions: service }).map(action => ({ channels: ["api", "internal"], surfaces: ["app"], ...action }))
    });
    registerVibe64ActionContext(actions, { projectContext,
      resolveUser: async ({ request }) => {
        assert.equal(request.headers.cookie, "original-connection");
        return { username: "developer", role: "owner" };
      },
      authorizeProject: async ({ slug: target }) => {
        if (target !== slug && !allowReceiver) throw Object.assign(new Error("receiving access revoked"), { code: "receiver_forbidden" });
      }
    });
    const context = { surface: "app", channel: "api",
      requestMeta: { request: { headers: { cookie: "original-connection" }, params: { slug } } } };
    const inspect = () => actions.execute({ actionId: "vibe64.sessions.work.inspect", input: { sessionId: "parent" }, context });
    const save = input => actions.execute({ actionId: "vibe64.sessions.work.save", input: { sessionId: "parent", ...input }, context });
    const work = await inspect();
    assert.equal(work.ok, true, JSON.stringify(work));
    assert.equal(work.unsaved, false, "connected Save is available even with no main changes");
    assert.equal(work.connectedSaveRequired, true);
    const review = { destinationReview: work.destination, connectedReview: work.connectedReview };
    assert.equal((await save({ ...review, connectedReview: [] })).code, "vibe64_connected_save_review_changed");
    assert.deepEqual(pushes, []);

    const partial = await save(review);
    assert.equal(partial.ok, false);
    assert.match(partial.error, /second push refused/u);
    assert.equal(partial.details.failedRepository, "example/second");
    assert.equal(partial.details.connected[0].recorded, true);
    assert.deepEqual(pushes, ["first"]);
    assert.deepEqual(sessionConnectedSubmissions(parent).map(item => item.submittedCommit), ["b".repeat(40)]);
    assert.equal(mainPushes, 0);

    failSecond = false;
    failRecord = true;
    const lostRecord = await save(review);
    assert.equal(lostRecord.ok, false);
    assert.equal(lostRecord.details.connected[0].saveCommit, "c".repeat(40));
    assert.equal(lostRecord.details.connected[0].recorded, false);
    assert.deepEqual(pushes, ["first", "second"]);
    published.delete("second");
    assert.equal((await inspect()).connectedSaveRequired, true,
      "lost originating records retain exact confirmed Save evidence even when the remote queue ref was removed");
    published.set("second", "c".repeat(40));
    assert.equal((await inspect()).connectedSaveRequired, true);
    // Update consumes the accepted target; a later failed Save may replace its
    // operation record. Neither may replace the actual published incoming SHA.
    sessions.get("second").metadata.canonical_commit = "e".repeat(40);
    sessions.get("second").metadata.base_commit = "e".repeat(40);
    tasks.set(`${bindings[1].contribution.id}:save-work`, { status: "failed", code: "vibe64_session_save_no_changes" });
    const resumed = await save(review);
    assert.equal(resumed.ok, true, JSON.stringify(resumed));
    assert.equal(resumed.connected[0].status, "already_published");
    assert.deepEqual(pushes, ["first", "second"], "record recovery must not push the completed repository again");
    assert.deepEqual(writes, [["b".repeat(40)], ["b".repeat(40), "c".repeat(40)]]);
    assert.equal(mainPushes, 0, "connected Save never falls through to main Save");
    assert.equal((await inspect()).connectedSaveRequired, false);
    published.delete("first");
    tasks.delete(`${bindings[0].contribution.id}:save-work`);
    assert.equal((await inspect()).connectedSaveRequired, false,
      "the exact originating submission remains available when its old Save operation was replaced");
    published.set("first", "b".repeat(40));

    dirty.add("first");
    assert.equal((await save({ destinationReview: work.destination })).code, "vibe64_connected_save_required");
    assert.equal(mainPushes, 0);
    dirty.delete("first");
    changeBeforePush = true;
    assert.equal((await save({ destinationReview: work.destination })).code, "vibe64_connected_save_required");
    assert.equal(mainPushes, 0, "new connected work is checked again at main publication");
    dirty.delete("first");
    changeBeforePush = false;
    allowReceiver = false;
    const unknown = await inspect();
    assert.equal(unknown.ok, true, "Unavailable receiving status must preserve the main repository inspection.");
    assert.equal(unknown.connectedSaveRequired, false);
    assert.equal(unknown.connectedInspectionError, "receiving access revoked");
    assert.deepEqual(unknown.destination, work.destination);
    assert.equal((await save({ destinationReview: work.destination })).code, "receiver_forbidden");
    assert.equal((await save(review)).code, "receiver_forbidden");
    assert.deepEqual(pushes, ["first", "second"]);
    assert.equal(mainPushes, 0);

    allowReceiver = true;
    dirty.add("first");
    changeSecondDuringFirst = true;
    const laterChanges = await save(review);
    assert.equal(laterChanges.ok, true, JSON.stringify(laterChanges));
    assert.deepEqual(pushes, ["first", "second", "first", "second"],
      "a receiver changed while the previous repository saved must be freshly inspected at its turn");
    assert.equal((await inspect()).connectedSaveRequired, false);
    const unchanged = await save(review);
    assert.equal(unchanged.ok, true);
    assert.deepEqual(unchanged.connected, []);
    assert.equal(pushes.length, 4, "an unchanged retry uses Git state, not a completion ledger");
    assert.equal(mainPushes, 0);

    tasks.set(`${bindings[0].contribution.id}:save-work`, { status: "running", operationId: "receiving-save" });
    const publishing = await save({ destinationReview: work.destination });
    assert.equal(publishing.code, "vibe64_connected_save_required");
    assert.equal(mainPushes, 0, "a clean receiving worktree cannot bypass an unfinished receiving Save");
    tasks.delete(`${bindings[0].contribution.id}:save-work`);

    await assert.rejects(() => save({ destinationReview: work.destination,
      connectedWorkSnapshots: [{ worktreePath: "/untrusted/browser/path" }] }), error => {
      assert.equal(error.code, "ACTION_VALIDATION_FAILED");
      assert.equal(error.details.fieldErrors.connectedWorkSnapshots, "Field not allowed");
      return true;
    });
    assert.equal(mainPushes, 0, "browser-supplied snapshots are rejected before main publication");
    const savedMain = await save({ destinationReview: work.destination });
    assert.equal(savedMain.ok, true, JSON.stringify(savedMain));
    assert.deepEqual(capturedSnapshots.map(snapshot => snapshot.worktreePath), bindings.map(binding =>
      path.join(projectContext.projectsRoot, binding.projectSlug, "source")));
    assert.deepEqual(capturedSnapshots.map(snapshot => snapshot.contribution), bindings.map(binding => binding.contribution));
    assert.equal(mainPushes, 1, "main uses only snapshots obtained through freshly authorized receiving actions");

    sessions.get("first").metadata.connected_sources = JSON.stringify({ schemaVersion: 1, sources: [bindings[1]] });
    dirty.add("first");
    const nested = await save(review);
    assert.equal(nested.code, "vibe64_connected_save_required", JSON.stringify(nested));
    assert.equal(nested.details.failedRepository, "example/first");
    assert.equal(pushes.length, 4, "nested dependencies retain their own Save gate, without recursive publication");
    assert.equal(mainPushes, 1);
  });
});

test("PR creation reuses connected Save admission with fresh receiving authorization", async () => {
  await withRouteProject(async ({ projectContext, slug }) => {
    const contribution = { schemaVersion: 1, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      repository: "example/library", integrationBranch: "main", baseCommit: "a".repeat(40) };
    await mkdir(path.join(projectContext.projectsRoot, "library"));
    const binding = { projectSlug: "library", contribution };
    const parent = { sessionId: "parent", status: "active", metadata: {
      connected_sources: JSON.stringify({ schemaVersion: 1, sources: [binding] }),
      connected_submissions: JSON.stringify({ schemaVersion: 1,
        submissions: [{ contribution, submittedCommit: "b".repeat(40) }] })
    } };
    const receiver = { sessionId: contribution.id, status: "active", metadata: {
      connected_contribution: JSON.stringify(contribution)
    } };
    let dirty = false;
    let allowed = true;
    let publications = 0;
    let authorizations = 0;
    const actions = createActionCatalogue();
    const service = createService({ actions,
      project: {
        createRuntime: async () => ({
          getSession: async () => currentProjectRequestContext().slug === slug ? parent : receiver,
          store: { readBackgroundTask: async () => null }
        }),
        connectedContributionSource: async () => ({ repository: contribution.repository, integrationBranch: "main" })
      },
      terminals: {
        openBrowserConversation() {},
        async inspectSessionWork(_id, input) {
          assert.equal(currentProjectRequestContext().slug, "library");
          assert.equal(input.inspectContributionPublication, true);
          return { ok: true, unsaved: dirty, ahead: 0, publishedCommit: "b".repeat(40),
            worktreePath: path.join(projectContext.projectsRoot, "library", "source"),
            baseCommit: "c".repeat(40), canonicalCommit: "c".repeat(40), sessionHead: "c".repeat(40),
            worktreeTree: "d".repeat(40) };
        },
        async createSessionPullRequest(_id, input) {
          const snapshots = await input.assertConnectedWorkSaved();
          assert.equal(snapshots[0].contribution.id, contribution.id);
          assert.equal(snapshots[0].sessionHead, "c".repeat(40));
          publications++;
          return { ok: true, pullRequest: { number: 1 } };
        }
      }
    });
    actions.register({ contributorId: "connected-pr", domain: "sessions",
      actions: createSessionActions({ sessions: service }).map(action => ({ channels: ["api", "internal"], surfaces: ["app"], ...action })) });
    registerVibe64ActionContext(actions, { projectContext,
      resolveUser: async ({ request }) => {
        assert.equal(request.headers.cookie, "original-connection");
        return { username: "developer", role: "owner" };
      },
      authorizeProject: async ({ slug: target }) => {
        if (target === "library") {
          authorizations++;
          if (!allowed) throw Object.assign(new Error("receiving access revoked"), { code: "receiver_forbidden" });
        }
      }
    });
    const create = () => actions.execute({ actionId: "vibe64.sessions.pull-request.create",
      input: { sessionId: "parent", title: "Consumer change", destinationReview: {
        sessionId: "parent", mode: "github", repository: "example/consumer", branch: "main"
      } }, context: { surface: "app", channel: "api",
        requestMeta: { request: { headers: { cookie: "original-connection" }, params: { slug } } } } });
    assert.equal((await create()).ok, true);
    dirty = true;
    assert.equal((await create()).code, "vibe64_connected_save_required");
    dirty = false;
    allowed = false;
    assert.equal((await create()).code, "receiver_forbidden");
    assert.equal(publications, 1, "dirty or unauthorized connected work cannot create a PR branch");
    assert.equal(authorizations, 3, "every PR attempt reauthorizes its receiving project");
  });
});
