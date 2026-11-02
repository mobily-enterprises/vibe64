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
