import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { compile } from "@vue/compiler-dom";
import { compileScript, parse } from "@vue/compiler-sfc";
import * as Vue from "vue";
import { html as renderDiffHtml } from "diff2html";
import { describe, expect, it, vi } from "vitest";
import {
  configureHttpWebClient,
  resetHttpWebClientForTests
} from "@jskit-ai/http-web/client/lib/httpClient";
import {
  VIBE64_SESSION_CHANGED_EVENT,
  VIBE64_SOURCE_EDITOR_FILE_CHANGED_EVENT
} from "../../src/lib/vibe64SessionRequestConfig.js";

vi.mock("@/components/studio/Vibe64TemporaryAiFixAction.vue", () => ({ default: { render: () => null } }));
vi.mock("vuetify/components/VBtn", () => ({ VBtn: passthroughComponent("button") }));
vi.mock("vuetify/components/VChip", () => ({ VChip: passthroughComponent("span") }));
vi.mock("vuetify/components/VIcon", () => ({ VIcon: passthroughComponent("span") }));
vi.mock("vuetify/components/VSheet", () => ({ VSheet: passthroughComponent("section") }));
vi.mock("vuetify/components/VAlert", () => ({ VAlert: passthroughComponent("aside") }));
vi.mock("vuetify/components/VCard", () => ({
  VCard: passthroughComponent("article"),
  VCardTitle: passthroughComponent("header"),
  VCardText: passthroughComponent("div")
}));
vi.mock("vuetify/components/VDialog", () => ({ VDialog: passthroughComponent("dialog") }));
vi.mock("vuetify/components/VDivider", () => ({ VDivider: passthroughComponent("hr") }));
vi.mock("vuetify/components/VProgressLinear", () => ({ VProgressLinear: passthroughComponent("progress") }));

import Vibe64RepositoryWorkspace from "../../src/components/studio/repository/Vibe64RepositoryWorkspace.vue";
import Vibe64RepositoryFileBrowser from "../../src/components/studio/repository/Vibe64RepositoryFileBrowser.vue";
import Vibe64RepositoryDiff from "../../src/components/studio/repository/Vibe64RepositoryDiff.vue";
import StudioErrorNotice from "../../src/components/studio/StudioErrorNotice.vue";
import RepositoryPage from "../../src/pages/app/project/[slug]/dashboard/repository/index.vue";
import ChangesPage from "../../src/pages/app/project/[slug]/dashboard/changes/index.vue";

const ROOT = new URL("../../", import.meta.url);

// Exercise real repository setup/templates and realtime; stub Vuetify presentation and Temporary AI.
for (const [component, file] of [
  [Vibe64RepositoryWorkspace, "src/components/studio/repository/Vibe64RepositoryWorkspace.vue"],
  [Vibe64RepositoryFileBrowser, "src/components/studio/repository/Vibe64RepositoryFileBrowser.vue"],
  [Vibe64RepositoryDiff, "src/components/studio/repository/Vibe64RepositoryDiff.vue"],
  [StudioErrorNotice, "src/components/studio/StudioErrorNotice.vue"],
  [RepositoryPage, "src/pages/app/project/[slug]/dashboard/repository/index.vue"],
  [ChangesPage, "src/pages/app/project/[slug]/dashboard/changes/index.vue"]
]) {
  const filename = new URL(file, ROOT).pathname;
  const { descriptor } = parse(readFileSync(filename, "utf8"), { filename });
  const script = compileScript(descriptor, { id: "repository-history-ui-test" });
  component.render = new Function("Vue", compile(descriptor.template.content, {
    bindingMetadata: script.bindings,
    mode: "function",
    prefixIdentifiers: true
  }).code)(Vue);
}

async function source(relativePath) {
  return readFile(new URL(relativePath, ROOT), "utf8");
}

function passthroughComponent(element) {
  return Vue.defineComponent({
    inheritAttrs: false,
    // Match VDialog's declared prop so Vue normalizes :model-value and v-model alike.
    props: element === "dialog" ? { modelValue: Boolean } : {},
    setup(props, { attrs, slots }) {
      return () => element === "dialog" && !props.modelValue
        ? null
        : Vue.h(element, {
            ...attrs,
            ...(element === "button" ? { disabled: Boolean(attrs.disabled || attrs.loading) } : {})
          }, Object.values(slots).flatMap((slot) => slot()));
    }
  });
}

function findNode(node, predicate) {
  if (predicate(node)) return node;
  for (const child of node.children || []) {
    const found = findNode(child, predicate);
    if (found) return found;
  }
  return null;
}

function nodeText(node) {
  return [node.text || "", ...(node.children || []).map(nodeText)].join("");
}

function mountHistoryWorkspace({ component = Vibe64RepositoryWorkspace, context = {} } = {}) {
  const requests = [];
  const dashboardContext = Vue.reactive({
    sessionId: "history-session",
    sessionsApiPath: "/api/app/sample/vibe64/sessions",
    ...context
  });
  const listeners = new Map();
  const socket = {
    on: vi.fn((event, listener) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(listener);
    }),
    off: vi.fn((event, listener) => listeners.get(event)?.delete(listener))
  };
  configureHttpWebClient({
    request(path, options) {
      const response = Promise.withResolvers();
      requests.push({ path, options, ...response });
      return response.promise;
    }
  });
  const renderer = Vue.createRenderer({
    createElement: (type) => ({ type, children: [], props: {}, parent: null }),
    createComment: (text) => ({ type: "comment", text, children: [], props: {} }),
    createText: (text) => ({ type: "text", text, children: [], props: {} }),
    insert(child, parent, anchor = null) {
      const previous = child.parent?.children?.indexOf(child) ?? -1;
      if (previous >= 0) child.parent.children.splice(previous, 1);
      child.parent = parent;
      const index = anchor ? parent.children.indexOf(anchor) : -1;
      if (index < 0) parent.children.push(child);
      else parent.children.splice(index, 0, child);
    },
    remove(child) {
      const index = child.parent?.children?.indexOf(child) ?? -1;
      if (index >= 0) child.parent.children.splice(index, 1);
    },
    parentNode: (node) => node.parent,
    nextSibling: (node) => node.parent?.children[node.parent.children.indexOf(node) + 1] || null,
    patchProp: (node, key, _previous, value) => { node.props[key] = value; },
    setElementText(node, text) {
      node.children = [];
      node.text = text;
    },
    setText: (node, text) => { node.text = text; }
  });
  const app = renderer.createApp(component, {
    dashboardContext,
    ...(component === Vibe64RepositoryWorkspace ? { view: "history" } : {})
  });
  for (const [name, element] of [
    ["VBtn", "button"], ["VChip", "span"], ["VIcon", "span"], ["VSheet", "section"],
    ["VAlert", "aside"], ["VCard", "article"], ["VCardTitle", "header"], ["VCardText", "div"],
    ["VDialog", "dialog"], ["VDivider", "hr"], ["VProgressLinear", "progress"],
    ["VExpandTransition", "div"]
  ]) app.component(name, passthroughComponent(element));
  app.provide(Vue.ssrContextKey, { modules: new Set() });
  app.provide("jskit.realtime.runtime.client.socket", socket);
  const container = { children: [], props: {}, type: "root" };
  app.mount(container);
  return {
    container,
    dashboardContext,
    listeners,
    requests,
    socket,
    button: (label) => findNode(container, (node) => node.type === "button" && nodeText(node).includes(label)),
    renderedDiff: () => findNode(container, (node) => Boolean(node.props.innerHTML))?.props.innerHTML || "",
    async respond(index, payload) {
      requests[index].resolve(payload);
      // Drain the request -> composable -> immediate watcher chain before rendering.
      for (let step = 0; step < 10; step += 1) await Promise.resolve();
      await Vue.nextTick();
    },
    async close(pendingResponse = { ok: true }) {
      app.unmount();
      for (const request of requests) request.resolve(pendingResponse);
      await Promise.all(requests.map((request) => request.promise));
      resetHttpWebClientForTests();
    }
  };
}

const historyCommit = "a".repeat(40);
const historyVersion = {
  author: "History reader",
  commit: historyCommit,
  committedAt: "2026-09-06T01:00:00.000Z",
  message: "Latest saved fixture",
  shortCommit: "aaaaaaa"
};
const firstVersionFile = { added: 1, deleted: 0, path: "a.txt", status: "A" };
const secondVersionFile = { added: 1, deleted: 0, path: "b.txt", status: "A" };
const firstVersionDiff = {
  diff: "diff --git a/a.txt b/a.txt\n--- /dev/null\n+++ b/a.txt\n@@ -0,0 +1 @@\n+first file content\n",
  ok: true,
  path: "a.txt"
};
const repositoryRoutes = [
  {
    component: RepositoryPage,
    label: "History",
    path: "/api/app/sample/vibe64/repository/history?sessionId=history-session",
    payload: { historySnapshotCommit: historyCommit, ok: true, versions: [historyVersion] },
    subscriptions: 1
  },
  {
    component: ChangesPage,
    label: "Current Changes",
    path: "/api/app/sample/vibe64/sessions/history-session/changes",
    payload: { canonicalCommit: historyCommit, files: [], ok: true, totalCount: 0, unsaved: false },
    subscriptions: 2
  }
];

describe("Vibe64 Repository workspace", () => {
  it("requires a frozen history review on the ordinary Update and clears it on session changes", async () => {
    const requestUpdateWork = vi.fn().mockResolvedValue(false);
    const fixture = mountHistoryWorkspace({ context: { requestUpdateWork } });
    const review = { baseCommit: "b".repeat(40), canonicalCommit: historyCommit,
      sessionHead: "c".repeat(40), worktreeTree: "d".repeat(40), changedPaths: ["retained.txt"] };
    try {
      await fixture.respond(0, { historySnapshotCommit: historyCommit, ok: true, versions: [] });
      await fixture.respond(1, { canonicalCommit: historyCommit, ok: true, updateAvailable: true, historyReview: review });
      fixture.button("Review and reconcile session").props.onClick();
      await Vue.nextTick();
      expect(requestUpdateWork).not.toHaveBeenCalled();
      expect(nodeText(fixture.container)).toContain("retained.txt");
      fixture.button("Reconcile session").props.onClick();
      for (let step = 0; step < 10; step += 1) await Promise.resolve();
      await Vue.nextTick();
      expect(requestUpdateWork).toHaveBeenCalledExactlyOnceWith({ historyReview: review });
      expect(findNode(fixture.container, (node) => node.type === "dialog")).toBeNull();
      fixture.button("Review and reconcile session").props.onClick();
      await Vue.nextTick();
      fixture.dashboardContext.sessionId = "different-session";
      await Vue.nextTick();
      expect(findNode(fixture.container, (node) => node.type === "dialog")).toBeNull();
      expect(requestUpdateWork).toHaveBeenCalledTimes(1);
    } finally {
      await fixture.close();
    }
  });

  it.each(repositoryRoutes)("does not mount an initially inactive $label reader or listener", async ({ component }) => {
    const fixture = mountHistoryWorkspace({ component, context: { active: false } });
    try {
      await Vue.nextTick();
      expect(fixture.requests).toHaveLength(0);
      expect(fixture.socket.on).not.toHaveBeenCalled();
      expect(fixture.button("Check for updates")).toBeNull();
    } finally {
      await fixture.close();
    }
  });

  it.each(repositoryRoutes.flatMap((route) => [true, false].map((hasSession) => ({ ...route, hasSession }))))(
    "keeps $label mounted when activity is absent (session: $hasSession)",
    async ({ component, hasSession, payload, subscriptions }) => {
      const fixture = mountHistoryWorkspace({ component, context: hasSession ? {} : { sessionId: "" } });
      try {
        expect(fixture.dashboardContext).not.toHaveProperty("active");
        expect(fixture.button("Check for updates")).not.toBeNull();
        expect(fixture.requests).toHaveLength(hasSession ? 1 : 0);
        expect(fixture.socket.on).toHaveBeenCalledTimes(hasSession ? subscriptions : 0);
        if (hasSession) {
          await fixture.respond(0, payload);
          await fixture.respond(1, { canonicalCommit: historyCommit, ok: true });
          expect(fixture.requests).toHaveLength(2);
        } else {
          expect(fixture.button("Check for updates").props.disabled).toBe(true);
        }
      } finally {
        await fixture.close();
      }
    }
  );

  it.each(repositoryRoutes)("retires hidden $label work and refreshes once on return", async ({ component, label, path, payload, subscriptions }) => {
    const fixture = mountHistoryWorkspace({ component, context: { active: true } });
    try {
      expect(fixture.requests[0].path).toBe(path);
      await fixture.respond(0, payload);
      await fixture.respond(1, { canonicalCommit: historyCommit, ok: true });
      expect(fixture.socket.on).toHaveBeenCalledTimes(subscriptions);
      for (const listener of fixture.listeners.get(VIBE64_SESSION_CHANGED_EVENT)) {
        listener({ reason: "session-save-completed", sessionId: "another-session" });
      }
      expect(fixture.requests).toHaveLength(2);

      if (label === "History") {
        fixture.button(historyVersion.message).props.onClick();
      } else {
        for (const listener of fixture.listeners.get(VIBE64_SOURCE_EDITOR_FILE_CHANGED_EVENT)) {
          listener({ path: "a.txt", sessionId: "history-session" });
        }
      }
      await Vue.nextTick();
      expect(fixture.requests).toHaveLength(3);
      expect(fixture.requests[2].path).toBe(label === "History"
        ? `/api/app/sample/vibe64/repository/history/${historyCommit}/files?sessionId=history-session&historySnapshotCommit=${historyCommit}`
        : path);

      fixture.dashboardContext.active = false;
      await Vue.nextTick();
      expect(fixture.socket.off).toHaveBeenCalledTimes(subscriptions);
      expect(fixture.button("Check for updates")).toBeNull();
      for (const [event, eventPayload] of [
        [VIBE64_SESSION_CHANGED_EVENT, { reason: "session-save-completed", sessionId: "history-session" }],
        [VIBE64_SESSION_CHANGED_EVENT, { reason: "repository-canonical-changed", sessionId: "history-session" }],
        [VIBE64_SOURCE_EDITOR_FILE_CHANGED_EVENT, { path: "a.txt", sessionId: "history-session" }]
      ]) {
        for (const listener of fixture.listeners.get(event) || []) listener(eventPayload);
      }
      await fixture.respond(2, {
        canonicalCommit: historyCommit, files: [firstVersionFile], ok: true,
        totalCount: 1, truncated: false, unsaved: true
      });
      expect(fixture.requests).toHaveLength(3);
      expect(findNode(fixture.container, (node) => node.type === "dialog")).toBeNull();

      fixture.dashboardContext.active = true;
      await Vue.nextTick();
      expect(fixture.requests).toHaveLength(4);
      expect(fixture.requests[3].path).toBe(path);
      expect(fixture.socket.on).toHaveBeenCalledTimes(subscriptions * 2);
      await fixture.respond(3, payload);
      await fixture.respond(4, { canonicalCommit: historyCommit, ok: true });
      expect(fixture.requests).toHaveLength(5);
      expect(fixture.button("Check for updates")).not.toBeNull();
      expect(findNode(fixture.container, (node) => node.type === "dialog")).toBeNull();
      expect(fixture.button("a.txt")).toBeNull();
    } finally {
      await fixture.close();
    }
    expect(fixture.socket.off).toHaveBeenCalledTimes(subscriptions * 2);
    expect([...fixture.listeners.values()].every((listeners) => listeners.size === 0)).toBe(true);
  });

  it.each(["header", "modal"])("retires pending version files on %s dismissal without starting a hidden diff", async (dismissal) => {
    const fixture = mountHistoryWorkspace();
    try {
      await fixture.respond(0, { historySnapshotCommit: historyCommit, ok: true, versions: [historyVersion] });
      await fixture.respond(1, { canonicalCommit: historyCommit, ok: true });
      fixture.button(historyVersion.message).props.onClick();
      await Vue.nextTick();
      expect(fixture.requests[2].path).toContain(`/history/${historyCommit}/files`);
      const dialog = findNode(fixture.container, (node) => node.type === "dialog");
      expect(dialog).not.toBeNull();
      if (dismissal === "header") {
        findNode(dialog, (node) => node.props["aria-label"] === "Close version details").props.onClick();
      } else {
        // Vuetify reports Escape/back/outside dismissal through this model event.
        for (const handler of [dialog.props["onUpdate:modelValue"]].flat()) handler(false);
      }
      await Vue.nextTick();
      expect(findNode(fixture.container, (node) => node.type === "dialog")).toBeNull();
      await fixture.respond(2, { files: [firstVersionFile], ok: true, totalCount: 1, truncated: false });
      expect(fixture.requests).toHaveLength(3);
      expect(findNode(fixture.container, (node) => node.type === "dialog")).toBeNull();
      expect(fixture.button(historyVersion.message)).not.toBeNull();
    } finally {
      await fixture.close();
    }
  });

  it.each(["success", "failure"])("preserves reopened version B when dismissed A's files settle with %s", async (outcome) => {
    const fixture = mountHistoryWorkspace();
    const secondVersion = { ...historyVersion, commit: "b".repeat(40), message: "Reopened version B" };
    try {
      await fixture.respond(0, {
        historySnapshotCommit: historyCommit, ok: true, versions: [historyVersion, secondVersion]
      });
      await fixture.respond(1, { canonicalCommit: historyCommit, ok: true });
      fixture.button(historyVersion.message).props.onClick();
      await Vue.nextTick();
      findNode(fixture.container, (node) => node.props["aria-label"] === "Close version details").props.onClick();
      await Vue.nextTick();
      fixture.button(secondVersion.message).props.onClick();
      await Vue.nextTick();
      expect(fixture.requests[3].path).toContain(`/history/${secondVersion.commit}/files`);
      await fixture.respond(2, outcome === "success"
        ? { files: [firstVersionFile], ok: true, totalCount: 1, truncated: false }
        : { error: "Dismissed version A failed.", ok: false });
      expect(fixture.requests).toHaveLength(4);
      const dialog = findNode(fixture.container, (node) => node.type === "dialog");
      expect(nodeText(dialog)).toContain(secondVersion.message);
      expect(nodeText(dialog)).not.toContain("Dismissed version A failed.");
      expect(fixture.button("a.txt")).toBeNull();
      expect(findNode(dialog, (node) => node.type === "progress")).not.toBeNull();
      await fixture.respond(3, { files: [secondVersionFile], ok: true, totalCount: 1, truncated: false });
      expect(new URL(fixture.requests[4].path, "http://vibe64.test").searchParams.get("path")).toBe("b.txt");
      await fixture.respond(4, {
        diff: "diff --git a/b.txt b/b.txt\n--- /dev/null\n+++ b/b.txt\n@@ -0,0 +1 @@\n+reopened version B content\n",
        ok: true,
        path: "b.txt"
      });
      expect(fixture.button("b.txt").props["aria-current"]).toBe("true");
      expect(fixture.renderedDiff()).toContain("reopened version B content");
      expect(fixture.requests).toHaveLength(5);
    } finally {
      await fixture.close();
    }
  });

  it("does not start a version diff when pending files arrive after unmount", async () => {
    const fixture = mountHistoryWorkspace();
    try {
      await fixture.respond(0, { historySnapshotCommit: historyCommit, ok: true, versions: [historyVersion] });
      await fixture.respond(1, { canonicalCommit: historyCommit, ok: true });
      fixture.button(historyVersion.message).props.onClick();
      expect(fixture.requests).toHaveLength(3);
    } finally {
      await fixture.close({ files: [firstVersionFile], ok: true, totalCount: 1, truncated: false });
    }
    expect(fixture.requests).toHaveLength(3);
    expect(findNode(fixture.container, (node) => node.type === "dialog")).toBeNull();
  });

  it("offers an explicit pending-aware retry after the first history request fails", async () => {
    const fixture = mountHistoryWorkspace();
    try {
      await fixture.respond(0, { error: "Initial history failed.", ok: false });
      // Keep authority-check recovery separate from the explicit History retry.
      await fixture.respond(1, { error: "Authority check unavailable.", ok: false });
      expect(nodeText(fixture.container)).toContain("Initial history failed.");
      expect(nodeText(fixture.container)).not.toContain("No saved versions yet");
      const retry = fixture.button("Retry history");
      expect(retry).not.toBeNull();
      expect(retry.props.disabled).toBe(false);
      retry.props.onClick();
      await Vue.nextTick();
      expect(fixture.button("Retrying…").props.disabled).toBe(true);
      expect(fixture.button("Retrying…").props["aria-busy"]).toBe("true");
      expect(fixture.requests[2].path).toBe(fixture.requests[0].path);
      await fixture.respond(2, { historySnapshotCommit: historyCommit, ok: true, versions: [historyVersion] });
      expect(fixture.button(historyVersion.message)).not.toBeNull();
      expect(nodeText(fixture.container)).not.toContain("Initial history failed.");
      expect(fixture.button("Retry history")).toBeNull();
      expect(fixture.requests).toHaveLength(3);
    } finally {
      await fixture.close();
    }
  });

  it("offers an explicit pending-aware retry after the first version file list fails", async () => {
    const fixture = mountHistoryWorkspace();
    try {
      await fixture.respond(0, { historySnapshotCommit: historyCommit, ok: true, versions: [historyVersion] });
      await fixture.respond(1, { canonicalCommit: historyCommit, ok: true });
      fixture.button(historyVersion.message).props.onClick();
      await fixture.respond(2, { error: "Initial version files failed.", ok: false });
      expect(nodeText(fixture.container)).toContain("Initial version files failed.");
      expect(nodeText(fixture.container)).not.toContain("Choose a changed file");
      const retry = fixture.button("Retry files");
      expect(retry).not.toBeNull();
      expect(retry.props.disabled).toBe(false);
      retry.props.onClick();
      await Vue.nextTick();
      expect(fixture.button("Retrying…").props.disabled).toBe(true);
      expect(fixture.button("Retrying…").props["aria-busy"]).toBe("true");
      expect(fixture.requests[3].path).toBe(fixture.requests[2].path);
      await fixture.respond(3, { files: [firstVersionFile], ok: true, totalCount: 1, truncated: false });
      expect(fixture.button("a.txt")).not.toBeNull();
      await fixture.respond(4, firstVersionDiff);
      expect(fixture.renderedDiff()).toContain("first file content");
      expect(nodeText(fixture.container)).not.toContain("Initial version files failed.");
      expect(fixture.button("Retry files")).toBeNull();
      expect(fixture.requests).toHaveLength(5);
    } finally {
      await fixture.close();
    }
  });

  it("keeps loaded versions and a same-cursor retry after an older-history page fails", async () => {
    const fixture = mountHistoryWorkspace();
    try {
      await fixture.respond(0, {
        historySnapshotCommit: historyCommit,
        nextCursor: "pinned-older-page",
        ok: true,
        versions: [historyVersion]
      });
      await fixture.respond(1, { canonicalCommit: historyCommit, ok: true });
      expect(fixture.button(historyVersion.message)).not.toBeNull();
      fixture.button("Load older versions").props.onClick();
      const pageUrl = new URL(fixture.requests[2].path, "http://vibe64.test");
      expect(Object.fromEntries(pageUrl.searchParams)).toEqual({
        cursor: "pinned-older-page", sessionId: "history-session"
      });
      await fixture.respond(2, { error: "Older history page failed.", ok: false });

      expect(nodeText(fixture.container)).toContain("Older history page failed.");
      expect(fixture.button(historyVersion.message)).not.toBeNull();
      const retry = fixture.button("Load older versions");
      expect(retry).not.toBeNull();
      expect(retry.props.disabled).toBe(false);
      retry.props.onClick();
      expect(fixture.requests[3].path).toBe(fixture.requests[2].path);
      await fixture.respond(3, {
        historySnapshotCommit: historyCommit,
        nextCursor: "",
        ok: true,
        versions: [{ ...historyVersion, commit: "b".repeat(40), message: "Older saved fixture" }]
      });
      expect(fixture.button(historyVersion.message)).not.toBeNull();
      expect(fixture.button("Older saved fixture")).not.toBeNull();
      expect(nodeText(fixture.container)).not.toContain("Older history page failed.");
      expect(fixture.button("Load older versions")).toBeNull();
      expect(fixture.requests).toHaveLength(4);
    } finally {
      await fixture.close();
    }
  });

  it("keeps version files and their diff with a same-offset retry after a file page fails", async () => {
    const fixture = mountHistoryWorkspace();
    try {
      await fixture.respond(0, { historySnapshotCommit: historyCommit, ok: true, versions: [historyVersion] });
      await fixture.respond(1, { canonicalCommit: historyCommit, ok: true });
      fixture.button(historyVersion.message).props.onClick();
      await fixture.respond(2, { files: [firstVersionFile], ok: true, totalCount: 2, truncated: true });
      await fixture.respond(3, firstVersionDiff);
      expect(fixture.button("a.txt")).not.toBeNull();
      expect(fixture.renderedDiff()).toContain("first file content");
      fixture.button("Load more files").props.onClick();
      const pageUrl = new URL(fixture.requests[4].path, "http://vibe64.test");
      expect(pageUrl.pathname).toBe(`/api/app/sample/vibe64/repository/history/${historyCommit}/files`);
      expect(Object.fromEntries(pageUrl.searchParams)).toEqual({
        historySnapshotCommit: historyCommit, offset: "1", sessionId: "history-session"
      });
      await fixture.respond(4, { error: "Version file page failed.", ok: false });

      expect(nodeText(fixture.container)).toContain("Version file page failed.");
      expect(fixture.button("a.txt")).not.toBeNull();
      expect(fixture.renderedDiff()).toContain("first file content");
      const retry = fixture.button("Load more files");
      expect(retry).not.toBeNull();
      expect(retry.props.disabled).toBe(false);
      retry.props.onClick();
      expect(fixture.requests[5].path).toBe(fixture.requests[4].path);
      await fixture.respond(5, { files: [secondVersionFile], ok: true, totalCount: 2, truncated: false });
      expect(fixture.button("a.txt")).not.toBeNull();
      expect(fixture.button("b.txt")).not.toBeNull();
      expect(fixture.renderedDiff()).toContain("first file content");
      expect(nodeText(fixture.container)).not.toContain("Version file page failed.");
      expect(fixture.button("Load more files")).toBeNull();
      expect(fixture.requests).toHaveLength(6);
    } finally {
      await fixture.close();
    }
  });

  it("keeps loaded version files selectable while the initial diff is pending", async () => {
    const fixture = mountHistoryWorkspace();
    try {
      await fixture.respond(0, { historySnapshotCommit: historyCommit, ok: true, versions: [historyVersion] });
      await fixture.respond(1, { canonicalCommit: historyCommit, ok: true });
      fixture.button(historyVersion.message).props.onClick();
      await fixture.respond(2, {
        files: [firstVersionFile, secondVersionFile], ok: true, totalCount: 2, truncated: false
      });
      expect(new URL(fixture.requests[3].path, "http://vibe64.test").searchParams.get("path")).toBe("a.txt");
      expect(fixture.button("a.txt")).not.toBeNull();
      const secondFile = fixture.button("b.txt");
      expect(secondFile).not.toBeNull();
      expect(secondFile.props.disabled).not.toBe(true);
      secondFile.props.onClick();
      const secondDiffUrl = new URL(fixture.requests[4].path, "http://vibe64.test");
      expect(Object.fromEntries(secondDiffUrl.searchParams)).toEqual({
        historySnapshotCommit: historyCommit, path: "b.txt", sessionId: "history-session"
      });
      await fixture.respond(4, {
        diff: "diff --git a/b.txt b/b.txt\n--- /dev/null\n+++ b/b.txt\n@@ -0,0 +1 @@\n+second file content\n",
        ok: true,
        path: "b.txt"
      });
      expect(fixture.button("b.txt").props["aria-current"]).toBe("true");
      expect(fixture.renderedDiff()).toContain("second file content");
      await fixture.respond(3, firstVersionDiff);
      expect(fixture.button("b.txt").props["aria-current"]).toBe("true");
      expect(fixture.renderedDiff()).toContain("second file content");
      expect(fixture.renderedDiff()).not.toContain("first file content");
      expect(fixture.requests).toHaveLength(5);
    } finally {
      await fixture.close();
    }
  });

  it("renders hostile Git patch text as text instead of executable markup", () => {
    const patch = [
      "diff --git a/evil.txt b/evil.txt",
      "index 1111111..2222222 100644",
      "--- a/evil.txt",
      "+++ b/evil.txt",
      "@@ -1 +1 @@",
      "-safe",
      "+<script>globalThis.pwned=true</script>",
      ""
    ].join("\n");
    const rendered = renderDiffHtml(patch, { drawFileList: false });

    expect(rendered).not.toContain("<script>");
    expect(rendered).toContain("&lt;script&gt;");
  });

  it("owns separate session routes for Current changes and Repository history", async () => {
    const [placement, changesPage, repositoryPage, toolDefinitions, autopilotView] = await Promise.all([
      source("src/placement.js"),
      source("src/pages/app/project/[slug]/dashboard/changes/index.vue"),
      source("src/pages/app/project/[slug]/dashboard/repository/index.vue"),
      source("src/lib/vibe64SessionToolDefinitions.js"),
      source("src/components/studio/vibe64-session/Vibe64AutopilotView.vue")
    ]);
    const production = [placement, changesPage, repositoryPage, toolDefinitions, autopilotView].join("\n");

    expect(production.match(/label:\s*"Repository"/gu)).toHaveLength(1);
    expect(production.match(/label:\s*"Current changes"/gu)).toHaveLength(1);
    expect(changesPage).toContain('view="changes"');
    expect(repositoryPage).toContain("Vibe64RepositoryWorkspace");
    expect(repositoryPage).toContain('view="history"');
    expect(production).not.toMatch(/dashboard\/diff|Vibe64SessionDiff|useVibe64DiffDialog/u);
  });

  it("exposes repository conflict recovery only through the existing Temporary AI workspace", async () => {
    const [repositoryWorkspace, autopilotView] = await Promise.all([
      source("src/components/studio/repository/Vibe64RepositoryWorkspace.vue"),
      source("src/components/studio/vibe64-session/Vibe64AutopilotView.vue")
    ]);

    expect(repositoryWorkspace).toContain("Vibe64TemporaryAiFixAction");
    expect(repositoryWorkspace).toContain(':disabled="resolvingUpdateProblem || dashboard.assistantCodeAllowed === false"');
    expect(repositoryWorkspace).toContain("dashboard.assistantCodeRestrictionMessage");
    expect(repositoryWorkspace).not.toMatch(/resolve conflict manually|accept incoming|accept current/iu);
    expect(autopilotView).toContain("requestTemporaryAi: fixRepositoryError");
    expect(autopilotView).toContain("workspace.startTask(options)");
    expect(autopilotView).toContain('emit("chat-attention")');
  });

  it("uses Code for AI repair without restricting native Save and Update", async () => {
    const [repositoryWorkspace, repositoryComposable] = await Promise.all([
      source("src/components/studio/repository/Vibe64RepositoryWorkspace.vue"),
      source("src/composables/useVibe64RepositoryWorkspace.js")
    ]);

    expect(repositoryWorkspace).toContain("dashboard.value.assistantCodeAllowed === false");
    expect(repositoryWorkspace).toContain("dashboard.assistantCodeRestrictionMessage");
    expect(repositoryComposable).not.toContain("assistantDirectAllowed");
    expect(repositoryWorkspace).toContain(':disabled="repositoryOperationBusy"');
    expect(repositoryWorkspace).not.toContain('assistantDirectAllowed === false || repositoryOperationBusy');
  });

  it("renders current changes and version history as separate session destinations", async () => {
    const repositoryWorkspace = await source(
      "src/components/studio/repository/Vibe64RepositoryWorkspace.vue"
    );

    expect(repositoryWorkspace).toContain("view === 'changes'");
    expect(repositoryWorkspace).toContain("view === 'history'");
    expect(repositoryWorkspace).not.toContain("<v-tabs");
    expect(repositoryWorkspace).not.toContain('<slot name="settings"');
    expect(repositoryWorkspace).not.toContain('<slot name="access"');
    expect(repositoryWorkspace).not.toContain('value="settings"');
    expect(repositoryWorkspace).not.toContain('value="access"');
  });

  it("states the exact saved update count instead of relying on an enabled action", async () => {
    const [repositoryWorkspace, repositoryComposable] = await Promise.all([
      source("src/components/studio/repository/Vibe64RepositoryWorkspace.vue"),
      source("src/composables/useVibe64RepositoryWorkspace.js")
    ]);

    expect(repositoryWorkspace).toContain("repositoryUpdateTitle");
    expect(repositoryWorkspace).toContain('behind === 1 ? "update" : "updates"');
    expect(repositoryWorkspace).toContain("saved ${behind === 1 ? \"version\" : \"versions\"} behind");
    expect(repositoryWorkspace).toContain("This session and the saved project have both changed");
    expect(repositoryWorkspace).toContain("Someone saved new project work after this session started");
    expect(repositoryWorkspace).toContain("Saved versions this session needs");
    expect(repositoryWorkspace).toContain("repositoryIncomingVersions");
    expect(repositoryWorkspace.match(/Update this session \(rebase\)/gu)).toHaveLength(7);
    expect(repositoryWorkspace).toContain("replay its unsaved work on the latest saved version");
    expect(repositoryWorkspace).toContain("will move it to the latest saved version");
    expect(repositoryWorkspace).toContain('changes.payload?.unsaved === true');
    expect(repositoryWorkspace).not.toContain("Your current work is preserved when you update");
    expect(repositoryWorkspace).toContain("Last checked");
    expect(repositoryComposable).toContain("result.updateCheck");
    expect(repositoryComposable).toContain("cached: true");
    expect(repositoryWorkspace).toContain('aria-live="polite"');
    expect(repositoryWorkspace).toContain('role="status"');
    expect(repositoryWorkspace.match(/Check for updates/gu)).toHaveLength(3);
    expect(repositoryWorkspace).not.toContain(">\n          Refresh\n");
    expect(repositoryWorkspace).not.toContain("mdiRefresh");
  });

  it("renders saved versions as an accessible Git log and opens details in a full-screen dialog", async () => {
    const [repositoryWorkspace, repositoryComposable] = await Promise.all([
      source("src/components/studio/repository/Vibe64RepositoryWorkspace.vue"),
      source("src/composables/useVibe64RepositoryWorkspace.js")
    ]);

    expect(repositoryWorkspace).toContain("Saved versions");
    expect(repositoryWorkspace).toContain("vibe64-repository-workspace__commit-marker");
    expect(repositoryWorkspace).toContain("version.isMerge ? mdiSourceMerge : mdiSourceCommit");
    expect(repositoryWorkspace).toContain("Latest");
    expect(repositoryWorkspace).toContain(":aria-label=\"versionButtonLabel(version, index)\"");
    expect(repositoryWorkspace).toContain("@click=\"openVersion(version)\"");
    expect(repositoryWorkspace).toContain("dialog-bottom-transition");
    expect(repositoryWorkspace).toContain("Close version details");
    expect(repositoryWorkspace).toContain("fullscreen");
    expect(repositoryWorkspace).not.toContain("location=\"right\"");
    expect(repositoryWorkspace).not.toContain("max-width=\"70rem\"");
    expect(repositoryWorkspace).toContain("versionFileCountLabel");
    expect(repositoryWorkspace).toContain("vibe64-repository-version-dialog__eyebrow");
    expect(repositoryWorkspace).not.toContain("vibe64-repository-workspace__version-detail");
    expect(repositoryComposable).not.toContain("await selectVersion(history.versions[0])");
  });

  it("uses the available width for file lists and their selected difference", async () => {
    const [repositoryWorkspace, fileBrowser] = await Promise.all([
      source("src/components/studio/repository/Vibe64RepositoryWorkspace.vue"),
      source("src/components/studio/repository/Vibe64RepositoryFileBrowser.vue")
    ]);

    expect(repositoryWorkspace.match(/<Vibe64RepositoryFileBrowser/gu)).toHaveLength(2);
    expect(fileBrowser).toMatch(
      /\.vibe64-repository-file-browser \{[\s\S]*?grid-template-columns: minmax\(16rem, 21rem\) minmax\(0, 1fr\);/u
    );
    expect(fileBrowser).toContain("vibe64-repository-file-browser--embedded");
    expect(repositoryWorkspace).toContain("width: 100vw;");
    expect(repositoryWorkspace).toContain("height: 100dvh;");
    expect(fileBrowser).toContain("height: 100%;");
  });

  it("uses one file-browser implementation for current and historical changes", async () => {
    const [repositoryWorkspace, repositoryComposable, fileBrowser] = await Promise.all([
      source("src/components/studio/repository/Vibe64RepositoryWorkspace.vue"),
      source("src/composables/useVibe64RepositoryWorkspace.js"),
      source("src/components/studio/repository/Vibe64RepositoryFileBrowser.vue")
    ]);

    expect(repositoryWorkspace.match(/<Vibe64RepositoryFileBrowser/gu)).toHaveLength(2);
    expect(repositoryWorkspace).not.toContain("repositoryFileStatusLabel");
    expect(repositoryComposable).not.toContain("repositoryFileStatusLabel");
    expect(fileBrowser.match(/function fileStatusLabel/gu)).toHaveLength(1);
  });

  it("does not describe a clean but outdated session as matching the saved project", async () => {
    const [repositoryWorkspace, repositoryComposable, autopilotView, runtimeHost] = await Promise.all([
      source("src/components/studio/repository/Vibe64RepositoryWorkspace.vue"),
      source("src/composables/useVibe64RepositoryWorkspace.js"),
      source("src/composables/useVibe64AutopilotView.js"),
      source("src/components/studio/vibe64-session/Vibe64SessionRuntimeHost.vue")
    ]);

    expect(repositoryWorkspace).toContain("No unsaved file changes");
    expect(repositoryWorkspace).toContain("no file changes waiting to be saved");
    expect(repositoryWorkspace).not.toContain("This session matches the project’s saved version");
    expect(repositoryComposable).toContain('typeof context.value.refreshSessionWork === "function"');
    expect(repositoryComposable).toContain("delete observedWork.initialDiff");
    expect(repositoryComposable).toContain("await context.value.refreshSessionWork(observedWork)");
    expect(autopilotView).toContain("refreshSessionWork: props.refreshSessionWork");
    expect(runtimeHost).toContain(':refresh-session-work="refreshWorkState"');
  });

  it("uses mutually exclusive full-width panes on mobile", async () => {
    const autopilotView = await source(
      "src/components/studio/vibe64-session/Vibe64AutopilotView.vue"
    );

    expect(autopilotView).toContain("@media (max-width: 980px)");
    expect(autopilotView).toMatch(
      /\.studio-autopilot:not\(\.studio-autopilot--chat-collapsed\) \{\s*grid-template-columns: minmax\(0, 1fr\) 0;/u
    );
    expect(autopilotView).toMatch(
      /\.studio-autopilot:not\(\.studio-autopilot--chat-collapsed\) \.studio-autopilot__project-panel \{\s*visibility: hidden;/u
    );
  });
});
