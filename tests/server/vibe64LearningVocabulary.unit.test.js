import assert from "node:assert/strict";
import test from "node:test";
import { createLearningVocabulary, declaredLearningVocabulary, lessonAvailable, lessonStepAvailable, lessonStepNeeds,
  trainingGuideCommand, trainingGuideRequest, trainingPlaceShown } from "../../packages/vibe64-training/src/shared/learningVocabulary.js";
import { beatNeedsPracticeProject, splitStepBeats } from "../../packages/vibe64-training/src/shared/beats.js";
import { readLearningFact, registerLearningFact } from "../../packages/vibe64-training/src/server/learningFacts.js";

// A host's own studio and project places, registered by composition.
const host = {
  places: [
    { id: "manage-projects", label: "Projects", scope: "studio", open: { route: "/app/manage/projects" },
      steps: [{ id: "manage-projects", label: "Projects" }] },
    { id: "manage-users", label: "Users", scope: "studio", who: "owner", open: { route: "/app/manage/users" },
      steps: [{ id: "manage-users", label: "Users" }] },
    { id: "deploy", label: "Deploy", scope: "project", open: { pane: "deploy" }, steps: [{ id: "dashboard", label: "Dashboard" }, { id: "deploy", label: "Deploy" }] }
  ],
  activities: [{ id: "app-deployed", event: "app-deployed", place: "deploy" }],
  facts: ["deployment-live"]
};

test("a host extends the built-in vocabulary by registration; a name keeps one meaning", () => {
  const vocabulary = createLearningVocabulary({ facts: [] });
  assert.equal(vocabulary.place("manage-users"), null);
  vocabulary.register(host);
  assert.equal(vocabulary.place("manage-users").who, "owner");
  assert.deepEqual(vocabulary.place("manage-projects").shown, [{ route: "/app/manage/projects" }], "a route place is shown at its route");
  assert.equal(vocabulary.activity("app-deployed").place, "deploy");
  assert.ok(vocabulary.events().has("app-deployed") && vocabulary.events().has("learn-toggled"));
  assert.ok(vocabulary.hasFact("deployment-live"));
  vocabulary.register(host);
  assert.throws(() => vocabulary.register({ places: [{ ...host.places[0], label: "Other" }] }), /already registered with another meaning/u);
  assert.throws(() => vocabulary.register({ activities: [{ id: "preview", event: "x" }] }), /already registered/u);
  for (const place of [
    { ...host.places[0], scope: "project" },
    { ...host.places[0], open: { route: "https://example.com" } },
    { ...host.places[2], scope: "studio" },
    { ...host.places[0], steps: [{ id: "other", label: "Other" }] },
    { ...host.places[0], who: "admin" }
  ]) assert.throws(() => createLearningVocabulary().register({ places: [place] }), /Place manage-projects|Place deploy/u, JSON.stringify(place));
});

test("navigation.guide opens studio places by route, project places in the project, and refuses unknown ones", () => {
  const vocabulary = createLearningVocabulary({ facts: [] });
  vocabulary.register(host);
  const open = trainingGuideRequest({ target: "manage-users", navigate: true }, vocabulary);
  assert.deepEqual(trainingGuideCommand(open, { id: "one" }, vocabulary), { id: "one", route: "/app/manage/users", status: "pending",
    guide: { target: "manage-users", navigate: true, highlight: true, steps: [{ id: "manage-users", label: "Users" }], caption: "Users" } });
  assert.deepEqual(trainingGuideCommand(trainingGuideRequest({ target: "deploy", navigate: true, highlight: false }, vocabulary),
    { id: "two", projectSlug: "alpha", sessionId: "s1" }, vocabulary),
  { id: "two", projectSlug: "alpha", sessionId: "s1", conversationId: "", pane: "deploy", status: "pending" });
  assert.deepEqual(trainingGuideCommand(trainingGuideRequest({ target: "account-settings" }), { id: "three" }).guide.steps.map(step => step.id),
    ["account-menu", "account-settings"]);
  assert.throws(() => trainingGuideRequest({ target: "account-menu", navigate: true }), /has no view to open/u);
  assert.throws(() => trainingGuideRequest({ target: "manage-users" }), /guide places: preview, .*ai-setup\./u, "without the host, its places are unknown");
  assert.throws(() => trainingGuideRequest({ target: "workspace-preview" }), /guide places/u, "retired aliases are gone");
});

test("the place matcher reads page focus: panes, routes by prefix, Courses and the coding chat", () => {
  const vocabulary = createLearningVocabulary({ facts: [] });
  vocabulary.register(host);
  assert.equal(trainingPlaceShown("manage-users", { route: "/app/manage/users" }, vocabulary), true);
  assert.equal(trainingPlaceShown("manage-users", { route: "/app/manage/users/new" }, vocabulary), true);
  assert.equal(trainingPlaceShown("manage-users", { route: "/app/manage/usersx" }, vocabulary), false);
  assert.equal(trainingPlaceShown("database-erd", { pane: "database", databaseView: "erd" }), true);
  assert.equal(trainingPlaceShown("database-erd", { pane: "database", databaseView: "data" }), false);
  assert.equal(trainingPlaceShown("chat", { chatVisible: true }), true);
  assert.equal(trainingPlaceShown("courses", { learningOpen: true }), true);
  assert.equal(trainingPlaceShown("lesson", { pane: "lesson" }), true);
  assert.equal(trainingPlaceShown("account-menu", {}), null, "a point-only place has no view to be at");
});

test("a step is available when every name it uses is registered here and open to this person", () => {
  const vocabulary = createLearningVocabulary({ facts: ["ai-ready"] });
  const declared = declaredLearningVocabulary({ places: ["manage-users"], activities: ["app-deployed"], facts: ["deployment-live"] });
  const beats = lines => splitStepBeats(`Text.\n\n\`\`\`beats\n${lines.join("\n")}\n\`\`\`\n`, declared).beats;
  const people = { id: "people", required: false, beats: beats(["show manage-users: Add people here.", "check done: Done."]), check: { kind: "self" } };
  const deploy = { id: "deploy", required: true, beats: beats(["do app-deployed: Deploy it."]), check: { kind: "fact", fact: "deployment-live" } };
  const ai = { id: "ai", required: true, beats: beats(["show account-menu: Your AI.", "check fact: Check."]), check: { kind: "fact", fact: "ai-ready" } };
  assert.deepEqual(lessonStepNeeds(people, declared), { places: ["manage-users"], activities: [], facts: [] });
  assert.deepEqual(lessonStepNeeds(deploy, declared), { places: [], activities: ["app-deployed"], facts: ["deployment-live"] });
  // Public alone: the host's names are not registered.
  assert.equal(lessonStepAvailable(ai, { vocabulary }), true);
  assert.equal(lessonStepAvailable(people, { vocabulary, viewer: { owner: true } }), false);
  assert.equal(lessonAvailable([ai, people], { vocabulary }), true, "an optional host step leaves the lesson available");
  assert.equal(lessonAvailable([ai, deploy], { vocabulary }), false, "a required host step makes it unavailable");
  // The host registers them: owner places only for the owner.
  vocabulary.register(host);
  assert.equal(lessonStepAvailable(people, { vocabulary, viewer: { owner: true } }), true);
  assert.equal(lessonStepAvailable(people, { vocabulary, viewer: { owner: false } }), false);
  assert.equal(lessonStepAvailable(deploy, { vocabulary }), true);
  // Declared names have no known scope at bundle time; built-in project places do.
  assert.equal(beatNeedsPracticeProject(people.beats[0], declared), false);
  assert.equal(beatNeedsPracticeProject({ kind: "show", target: "preview" }, declared), true);
  assert.equal(beatNeedsPracticeProject({ kind: "check", target: "fact" }, declared), false);
  assert.equal(beatNeedsPracticeProject({ kind: "check", target: "review" }, declared), true);
});

test("a fact reader answers for the learner; failures and missing readers answer not yet", async () => {
  registerLearningFact({ id: "vocabulary-test-fact", read: async ({ actor, projectSlug }) => ({ holds: actor.username === "ada", reason: `slug ${projectSlug}` }) });
  assert.deepEqual(await readLearningFact("vocabulary-test-fact", { actor: { username: "ada" }, projectSlug: "p" }), { holds: true, reason: "slug p" });
  assert.equal((await readLearningFact("vocabulary-test-fact", { actor: { username: "bo" } })).holds, false);
  registerLearningFact({ id: "vocabulary-test-fact", read: async () => { throw new Error("Deployment state is unavailable."); } });
  assert.deepEqual(await readLearningFact("vocabulary-test-fact", { actor: {} }), { holds: false, reason: "Deployment state is unavailable." });
  assert.equal((await readLearningFact("never-registered", { actor: {} })).holds, false);
});
