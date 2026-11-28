import { computed, createRenderer, defineComponent, reactive, ref, watch } from "vue";
import { createMemoryHistory, createRouter, useRoute, useRouter } from "vue-router";
import { afterEach, describe, expect, it } from "vitest";
import { projectSlugFromRoute } from "../../src/lib/vibe64ProjectScope.js";
import { sessionAddressQuery, useVibe64SessionAddress } from "../../src/composables/useVibe64SessionAddress.js";
import { useVibe64SessionSelection } from "../../src/composables/useVibe64SessionSelection.js";
import { useVibe64ColleagueNavigation } from "../../src/composables/useVibe64ColleagueNavigation.js";
import { provideShellContext } from "./helpers/shellContext.js";

// The address names the session on screen (and, in a host that keeps the conversation in the URL, its chat), so a
// reload, a copied link or the address opened again shows what was on screen.

const nodeOps = {
  createElement: () => ({}), createText: () => ({}), createComment: () => ({}), setText() {}, setElementText() {},
  patchProp() {}, insert() {}, remove() {}, parentNode: () => null, nextSibling: () => null
};
const unmounts = [];
afterEach(() => { for (const unmount of unmounts.splice(0)) unmount(); });

const settle = async () => {
  for (let round = 0; round < 10; round += 1) await new Promise(resolve => setTimeout(resolve, 0));
};

/** A browser's history: Back arrives as a later task, after the navigations the page starts in this one. */
function browserLikeHistory() {
  const history = createMemoryHistory();
  const go = history.go.bind(history);
  history.go = (delta, trigger) => { setTimeout(() => go(delta, trigger), 0); };
  return history;
}

/** A session's view as its workspace publishes it to Colleague: Main chat until a temporary chat is picked. */
function sessionView(sessionId) {
  const view = reactive({
    projectSlug: "demo", sessionId, ready: true, selectionRevision: 0, temporarySelected: false, conversationId: "",
    async openConversation(conversationId) { view.pick(conversationId); },
    pick(conversationId) {
      view.conversationId = conversationId;
      view.temporarySelected = Boolean(conversationId);
      view.selectionRevision += 1;
    }
  });
  return view;
}

/**
 * The project page's session selection and its address, as the session collection wires them, with a host's
 * Colleague navigation and each session's view when conversationQuery is set.
 */
async function mountPage(start, { before = "", sessions = ["s1", "s2"], conversationQuery = false } = {}) {
  const router = createRouter({
    history: browserLikeHistory(),
    routes: [
      { path: "/app/project/:slug/:rest(.*)*", component: { render: () => null } },
      { path: "/:rest(.*)*", component: { render: () => null } }
    ]
  });
  if (before) await router.push(before);
  await router.push(start);
  const list = ref(sessions.map(sessionId => ({ sessionId })));
  const views = Object.fromEntries(["s1", "s2", "s3"].map(id => [id, sessionView(id)]));
  const page = { list, router, route: router.currentRoute, views };
  let slots = null;
  const Root = defineComponent({
    setup() {
      const route = useRoute();
      const projectSlug = computed(() => projectSlugFromRoute(route));
      const selection = useVibe64SessionSelection({ projectSlug, rememberedId: () => "", route });
      useVibe64SessionAddress({ projectSlug, route, router: useRouter(), selectedSessionId: selection.selectedId, sessions: list });
      page.selection = selection;
      if (conversationQuery) {
        useVibe64ColleagueNavigation({ conversationQuery: true });
        // The selected session's workspace publishes its view (useVibe64TemporaryAiColleagueView).
        watch(selection.selectedId, id => { slots.colleagueView.value = views[id] || null; }, { immediate: true });
      }
      return () => null;
    }
  });
  const app = createRenderer(nodeOps).createApp(Root);
  app.use(router);
  slots = provideShellContext(app, { learning: reactive({}) });
  app.mount({});
  unmounts.push(() => app.unmount());
  await settle();
  return page;
}

describe("the session the address names", () => {
  it("is the one shown, with the previous session's chat dropped and the rest of the address kept", () => {
    const sessions = [{ sessionId: "s1" }, { sessionId: "s2" }];
    const route = (query, slug = "demo") => ({ params: { slug }, query });
    const shown = { route: route({ session: "s1", chat: "main", conversation: "c1", pane: "dashboard" }), projectSlug: "demo", sessions };

    expect(sessionAddressQuery({ ...shown, shownSessionId: "s2" })).toEqual({ pane: "dashboard", session: "s2" });
    expect(sessionAddressQuery({ ...shown, shownSessionId: "s1" })).toBe(null);
    // Nothing shown: the address names no session.
    expect(sessionAddressQuery({ ...shown, shownSessionId: "" })).toEqual({ pane: "dashboard" });
    // A session the list does not name yet waits for the list.
    expect(sessionAddressQuery({ ...shown, shownSessionId: "s3" })).toBe(null);
    // Another project's session in this project's address gives way to the one shown.
    expect(sessionAddressQuery({ ...shown, route: route({ session: "shop-session", chat: "main" }), shownSessionId: "s1" }))
      .toEqual({ session: "s1" });
    // A view still showing while the route names the next project keeps that address.
    expect(sessionAddressQuery({ ...shown, route: route({ session: "x" }, "shop"), shownSessionId: "s1" })).toBe(null);
    // An address without a session keeps none: the project opens the last opened one.
    expect(sessionAddressQuery({ ...shown, route: route({ pane: "dashboard" }), shownSessionId: "s2" })).toBe(null);
    expect(sessionAddressQuery({ ...shown, route: route({ session: ["s1", "s2"] }), shownSessionId: "s1" })).toBe(null);
  });

  it("is a renewal's successor, once its renewal confirms it, with the same chat: the work goes on there", () => {
    const sessions = [{ sessionId: "s1" }, { sessionId: "s2" }];
    const route = (session) => ({ params: { slug: "demo" }, query: { session, chat: "main", conversation: "c1", pane: "dashboard" } });
    const handover = { projectSlug: "demo", sessions, shownSessionId: "s2" };

    expect(sessionAddressQuery({ ...handover, route: route("renewed"), renewal: { fromId: "renewed", confirmed: true } }))
      .toEqual({ session: "s2", chat: "main", conversation: "c1", pane: "dashboard" });
    // A switch the person makes, from a session still listed to one renewed from it, drops the chat.
    expect(sessionAddressQuery({ ...handover, route: route("s1"), renewal: { fromId: "s1", confirmed: true } }))
      .toEqual({ session: "s2", pane: "dashboard" });
  });
});

describe("the project page's address", () => {
  it("names the session a session tab switches to", async () => {
    const page = await mountPage("/app/project/demo?session=s1&chat=main&pane=dashboard");
    expect(page.selection.selectedId.value).toBe("s1");
    page.selection.select("s2");
    await settle();
    expect(page.route.value.query).toEqual({ pane: "dashboard", session: "s2" });
    expect(page.route.value.path).toBe("/app/project/demo");
  });

  it("replaces the address, so Back goes to the page before it rather than to the session shown before", async () => {
    const page = await mountPage("/app/project/demo?session=s1", { before: "/app/projects" });
    page.selection.select("s2");
    await settle();
    expect(page.route.value.query).toEqual({ session: "s2" });
    page.router.back();
    await settle();
    expect(page.route.value.fullPath).toBe("/app/projects");
  });

  it("follows an address that moves, a link or Back, and never undoes it", async () => {
    const page = await mountPage("/app/project/demo?session=s1");
    page.selection.select("s2");
    await settle();
    await page.router.push("/app/project/demo?session=s1");
    await settle();
    expect(page.selection.selectedId.value).toBe("s1");
    expect(page.route.value.query).toEqual({ session: "s1" });
    page.router.back();
    await settle();
    expect(page.route.value.query).toEqual({ session: "s2" });
    expect(page.selection.selectedId.value).toBe("s2");
  });

  it("names a new session once the list names it", async () => {
    const page = await mountPage("/app/project/demo?session=s1");
    page.selection.select("s3");
    await settle();
    expect(page.route.value.query).toEqual({ session: "s1" });
    page.list.value = [...page.list.value, { sessionId: "s3" }];
    await settle();
    expect(page.route.value.query).toEqual({ session: "s3" });
  });

  it("names the session shown after the one it named is archived, and none after the last", async () => {
    const page = await mountPage("/app/project/demo?session=s2&chat=main");
    page.list.value = [{ sessionId: "s1" }];
    page.selection.select("s1");
    await settle();
    expect(page.route.value.query).toEqual({ session: "s1" });
    page.list.value = [];
    page.selection.select("");
    await settle();
    expect(page.route.value.query).toEqual({});
  });

  it("names the session shown in place of one that has gone", async () => {
    const page = await mountPage("/app/project/demo?session=gone&chat=main");
    expect(page.selection.selectedId.value).toBe("gone");
    // The session collection's reconciliation, once the list has answered without it.
    page.selection.selectAvailableId(page.list.value, { fallbackId: "s2", getId: session => session.sessionId });
    await settle();
    expect(page.selection.selectedId.value).toBe("s2");
    expect(page.route.value.query).toEqual({ session: "s2" });
  });

  it("keeps an address without a session without one", async () => {
    const page = await mountPage("/app/project/demo");
    page.selection.select("s2");
    await settle();
    expect(page.route.value.query).toEqual({});
  });
});

describe("a host that keeps the conversation in the address", () => {
  it("names the chat picked, and the session switched to with its own chat", async () => {
    const page = await mountPage("/app/project/demo?session=s1&chat=main", { conversationQuery: true });
    expect(page.route.value.query).toEqual({ session: "s1", chat: "main" });
    page.views.s1.pick("c1");
    await settle();
    expect(page.route.value.query).toEqual({ session: "s1", conversation: "c1" });
    page.views.s1.pick("");
    await settle();
    expect(page.route.value.query).toEqual({ session: "s1", chat: "main" });

    page.selection.select("s2");
    await settle();
    expect(page.route.value.query).toEqual({ session: "s2", chat: "main" });
    page.views.s2.pick("c9");
    await settle();
    expect(page.route.value.query).toEqual({ session: "s2", conversation: "c9" });
    page.selection.select("s1");
    await settle();
    expect(page.route.value.query).toEqual({ session: "s1", chat: "main" });
  });

  it("opens exactly the session and chat an address names", async () => {
    const page = await mountPage("/app/project/demo?session=s2&conversation=c9", { conversationQuery: true });
    expect(page.selection.selectedId.value).toBe("s2");
    expect(page.views.s2.conversationId).toBe("c9");
    expect(page.views.s1.conversationId).toBe("");
    expect(page.route.value.query).toEqual({ session: "s2", conversation: "c9" });
  });
});
