import { describe, expect, it } from "vitest";

import {
  previewRouteHasParams,
  previewRouteInitialFormValues,
  previewRouteParams,
  previewRoutePath,
  previewRoutesForTarget
} from "../../src/lib/vibe64PreviewRoutes.js";

describe("Vibe64 preview routes", () => {
  it("uses only adapter-declared preview routes", () => {
    expect(previewRoutesForTarget({
      previewRoutes: [
        { id: "home", label: "Home", pathTemplate: "/home" },
        { label: "Broken route", pathTemplate: "/broken" },
        { id: "missing-path", label: "Missing path" }
      ]
    })).toEqual([
      { id: "home", label: "Home", pathTemplate: "/home" }
    ]);
  });

  it("resolves parameterized route templates", () => {
    const route = {
      id: "job",
      pathTemplate: "/w/:workspaceSlug/admin/jobs/:jobId",
      params: [
        {
          defaultValue: "mercmobily",
          name: "workspaceSlug"
        },
        {
          label: "Job",
          name: "jobId"
        }
      ]
    };

    expect(previewRouteHasParams(route)).toBe(true);
    expect(previewRouteInitialFormValues(route)).toEqual({
      jobId: "",
      workspaceSlug: "mercmobily"
    });
    expect(previewRoutePath(route, {
      jobId: "11514",
      workspaceSlug: "merc mobily"
    })).toEqual({
      missingParam: "",
      ok: true,
      path: "/w/merc%20mobily/admin/jobs/11514"
    });
    expect(previewRoutePath(route, {
      workspaceSlug: "mercmobily"
    })).toMatchObject({
      missingParam: "jobId",
      ok: false
    });
  });

  it("infers missing parameter metadata from the route template", () => {
    expect(previewRouteParams({
      id: "job",
      pathTemplate: "/w/:workspaceSlug/admin/jobs/:jobId"
    })).toEqual([
      {
        label: "Workspace Slug",
        name: "workspaceSlug",
        placeholder: "workspaceSlug",
        required: true
      },
      {
        label: "Job Id",
        name: "jobId",
        placeholder: "jobId",
        required: true
      }
    ]);
  });
});


// The supplied Training projections use the original server operations. These
// component cases leave the Preview route assertions above unchanged.
import { renderToString } from "@vue/server-renderer";
import { createRenderer, createSSRApp, h, nextTick, ssrContextKey } from "vue";
import { createVuetify } from "vuetify";
import { afterEach, vi } from "vitest";
import TrainingLessonPicker from "../../packages/vibe64-training/src/client/TrainingLessonPicker.vue";

const pickerHash = "c".repeat(64);
const savedId = "11111111-1111-4111-8111-111111111111";
function pickerCatalogue() {
  return { ok: true, available: true, revision: 3, courses: [
    { courseId: "getting-started", release: "0.1.7", title: "Getting started", status: "released", enabled: true, lessons: [
      { code: "V64-START-00", title: "Connect your first AI", hash: pickerHash, topicId: "intro", topicRelease: "0.1.7", status: "published", required: true },
      { code: "V64-START-01", title: "Explore Vibe64", hash: "d".repeat(64), topicId: "intro", topicRelease: "0.1.7", status: "published", required: true }
    ] }
  ] };
}
function pickerLearning(active = null) {
  return { ok: true, available: true, revision: 9, activeSummaryCurrent: true, active, completion: null, history: [] };
}
function pickerAttempt() {
  return { attemptId: savedId, pin: {
    course: { courseId: "getting-started", release: "0.1.6" },
    topic: { topicId: "intro", release: "0.1.6", commit: "a".repeat(40), topicHash: "b".repeat(64) },
    lesson: { code: "V64-START-00", hash: pickerHash }
  }, projectSlug: "", preparation: { phase: "reserved" }, learning: { submissions: [], resume: null } };
}
async function renderPicker(props = {}) {
  const app = createSSRApp({ render: () => h(TrainingLessonPicker, props) });
  app.use(createVuetify());
  return renderToString(app);
}
let pickerApp;
afterEach(() => { pickerApp?.unmount(); pickerApp = null; });
function mountPicker(props = {}) {
  pickerApp = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
    .createApp({ ...TrainingLessonPicker, render: () => null }, {
      catalogueResult: pickerCatalogue(), learningResult: pickerLearning(), canStart: true, canResume: true, ...props
    });
  pickerApp.provide(ssrContextKey, { modules: new Set() });
  pickerApp.mount({});
  return pickerApp._instance.setupState;
}
function selectFirst(state) {
  state.selectionId = state.choiceId(state.courses[0], state.courses[0].lessons[0]);
}

describe("Training lesson picker prerequisite", () => {
  it("shows exact installed release/hash in original lesson order without auto-selecting or starting", async () => {
    const start = vi.fn();
    const state = mountPicker({ onStart: start });
    expect(state.selected).toBeNull();
    expect(state.startEnabled).toBeFalsy();
    expect(start).not.toHaveBeenCalled();
    const html = await renderPicker({ catalogueResult: pickerCatalogue(), learningResult: pickerLearning(), canStart: true });
    expect(html).toContain('aria-label="Lessons"');
    expect(html).toContain("getting-started · 0.1.7");
    expect(html).toContain(pickerHash);
    expect(html.indexOf("V64-START-00")).toBeLessThan(html.indexOf("V64-START-01"));
    expect(html).toContain("Select a published lesson from an enabled release.");
  });

  it("emits only the existing start input's captured exact choice and learner revision", async () => {
    const start = vi.fn();
    const state = mountPicker({ onStart: start });
    selectFirst(state);
    state.requestStart();
    expect(start).toHaveBeenCalledExactlyOnceWith({ courseId: "getting-started", release: "0.1.7", lessonCode: "V64-START-00", expectedRevision: 9 });
    const captured = start.mock.calls[0][0];
    pickerApp._instance.props.catalogueResult = { ...pickerCatalogue(), courses: [] };
    pickerApp._instance.props.learningResult = { ...pickerLearning(), revision: 10 };
    await nextTick();
    expect(state.selected).toBeNull();
    state.requestStart();
    expect(start).toHaveBeenCalledOnce();
    expect(captured).toEqual({ courseId: "getting-started", release: "0.1.7", lessonCode: "V64-START-00", expectedRevision: 9 });
  });

  it("retires selection when the exact displayed lesson hash changes instead of retargeting it", async () => {
    const start = vi.fn();
    const state = mountPicker({ onStart: start });
    selectFirst(state);
    const changed = pickerCatalogue();
    changed.courses[0].lessons[0].hash = "e".repeat(64);
    pickerApp._instance.props.catalogueResult = changed;
    await nextTick();
    expect(state.selectionId).toBe("");
    expect(state.selected).toBeNull();
    state.requestStart();
    expect(start).not.toHaveBeenCalled();
  });

  it.each(["disabled", "preview", "draft"])("displays %s choices without emitting a new start", async (kind) => {
    const catalogue = pickerCatalogue();
    if (kind === "disabled") catalogue.courses[0].enabled = false;
    if (kind === "preview") catalogue.courses[0].status = "preview";
    if (kind === "draft") catalogue.courses[0].lessons[0].status = "draft";
    const start = vi.fn();
    const state = mountPicker({ catalogueResult: catalogue, onStart: start });
    selectFirst(state);
    state.requestStart();
    expect(start).not.toHaveBeenCalled();
    const html = await renderPicker({ catalogueResult: catalogue, learningResult: pickerLearning(), canStart: true });
    expect(html).toContain(kind === "disabled" ? "Disabled for new lessons" : kind === "preview" ? "Preview course" : "Draft — unavailable for new lessons");
  });

  it("resumes the exact saved attempt independently of disabled or missing current catalogue release", () => {
    const resume = vi.fn();
    const start = vi.fn();
    const state = mountPicker({ catalogueResult: { ...pickerCatalogue(), courses: [] }, learningResult: pickerLearning(pickerAttempt()), onResume: resume, onStart: start });
    expect(state.resumeEnabled).toBeTruthy();
    state.requestResume();
    expect(resume).toHaveBeenCalledExactlyOnceWith({ attemptId: savedId });
    state.requestStart();
    expect(start).not.toHaveBeenCalled();
  });

  it("does not infer resume support from a saved attempt or hide read-only ended history", async () => {
    const attempt = pickerAttempt();
    const learning = pickerLearning(attempt);
    learning.history = [{ ...pickerAttempt(), attemptId: "22222222-2222-4222-8222-222222222222", ended: { reason: "restart", revision: 4, requestId: "end-one" } }];
    const resume = vi.fn();
    const state = mountPicker({ catalogueResult: { ...pickerCatalogue(), courses: [] }, learningResult: learning, canResume: false, onResume: resume });
    state.requestResume();
    expect(resume).not.toHaveBeenCalled();
    const html = await renderPicker({ catalogueResult: { ...pickerCatalogue(), courses: [] }, learningResult: learning, canResume: false });
    expect(html).toContain("Your saved attempt remains visible.");
    expect(html).toContain("Saved lesson history (1)");
    expect(html).toContain("22222222-2222-4222-8222-222222222222");
    expect(html).toContain("Ended attempt");
    expect(html).not.toContain("Required assessments complete.");
  });

  it("shows only supplied matching completion counts and refuses a mismatched saved lesson result", async () => {
    const learning = pickerLearning(pickerAttempt());
    learning.completion = { lessonCode: "V64-START-00", lessonHash: pickerHash, required: 3, passed: 2, completed: false };
    const html = await renderPicker({ learningResult: learning });
    expect(html).toContain("2 of 3 required assessments passed.");
    expect(html).not.toContain("Required assessments complete.");
    const resume = vi.fn();
    learning.completion = { ...learning.completion, lessonHash: "f".repeat(64) };
    const state = mountPicker({ learningResult: learning, onResume: resume });
    expect(state.learningInvalid).toBe(true);
    state.requestResume();
    expect(resume).not.toHaveBeenCalled();
    expect(await renderPicker({ learningResult: learning })).toContain("Saved learning could not be displayed.");
  });

  it("shows truthful initial loading, unavailable, empty, corrupt and explicit read-error states", async () => {
    const loading = await renderPicker({ catalogueLoading: true, learningLoading: true });
    expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain('aria-label="Loading installed lessons"');
    expect(loading).toContain('aria-label="Loading saved lesson"');
    expect(loading).not.toContain("No courses are installed.");
    expect(await renderPicker({ catalogueResult: { ok: false, available: false, error: "Courses unavailable" } })).toContain("Courses unavailable");
    expect(await renderPicker({ catalogueResult: { ok: true, available: true, revision: 0, courses: [] }, learningResult: pickerLearning() })).toContain("No courses are installed.");
    expect(await renderPicker({ catalogueResult: { ok: true, available: true, revision: 1, courses: [{}] } })).toContain("Installed lesson choices could not be displayed.");
    expect(await renderPicker({ catalogueError: "Pinned catalogue is corrupt", learningError: "Saved learning cannot load" })).toContain("Pinned catalogue is corrupt");
    expect(await renderPicker({ catalogueError: "Pinned catalogue is corrupt", learningError: "Saved learning cannot load" })).toContain("Saved learning cannot load");
  });

  it.each(["busy", "catalogueLoading", "learningLoading", "catalogueError", "learningError", "canStart"])("does not dispatch a start through %s", (gate) => {
    const start = vi.fn();
    const props = { onStart: start, [gate]: gate.endsWith("Error") ? "Read unavailable" : gate === "canStart" ? false : true };
    const state = mountPicker(props);
    selectFirst(state);
    state.requestStart();
    expect(start).not.toHaveBeenCalled();
  });

  it("retains displayed cached choices during refresh without admitting new work", async () => {
    const state = mountPicker();
    selectFirst(state);
    pickerApp._instance.props.catalogueLoading = true;
    await nextTick();
    expect(state.selected.lesson.code).toBe("V64-START-00");
    expect(state.startEnabled).toBeFalsy();
    const html = await renderPicker({ catalogueResult: pickerCatalogue(), learningResult: pickerLearning(pickerAttempt()), catalogueLoading: true, learningLoading: true });
    expect(html).toContain("Saved lesson · V64-START-00");
    expect(html).toContain("Getting started");
    expect(html).not.toContain('aria-label="Loading installed lessons"');
    expect(html).not.toContain('aria-label="Loading saved lesson"');
  });
});


it("shows the actual readable lesson title alongside its exact code", async () => {
  const html = await renderPicker({ catalogueResult: pickerCatalogue(), learningResult: pickerLearning(), canStart: true });
  expect(html).toContain("Connect your first AI · V64-START-00");
  expect(html).toContain("Explore Vibe64 · V64-START-01");
  expect(html).toContain(pickerHash);
});

it("missing titles refuse new choice intent while retaining saved attempt and read-only history", async () => {
  const catalogue = pickerCatalogue();
  delete catalogue.courses[0].lessons[0].title;
  const learning = pickerLearning(pickerAttempt());
  learning.history = [{ ...pickerAttempt(), attemptId: "22222222-2222-4222-8222-222222222222", ended: { reason: "restart" } }];
  const html = await renderPicker({ catalogueResult: catalogue, learningResult: learning, canStart: true, canResume: true });
  expect(html).toContain("Lesson titles are unavailable. Refresh lesson choices");
  expect(html).toContain("Refresh lessons");
  expect(html).toContain("Saved lesson · V64-START-00");
  expect(html).toContain("Saved lesson history (1)");
  const start = vi.fn();
  const state = mountPicker({ onStart: start });
  selectFirst(state);
  const captured = state.selectionId;
  pickerApp._instance.props.catalogueResult = catalogue;
  await nextTick();
  expect(state.catalogueInvalid).toBe(true);
  expect(state.selectionId).toBe(captured);
  expect(state.selected).toBeNull();
  state.requestStart();
  expect(start).not.toHaveBeenCalled();
  pickerApp._instance.props.catalogueResult = pickerCatalogue();
  await nextTick();
  expect(state.selected.lesson.title).toBe("Connect your first AI");
  expect(state.selected.lesson.hash).toBe(pickerHash);
});
