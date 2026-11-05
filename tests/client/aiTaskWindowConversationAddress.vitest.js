import { createRenderer, defineComponent, h, provide, reactive, ref, watch } from "vue";
import { createMemoryHistory, createRouter, useRoute, useRouter } from "vue-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VIBE64_AI_TASKS_KEY, useAiTaskHost } from "@local/vibe64-ai-tasks/client";
import { useVibe64ColleagueNavigation } from "../../src/composables/useVibe64ColleagueNavigation.js";
import { useVibe64TemporaryAiColleagueView } from "../../src/composables/useVibe64TemporaryAiColleagueView.js";
import { provideShellContext } from "./helpers/shellContext.js";

vi.mock("@jskit-ai/realtime/client/composables/useRealtimeEvent", () => ({ useRealtimeEvent: () => {} }));

// A host may keep the selected conversation in the URL (?conversation=, ?chat=main); an open AI task window is
// that selection, and its own address (?aiTask=) must not read as the URL asking for the previous one.
const TASK = {
  id: "task-1", kind: "project-setup", title: "Fix project setup", noun: "fix", tray: "Setting up the project…",
  steps: ["The AI sets up the project", "Vibe64 inspects the project"],
  check: { by: "vibe64", label: "Vibe64 is inspecting the project…", retryLimit: 3, output: "", unstoppable: "" },
  revision: 1, phase: "working", active: true, reason: "", message: "", waiting: false, checkRunning: false,
  problem: { key: "project-setup", summary: "Program module cites a missing or ineligible source file.", details: "" },
  conflictReview: "", conflictPaths: [], startedBy: null, endedBy: null, attempt: 1, report: "", log: [], diagnostic: ""
};

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

/** One session view with its AI task host, under the shared navigation that keeps its conversation in the URL. */
async function mountSession(start = "/app/project/demo?session=s1") {
  const router = createRouter({
    history: browserLikeHistory(),
    routes: [{ path: "/app/project/:slug/:rest(.*)*", component: { render: () => null } }]
  });
  await router.push(start);
  const temporary = {
    activeTask: ref(null), activeTaskId: ref(""), open: ref(false), tasks: ref([]), restoreError: ref(""),
    closeWorkspace() { this.open.value = false; }, async restoreTasks() {}, selectTask() {}
  };
  const session = {};
  const Workspace = defineComponent({
    setup() {
      useVibe64TemporaryAiColleagueView({
        props: reactive({ projectSlug: "demo", sessionId: "s1", assistantReady: true, sessionSelected: true,
          openFile: () => false, sendLessonMessage: async () => false }),
        emit: () => {},
        temporary,
        selectionRevision: ref(0)
      });
      return () => null;
    }
  });
  const SessionView = defineComponent({
    setup() {
      session.host = useAiTaskHost({
        sessionId: "s1", sessionsApiPath: "/api/vibe64/sessions", projectSlug: "demo", enabled: true, active: true,
        request: async () => ({ tasks: [TASK], viewerId: "ana" }),
        route: useRoute(), router: useRouter(),
        openAiSetup() {}, reviewResolved() {}, fallbackFocus: () => null
      });
      provide(VIBE64_AI_TASKS_KEY, session.host);
      return () => h(Workspace);
    }
  });
  const Root = defineComponent({
    setup() {
      useVibe64ColleagueNavigation({ conversationQuery: true });
      return () => h(SessionView);
    }
  });
  const app = createRenderer(nodeOps).createApp(Root);
  app.use(router);
  provideShellContext(app, { learning: reactive({}) });
  app.mount({});
  unmounts.push(() => app.unmount());
  await settle();
  return { host: session.host, route: router.currentRoute, router };
}

describe("an AI task window in a host that keeps the conversation in the URL", () => {
  it("opens from a Fix it with AI button on the Main chat and stays open", async () => {
    const { host, route } = await mountSession();
    expect(route.value.query).toEqual({ session: "s1", chat: "main" });
    expect(host.task?.id).toBe("task-1");

    const shown = [];
    const stop = watch(() => host.open, open => shown.push(open), { flush: "sync" });
    host.show(null);
    await settle();
    stop();

    expect(shown).toEqual([true]);
    expect(host.open).toBe(true);
    expect(route.value.query).toEqual({ session: "s1", conversation: "task-1", aiTask: "task-1" });
  });

  it("Hide goes back to the Main chat", async () => {
    const { host, route } = await mountSession();
    host.show(null);
    await settle();
    expect(host.open).toBe(true);
    host.hide();
    await settle();
    expect(host.open).toBe(false);
    expect(route.value.query).toEqual({ session: "s1", chat: "main" });
  });

  it("a reload at the window's address keeps it open", async () => {
    const { host, route } = await mountSession("/app/project/demo?session=s1&conversation=task-1&aiTask=task-1");
    expect(host.open).toBe(true);
    expect(route.value.query).toEqual({ session: "s1", conversation: "task-1", aiTask: "task-1" });
  });
});
