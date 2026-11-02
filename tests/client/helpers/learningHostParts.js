import { shallowRef } from "vue";

// The parts a host shell passes the Learning controller, as no page has
// published them yet: no layout, page focus, browser navigation or project
// view; page activity nobody reports; a router at no address.
export function learningHostParts() {
  return {
    browserNavigation: shallowRef(null),
    colleagueView: shallowRef(null),
    layout: shallowRef(null),
    pageFocus: shallowRef(null),
    pageActivity: { report() {}, subscribe: () => () => {} },
    router: { currentRoute: { value: { path: "", fullPath: "" } }, push: async () => {} }
  };
}

// A project page's published layout, with the moves every page offers.
export function learningLayout(fields) {
  return shallowRef({ showProject() {}, hideLesson() {}, showChat() {}, ...fields });
}

// The shell's Learning controller once it has read Develop, with no lesson and
// nobody signed in to Learning: what every page and view sees before a learner starts one.
export function idleLearning(fields) {
  return {
    state: { actorKey: "", modeBusy: "", modeRead: true },
    learnMode: false,
    lessonShown: false,
    lessonAttemptId: "",
    lessonTitle: "",
    mode: null,
    lesson: shallowRef(null),
    toggleMode() {},
    toggleLesson() {},
    openCourses() {},
    modePlace: () => "/app",
    prepareExercise() {},
    exerciseStep: () => null,
    beginExercise: () => null,
    exerciseCurrent: () => false,
    finishExercise: async () => null,
    ...fields
  };
}
