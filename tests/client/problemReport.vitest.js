import { readFile } from "node:fs/promises";
import { createRenderer, createSSRApp, defineComponent, h, nextTick, ssrContextKey } from "vue";
import { renderToString } from "vue/server-renderer";
import { createVuetify } from "vuetify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const http = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@jskit-ai/http-web/client/lib/httpClient", () => ({ getHttpWebClient: () => http }));
vi.mock("@jskit-ai/shell-web/client/error", () => ({ useShellWebErrorRuntime: () => ({ report: vi.fn(), subscribe: () => () => null }) }));
vi.mock("vue-router", () => ({ useRoute: () => ({ fullPath: "/app/project/shop/dashboard", name: "dashboard", params: { slug: "shop" } }) }));
vi.mock("vuetify", async (original) => ({ ...await original(), useDisplay: () => ({ smAndDown: { value: false } }) }));

import { createProblemReportErrorRecorder } from "../../src/lib/problemReportClientErrors.js";
import { describeProblemReport } from "../../src/lib/problemReportPresentation.js";
import { collectProblemReport, sendProblemReport } from "../../src/lib/problemReportRequests.js";
import { NO_PROBLEM_REPORT, provideProblemReport, useProblemReport, useProblemReportPlace } from "../../src/composables/useProblemReport.js";
import RoutingNotice from "../../src/components/studio/vibe64-session/Vibe64RoutingNotice.vue";
import TurnInterruption from "../../src/components/studio/vibe64-session/Vibe64TurnInterruption.vue";
import ProblemReportHost from "../../src/components/studio/Vibe64ProblemReportHost.vue";

// Report a problem in the page: the errors the shell records for a report, which place a report describes, the two
// requests, the review's summary, the dialog, and where it opens from.

function fakeErrorRuntime() {
  const listeners = new Set();
  return {
    listeners,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    report(event) {
      for (const listener of listeners) listener({ type: "reported", result: { event } });
    }
  };
}

const errorEvent = (fields) => Object.assign(new Event("error"), fields);

const hostNode = () => ({ parent: null, children: [] });
const siblingOf = (node) => (node.parent ? node.parent.children[node.parent.children.indexOf(node) + 1] ?? null : null);

/** Vue's renderer over plain objects that keep their children, so a page mounts and unmounts as in a browser. */
function objectRenderer() {
  function detach(node) {
    if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
    node.parent = null;
  }
  return createRenderer({
    createElement: hostNode,
    createText: hostNode,
    createComment: hostNode,
    setText() {},
    setElementText() {},
    patchProp() {},
    insert(node, parent, anchor = null) {
      detach(node);
      const at = anchor ? parent.children.indexOf(anchor) : -1;
      parent.children.splice(at < 0 ? parent.children.length : at, 0, node);
      node.parent = parent;
    },
    remove: detach,
    parentNode: (node) => node.parent,
    nextSibling: siblingOf
  });
}

/**
 * Mounts a stand-in for the app's shell, which makes the page's Report a problem, around `child`.
 * @returns {{ app: any, report: any, child: () => any }}
 */
function mountShell(child = null, { errorRuntime = fakeErrorRuntime(), target = new EventTarget() } = {}) {
  const renderer = objectRenderer();
  let report = null;
  const app = renderer.createApp(defineComponent({
    setup() {
      report = provideProblemReport({ errorRuntime, target: () => target });
      return () => (child ? h(child) : null);
    }
  }));
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount(hostNode());
  return { app, report, child: () => app._instance.subTree.component };
}

beforeEach(() => {
  http.request.mockReset();
});

describe("the errors a page records for a report", () => {
  it("keeps the page's reported errors and warnings and the browser's unhandled ones, newest last, until it stops", () => {
    const target = new EventTarget();
    const runtime = fakeErrorRuntime();
    const recorder = createProblemReportErrorRecorder();
    const stop = recorder.listen({ errorRuntime: runtime, target });
    runtime.report({ source: "vibe64.chat", severity: "error", status: 500, message: "Sending failed." });
    runtime.report({ source: "vibe64.chat.review", severity: "info", message: "Review paused." });
    runtime.report({ source: "vibe64.save", severity: "warning", code: "vibe64_save_conflict", message: "Save conflicted." });
    target.dispatchEvent(errorEvent({ message: "x is undefined", error: { name: "TypeError" } }));
    target.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason: { code: "E_GONE", message: "gone" } }));
    expect(recorder.errors().map(({ source, code, message }) => [source, code, message])).toEqual([
      ["vibe64.chat", "500", "Sending failed."],
      ["vibe64.save", "vibe64_save_conflict", "Save conflicted."],
      ["window.error", "TypeError", "x is undefined"],
      ["window.unhandledrejection", "E_GONE", "gone"]
    ]);
    stop();
    target.dispatchEvent(errorEvent({ message: "after" }));
    runtime.report({ source: "after", severity: "error", message: "after" });
    expect(recorder.errors()).toHaveLength(4);
    expect(runtime.listeners.size).toBe(0);
  });

  it("keeps the newest fifty", () => {
    const target = new EventTarget();
    const recorder = createProblemReportErrorRecorder();
    const stop = recorder.listen({ errorRuntime: fakeErrorRuntime(), target });
    let next = 0;
    const fireTo = (to) => {
      while (next < to) {
        target.dispatchEvent(errorEvent({ message: `e${next}` }));
        next += 1;
      }
      const kept = recorder.errors();
      return [kept.length, kept[0].message, kept.at(-1).message];
    };
    expect(fireTo(50)).toEqual([50, "e0", "e49"]);
    // Each one past fifty drops the oldest at once.
    expect(fireTo(51)).toEqual([50, "e1", "e50"]);
    expect(fireTo(52)).toEqual([50, "e2", "e51"]);
    expect(fireTo(60)).toEqual([50, "e10", "e59"]);
    stop();
  });

  it("is the shell's: it records from the shell's mount to its unmount", () => {
    const target = new EventTarget();
    const errorRuntime = fakeErrorRuntime();
    const { app, report } = mountShell(null, { errorRuntime, target });
    target.dispatchEvent(errorEvent({ message: "while shown" }));
    app.unmount();
    target.dispatchEvent(errorEvent({ message: "after" }));
    expect(report.errors().map((entry) => entry.message)).toEqual(["while shown"]);
    expect(errorRuntime.listeners.size).toBe(0);
  });
});

describe("the place a report describes", () => {
  const Place = (place) => defineComponent({ setup: () => { useProblemReportPlace(() => place); return () => null; } });

  it("is the newest shown view's session, and none once it is gone", () => {
    const { app, report } = mountShell(defineComponent({
      setup: () => () => [h(Place({ sessionId: "s-1", chat: { kind: "main" } })), h(Place(null))]
    }));
    expect(report.place()).toEqual({ sessionId: "s-1", chat: { kind: "main", id: "" } });
    app.unmount();
    expect(report.place()).toBeNull();
  });

  it("is the newest of the shown views that name a session", () => {
    const { app, report } = mountShell(defineComponent({
      setup: () => () => [h(Place({ sessionId: "s-1", chat: { kind: "main" } })), h(Place({ sessionId: "s-2", chat: null }))]
    }));
    expect(report.place()).toEqual({ sessionId: "s-2", chat: null });
    app.unmount();
  });

  it("opens with the chat ticked unless the opener says otherwise", () => {
    const { app, report } = mountShell();
    report.open();
    expect([report.available, report.state.open, report.state.includeChat]).toEqual([true, true, true]);
    report.open({ includeChat: false });
    expect(report.state.includeChat).toBe(false);
    report.close();
    expect(report.state.open).toBe(false);
    app.unmount();
  });

  it("is nothing outside the app's shell, where nothing opens it and a view names no place", () => {
    const renderer = objectRenderer();
    let found;
    const app = renderer.createApp(defineComponent({
      setup: () => {
        found = useProblemReport();
        useProblemReportPlace(() => ({ sessionId: "s-1" }));
        return () => null;
      }
    }));
    app.mount(hostNode());
    expect(found).toBe(NO_PROBLEM_REPORT);
    found.open();
    expect([found.available, found.state.open, found.place()]).toEqual([false, false, null]);
    app.unmount();
  });
});

describe("the report's requests", () => {
  it("collects a project's report with its session, chat and errors, and the workspace's with neither", async () => {
    http.request.mockResolvedValue({ ok: true });
    const errors = [{ at: "2026-11-25T10:00:00.000Z", source: "window.error", code: "", message: "boom" }];
    await collectProblemReport({ projectSlug: "shop", page: "Session", route: "/app/project/shop", sessionId: "s-1",
      chat: { kind: "main", id: "" }, includeChat: true, errors });
    await collectProblemReport({ projectSlug: "", page: "Projects", route: "/app", sessionId: "s-1", chat: { kind: "main" }, includeChat: true });
    const [[projectUrl, project], [workspaceUrl, workspace]] = http.request.mock.calls;
    expect(projectUrl).toBe("/api/app/shop/vibe64/problem-report");
    expect(project.method).toBe("POST");
    expect(project.body).toMatchObject({ page: "Session", sessionId: "s-1", chat: { kind: "main" }, includeChat: true });
    expect(project.body.client.errors).toEqual(errors);
    expect(workspaceUrl).toBe("/api/studio/problem-report");
    expect(workspace.body).not.toHaveProperty("sessionId");
    expect(workspace.body).not.toHaveProperty("chat");
    expect(workspace.body.client.errors).toEqual([]);
  });

  it("sends the reviewed draft with the note and the consents", async () => {
    http.request.mockResolvedValue({ ok: true, reference: "PR-1" });
    expect(await sendProblemReport({ draftId: "d", note: "n", consents: { access: true } })).toEqual({ ok: true, reference: "PR-1" });
    expect(http.request).toHaveBeenCalledWith("/api/studio/problem-report/send",
      { method: "POST", body: { draftId: "d", note: "n", consents: { access: true } } });
  });
});

it("summarises what a report includes, and says when the chat is left out", () => {
  const bundle = {
    place: { page: "Session", route: "/app/project/shop" },
    reporter: { username: "ada", role: "member" },
    window: { to: "2026-11-25T10:00:00.000Z" },
    versions: { app: "0.1.82", jskit: "0.2.33", engine: { engineId: "codex", modelId: "gpt" }, host: { platform: "11" } },
    client: { errors: [{}, {}] },
    server: { crashes: [] },
    session: {
      sessionId: "s-1", turns: [{}], events: [{}, {}, {}], plan: { title: "Ship", status: "active" },
      routing: { role: "senior", status: "working", delivery: "failed" }, preview: { state: "failed", message: "exited" }
    },
    host: [{ id: "staging", title: "Staging", state: "failed", lastError: { code: "E" } }],
    chat: null
  };
  const lines = Object.fromEntries(describeProblemReport(bundle).map(({ label, value }) => [label, value]));
  expect(lines.Session).toContain("1 turn, 3 timeline events, plan \"Ship\" (active)");
  expect(lines.Session).toContain("never quoted");
  expect(lines.Preview).toBe("failed: exited");
  expect(lines.Staging).toBe("failed: E");
  expect(lines["Errors this page saw"]).toBe("2");
  expect(lines.Versions).toBe("app 0.1.82, JSKIT 0.2.33, AI codex gpt, platform 11");
  expect(lines["Chat messages"]).toBe("not included");
  expect(describeProblemReport({ ...bundle, chat: { messages: [{}, {}] } }).at(-1).value).toBe("2 messages");
});

describe("where a chat shows a problem", () => {
  // Rendered inside the shell's Report a problem, as on a page, or alone.
  const render = (component, props, { inShell = true } = {}) => {
    const app = createSSRApp(defineComponent({
      setup() {
        if (inShell) provideProblemReport({ errorRuntime: fakeErrorRuntime(), target: () => new EventTarget() });
        return () => h(component, props);
      }
    }));
    app.use(createVuetify());
    return renderToString(app);
  };

  it("a failed routed request offers Report a problem, and one that did not fail does not", async () => {
    const failed = { messageId: "m", status: "waiting", stage: "review", workflow: true, delivery: "failed", resolvedMode: "junior",
      followup: { messageId: "f" }, error: "Scheduling disconnected before the handoff was sent." };
    expect(await render(RoutingNotice, { request: failed, mode: "auto" })).toContain("Report a problem");
    const waiting = { ...failed, error: "" };
    expect(await render(RoutingNotice, { request: waiting, mode: "auto" })).not.toContain("Report a problem");
    expect(await render(RoutingNotice, { request: failed, mode: "auto" }, { inShell: false })).not.toContain("Report a problem");
  });

  it("an interrupted turn offers Report a problem", async () => {
    const entry = { outcome: "resumed", at: "2026-11-25T10:00:00.000Z", cause: "crash" };
    expect(await render(TurnInterruption, { entry })).toContain("Report a problem");
    expect(await render(TurnInterruption, { entry }, { inShell: false })).not.toContain("Report a problem");
  });
});

describe("opening it from every page", () => {
  it("offers Report a problem in the account menu, as the guide place Colleague points at, and the shell holds it", async () => {
    const menu = await readFile(new URL("../../src/components/studio/Vibe64AuthSettingsButton.vue", import.meta.url), "utf8");
    const item = menu.match(/<v-list-item[^>]*title="Report a problem"[^>]*\/>/u)?.[0] || "";
    expect(item).toContain('data-vibe64-guide="report-a-problem"');
    expect(item).toContain('@click="problemReport.open()"');
    expect(item).toContain('v-if="problemReport.available"');
    const shell = await readFile(new URL("../../src/components/StudioAppShellLayout.vue", import.meta.url), "utf8");
    expect(shell).toMatch(/\nprovideProblemReport\(\);\n/u);
  });
});

describe("the dialog", () => {
  const collected = (includeChat) => ({
    ok: true,
    draftId: "0f8fad5b-d9cb-469f-a165-70867728950e",
    bundle: {
      schema: "vibe64.problem-report.v1", createdAt: "2026-11-25T10:00:00.000Z", note: "", place: { page: "Session" },
      session: { sessionId: "s-1", turns: [], events: [] }, chat: includeChat ? { messages: [{}] } : null,
      masking: { rules: "v1", hidden: 2 }
    },
    delivery: { label: "Send to Vibe64", description: "", consents: [{ id: "access", label: "Let Vibe64 look", description: "14 days", default: true }] }
  });
  const Host = defineComponent({ ...ProblemReportHost, render: () => null });
  const settle = async () => {
    for (let index = 0; index < 5; index += 1) await nextTick();
  };

  it("gathers the shown session's report with the page's errors as it opens, regathers without the chat, and sends with the consents ticked", async () => {
    http.request.mockImplementation(async (url, { body }) => (url.endsWith("/send") ? { ok: true, reference: "PR-ABCD2345" } : collected(body.includeChat)));
    const target = new EventTarget();
    const Page = defineComponent({
      setup: () => {
        useProblemReportPlace(() => ({ sessionId: "s-1", chat: { kind: "main" } }));
        return () => h(Host);
      }
    });
    const { app, report, child } = mountShell(Page, { target });
    const state = () => child().subTree.component.setupState;
    target.dispatchEvent(errorEvent({ message: "x is undefined" }));
    report.open();
    await settle();
    const [url, { body }] = http.request.mock.calls[0];
    expect(url).toBe("/api/app/shop/vibe64/problem-report");
    expect(body).toMatchObject({ route: "/app/project/shop/dashboard", sessionId: "s-1", chat: { kind: "main", id: "" }, includeChat: true });
    expect(body.client.errors.map((entry) => entry.message)).toEqual(["x is undefined"]);
    expect(state().hiddenLabel).toBe("2 values hidden");
    expect(state().parts.at(-1)).toEqual({ label: "Chat messages", value: "1 message" });
    expect(state().consentChoices).toEqual({ access: true });

    state().includeChatChoice = false;
    await settle();
    expect(http.request.mock.calls[1][1].body.includeChat).toBe(false);
    expect(state().parts.at(-1)).toEqual({ label: "Chat messages", value: "not included" });

    state().note = "It stopped after the review.";
    await state().send();
    expect(http.request.mock.calls[2]).toEqual(["/api/studio/problem-report/send",
      { method: "POST", body: { draftId: "0f8fad5b-d9cb-469f-a165-70867728950e", note: "It stopped after the review.", consents: { access: true } } }]);
    expect(state().reference).toBe("PR-ABCD2345");
    state().close();
    expect(report.state.open).toBe(false);
    app.unmount();
  });

  it("says why a report could not be gathered or sent, and keeps what was gathered", async () => {
    http.request.mockRejectedValueOnce(new Error("Sign in to report a problem."));
    const { app, report, child } = mountShell(Host);
    const state = () => child().setupState;
    report.open();
    await settle();
    expect(state().error).toBe("Sign in to report a problem.");
    expect(state().bundle).toBeNull();
    http.request.mockResolvedValueOnce(collected(false));
    await state().collect();
    http.request.mockRejectedValueOnce(new Error("This report is too large to send."));
    await state().send();
    expect(state().error).toBe("This report is too large to send.");
    expect(state().reference).toBe("");
    expect(state().bundle).not.toBeNull();
    app.unmount();
  });
});
