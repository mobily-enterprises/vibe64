import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "@vue/server-renderer";
import { createRenderer, createSSRApp, h, ssrContextKey } from "vue";
import { createVuetify } from "vuetify";
import TrainingLessonPicker from "../../packages/vibe64-training/src/client/TrainingLessonPicker.vue";
import TrainingCourseCatalogue from "../../packages/vibe64-training/src/client/TrainingCourseCatalogue.vue";
import TrainingCoursePage from "../../packages/vibe64-training/src/client/TrainingCoursePage.vue";
import { courseProgress } from "../../packages/vibe64-training/src/client/courseProgress.js";

const learning = (extra = {}) => ({ ok: true, available: true, revision: 1, activeSummaryCurrent: true, active: null, completion: null, history: [], ...extra });
const empty = { ok: true, available: true, revision: 0, courses: [] };
function available(courses = [course()]) {
  return { ok: true, available: true, repository: "mobily-enterprises/vibe64-learning-catalog", catalogueCommit: "a".repeat(40),
    domains: [{ domainId: "vibe64", title: "Vibe64" }, { domainId: "web", title: "The web" }], courses };
}
function course(extra = {}) {
  return { courseId: "getting-started", release: "0.2.0", title: "Getting started", status: "released", domainId: "vibe64",
    topics: [{ topicId: "intro", release: "0.2.0" }], lessonCount: 2, installed: "not-installed", otherReleases: [], updateFrom: null, installing: null, ...extra };
}
function installedCourse(release, enabled, hashes = ["c".repeat(64), "d".repeat(64)]) {
  return { courseId: "getting-started", release, title: "Getting started", status: "released", enabled,
    topics: [{ topicId: "intro", release, title: "Introduction" }], lessons: [
      { code: "V64-START-00", title: "Connect your first AI", hash: hashes[0], topicId: "intro", topicRelease: release, status: "published", required: true },
      { code: "V64-START-01", title: "Explore Vibe64", hash: hashes[1], topicId: "intro", topicRelease: release, status: "published", required: true }] };
}
async function render(props, component = TrainingLessonPicker) {
  const app = createSSRApp({ render: () => h(component, props) });
  app.use(createVuetify());
  return renderToString(app);
}
let mounted;
afterEach(() => { mounted?.unmount(); mounted = null; });
function mount(props, component = TrainingCourseCatalogue) {
  mounted = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
    .createApp({ ...component, render: () => null }, props);
  mounted.provide(ssrContextKey, { modules: new Set() });
  mounted.mount({});
  return mounted._instance.setupState;
}

describe("Training course catalogue", () => {
  it("replaces the empty dead end with topics and their installable courses", async () => {
    const html = await render({ catalogueResult: empty, learningResult: learning(), canStart: true, canResume: true,
      availableResult: available([course(), course({ courseId: "orphan", title: "Orphan course", domainId: null })]) });
    expect(html).not.toContain("this page cannot install one");
    expect(html).toContain("Choose a course in the catalogue below and select Install.");
    expect(html).toContain("Install a course");
    expect(html).toContain("Vibe64");
    expect(html).toContain("No courses in this topic yet.");
    expect(html).toContain("Other courses");
    expect(html).toContain("Getting started");
    expect(html).toContain("2 lessons");
    expect(html).toContain("Not installed");
    expect(html).toContain(">Install<");
  });

  it("keeps the original installed-only behaviour where installation is not composed", async () => {
    const html = await render({ catalogueResult: empty, learningResult: learning(), canStart: true, canResume: true });
    expect(html).toContain("No courses are installed. Ask the owner to install and enable a course; this page cannot install one.");
    expect(html).not.toContain("Install a course");
  });

  it("shows installed, disabled, preview, progress and failure states", async () => {
    const html = await render({ availableResult: available([
      course({ courseId: "done", installed: "enabled", title: "Enabled course" }),
      course({ courseId: "off", installed: "disabled", title: "Disabled course" }),
      course({ courseId: "preview", status: "preview", title: "Preview course" }),
      course({ courseId: "busy", title: "Busy course", installing: { phase: "topic", topicsDone: 0, topicsTotal: 2 } }),
      course({ courseId: "failed", title: "Failed course" })
    ]), installState: { courseId: "busy", release: "0.2.0", phase: "installing" } }, TrainingCourseCatalogue);
    expect(html).toContain("View course");
    expect(html).toContain("Disabled by the owner");
    expect(html).toContain("Ask the owner to enable this release again.");
    expect(html).toContain("Preview course: it can be installed; until it is released, only the workspace owner can try its lessons");
    expect(html).toContain("Downloading and verifying topic 1 of 2");
    const failed = await render({ availableResult: available([course({ courseId: "failed" })]),
      installState: { courseId: "failed", release: "0.2.0", phase: "failed", message: "Topic intro could not be downloaded." } }, TrainingCourseCatalogue);
    expect(failed).toContain("Topic intro could not be downloaded.");
    expect(failed).toContain("Retry install");
    const unreachable = await render({ availableError: "The official course catalogue could not be downloaded." }, TrainingCourseCatalogue);
    expect(unreachable).toContain("could not be downloaded");
    expect(unreachable).toContain("Retry");
  });

  it("emits one exact install request and never while busy", () => {
    const install = vi.fn();
    const state = mount({ availableResult: available(), onInstall: install });
    state.install(state.courses[0]);
    expect(install).toHaveBeenCalledWith({ courseId: "getting-started", release: "0.2.0" });
    mounted.unmount();
    const blocked = vi.fn();
    const busy = mount({ availableResult: available(), busy: true, onInstall: blocked });
    busy.install(busy.courses[0]);
    expect(blocked).not.toHaveBeenCalled();
  });

  it("offers Update on the installed course card and hides the superseded release after updating", async () => {
    const before = await render({ catalogueResult: { ok: true, available: true, revision: 1, courses: [installedCourse("0.1.0", true)] },
      learningResult: learning(), canStart: true, canResume: true,
      availableResult: available([course({ updateFrom: "0.1.0", otherReleases: ["0.1.0"] })]) });
    expect(before).toContain("Update available: 0.2.0");
    expect(before).toContain(">Update<");
    expect(before).toContain("You have 0.1.0. Updating keeps your saved lessons and progress.");
    const after = await render({ catalogueResult: { ok: true, available: true, revision: 3, courses: [installedCourse("0.1.0", false), installedCourse("0.2.0", true)] },
      learningResult: learning(), canStart: true, canResume: true,
      availableResult: available([course({ installed: "enabled", otherReleases: ["0.1.0"] })]) });
    expect(after).not.toContain("Update available");
    expect(after).not.toContain("Disabled for new lessons");
    expect(after).toContain("getting-started · 0.2.0");
  });

  it("keeps a superseded release visible while its saved lesson can still be resumed", async () => {
    const active = { attemptId: "11111111-1111-4111-8111-111111111111", pin: {
      course: { courseId: "getting-started", release: "0.1.0" },
      topic: { topicId: "intro", release: "0.1.0", commit: "a".repeat(40), topicHash: "b".repeat(64) },
      lesson: { code: "V64-START-00", hash: "c".repeat(64) } }, projectSlug: "", preparation: { phase: "reserved" }, learning: { submissions: [], resume: null } };
    const html = await render({ catalogueResult: { ok: true, available: true, revision: 3, courses: [installedCourse("0.1.0", false), installedCourse("0.2.0", true, ["c".repeat(64), "e".repeat(64)])] },
      learningResult: learning({ active }), canStart: true, canResume: true, availableResult: available([course({ installed: "enabled" })]) });
    expect(html).toContain("getting-started · 0.1.0");
    expect(html).toContain("Disabled for new lessons");
    expect(html).toContain("Continue lesson");
  });

  it("keeps unchanged lessons completed and marks changed ones as completed in an earlier release", async () => {
    const updated = installedCourse("0.2.0", true, ["c".repeat(64), "e".repeat(64)]);
    const progress = [
      { lessonCode: "V64-START-00", lessonHash: "c".repeat(64), required: 1, passed: 1, completed: true, open: false },
      { lessonCode: "V64-START-01", lessonHash: "d".repeat(64), required: 1, passed: 1, completed: true, open: false }
    ];
    const history = [{ attemptId: "22222222-2222-4222-8222-222222222222", ended: { reason: "restart" }, pin: {
      course: { courseId: "getting-started", release: "0.1.0" }, topic: { topicId: "intro", release: "0.1.0", commit: "a".repeat(40), topicHash: "b".repeat(64) },
      lesson: { code: "V64-START-01", hash: "d".repeat(64) } } }];
    const summary = courseProgress(updated, progress, null, history);
    expect(summary.lessons.map(value => [value.status, value.earlier?.release || null])).toEqual([["completed", null], ["not-started", "0.1.0"]]);
    expect(summary.completed).toBe(1);
    const html = await render({ course: updated, progress: summary, startAllowed: true, resumeAllowed: true }, TrainingCoursePage);
    expect(html).toContain("Completed in 0.1.0 · updated since");
    expect(courseProgress(updated, progress).lessons[1].earlier).toEqual({ release: "" });
  });

  it("offers Start lesson again on the row of an archived lesson: an archived lesson starts as a new attempt", async () => {
    const installed = installedCourse("0.2.0", true);
    const archived = { attemptId: "33333333-3333-4333-8333-333333333333", ended: { reason: "archived" }, pin: {
      course: { courseId: "getting-started", release: "0.2.0" }, lesson: { code: "V64-START-01", hash: "d".repeat(64) } } };
    const progress = [{ lessonCode: "V64-START-01", lessonHash: "d".repeat(64), required: 2, passed: 1, completed: false, open: false }];
    const summary = courseProgress(installed, progress, null, [archived]);
    expect(summary.next.code).toBe("V64-START-00");
    expect(Object.hasOwn(summary, "continueFrom")).toBe(false);
    expect(summary.lessons.some(value => Object.hasOwn(value, "continueFrom"))).toBe(false);
    const html = await render({ course: installed, progress: summary, startAllowed: true, resumeAllowed: true }, TrainingCoursePage);
    expect(html.match(/>Start lesson</g)).toHaveLength(2);
    expect(html).not.toContain("Continue lesson<");
    expect(html).toContain("Start next lesson");
  });
});
