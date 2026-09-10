import { readFileSync } from "node:fs";
import { compile } from "@vue/compiler-dom";
import { compileScript, parse } from "@vue/compiler-sfc";
import * as Vue from "vue";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ database: null }));

vi.mock("../../packages/vibe64-database-tools/src/client/composables/useVibe64DatabaseTools.js", () => ({
  useVibe64DatabaseTools: () => mocks.database
}));
vi.mock("../../packages/vibe64-database-tools/src/client/components/DatabaseErd.vue", () => ({
  default: { render: () => null }
}));
vi.mock("../../packages/vibe64-database-tools/src/client/components/DatabaseOverview.vue", () => ({
  default: { render: () => null }
}));
vi.mock("../../packages/vibe64-database-tools/src/client/components/DatabaseSqlEditor.vue", () => ({
  default: {
    props: { modelValue: { type: String, required: true } },
    emits: ["update:modelValue"],
    setup(props, { emit }) {
      return () => Vue.h("textarea", {
        "data-sql-editor": true,
        value: props.modelValue,
        onInput: (event) => emit("update:modelValue", event.target.value)
      });
    }
  }
}));
vi.mock("vuetify/components/VBtn", () => ({ VBtn: passthroughComponent("button") }));
vi.mock("vuetify/components/VBtnToggle", () => ({ VBtnToggle: passthroughComponent("div") }));
vi.mock("vuetify/components/VIcon", () => ({ VIcon: passthroughComponent("span") }));
vi.mock("vuetify/components/VChip", () => ({ VChip: passthroughComponent("span") }));
vi.mock("vuetify/components/VTextField", () => ({ VTextField: passthroughComponent("input") }));
vi.mock("vuetify/components/VTextarea", () => ({ VTextarea: passthroughComponent("textarea") }));
vi.mock("vuetify/components/VSelect", () => ({ VSelect: passthroughComponent("select") }));
vi.mock("vuetify/components/VAutocomplete", () => ({ VAutocomplete: passthroughComponent("input") }));
vi.mock("vuetify/components/VCheckbox", () => ({ VCheckbox: passthroughComponent("input") }));
vi.mock("vuetify/components/VSkeletonLoader", () => ({ VSkeletonLoader: passthroughComponent("div") }));
vi.mock("vuetify/components/VAlert", () => ({ VAlert: passthroughComponent("aside") }));
vi.mock("vuetify/components/VGrid", () => ({ VSpacer: passthroughComponent("span") }));
vi.mock("vuetify/components/VDialog", () => ({ VDialog: passthroughComponent("dialog") }));
vi.mock("vuetify/components/VCard", () => ({
  VCard: passthroughComponent("article"), VCardTitle: passthroughComponent("header"),
  VCardText: passthroughComponent("div"), VCardActions: passthroughComponent("footer")
}));

import Vibe64DatabaseWorkspace from "../../packages/vibe64-database-tools/src/client/components/Vibe64DatabaseWorkspace.vue";

// Real component setup/template; database operations and heavyweight presentation stay at test boundaries.
const filename = new URL(
  "../../packages/vibe64-database-tools/src/client/components/Vibe64DatabaseWorkspace.vue", import.meta.url
).pathname;
const { descriptor } = parse(readFileSync(filename, "utf8"), { filename });
const script = compileScript(descriptor, { id: "database-workspace-test" });
Vibe64DatabaseWorkspace.render = new Function("Vue", compile(descriptor.template.content, {
  bindingMetadata: script.bindings, mode: "function", prefixIdentifiers: true
}).code)(Vue);

function passthroughComponent(element) {
  return Vue.defineComponent({
    inheritAttrs: false,
    props: element === "dialog" ? { modelValue: Boolean } : {},
    setup(props, { attrs, slots }) {
      return () => element === "dialog" && !props.modelValue
        ? null
        : Vue.h(element, attrs, Object.values(slots).flatMap((slot) => slot()));
    }
  });
}

function findNode(node, predicate) {
  if (predicate(node)) return node;
  for (const child of node.children || []) {
    const match = findNode(child, predicate);
    if (match) return match;
  }
  return null;
}

async function flushWorkspace(runQuery) {
  await Vue.nextTick();
  await Promise.all(runQuery.mock.results.map((result) => result.value));
  await Vue.nextTick();
}

function mountDatabaseWorkspace({ active = true, initialState = null, saveLayout = vi.fn(), view = "data" } = {}) {
  const props = Vue.reactive({ active, sessionId: "database-session" });
  const state = Vue.ref(initialState);
  const runQuery = vi.fn(async () => ({
    kind: "result-set", columns: [{ index: 0, label: "value", databaseType: "text" }],
    rows: [["kept row"]]
  }));
  mocks.database = {
    state, runQuery, saveLayout, running: Vue.ref(false), loading: Vue.ref(false), error: Vue.ref(""),
    reload: vi.fn(async () => null)
  };
  const renderer = Vue.createRenderer({
    createElement: (type) => ({ type, children: [], props: {}, style: {}, parent: null }),
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
      const index = child.parent?.children.indexOf(child) ?? -1;
      if (index >= 0) child.parent.children.splice(index, 1);
    },
    parentNode: (node) => node.parent,
    nextSibling: (node) => node.parent?.children[node.parent.children.indexOf(node) + 1] || null,
    patchProp: (node, key, _previous, value) => { node.props[key] = value; },
    setElementText(node, text) { node.children = []; node.text = text; },
    setText: (node, text) => { node.text = text; }
  });
  const app = renderer.createApp({
    setup: () => () => Vue.h(Vibe64DatabaseWorkspace, props)
  });
  for (const [name, element] of [
    ["VBtn", "button"], ["VBtnToggle", "div"], ["VIcon", "span"], ["VChip", "span"],
    ["VTextField", "input"], ["VTextarea", "textarea"], ["VSelect", "select"],
    ["VAutocomplete", "input"], ["VCheckbox", "input"], ["VSkeletonLoader", "div"],
    ["VAlert", "aside"], ["VSpacer", "span"], ["VDialog", "dialog"],
    ["VCard", "article"], ["VCardTitle", "header"], ["VCardText", "div"], ["VCardActions", "footer"]
  ]) app.component(name, passthroughComponent(element));
  app.provide(Vue.ssrContextKey, { modules: new Set() });
  const container = { type: "root", children: [], props: {} };
  app.mount(container);
  app._instance.subTree.component.setupState.activeView = view;
  return {
    container, props, state, runQuery,
    workspace: app._instance.subTree.component.setupState,
    editor: () => findNode(container, (node) => node.props["data-sql-editor"] === true),
    async close() {
      app.unmount();
      await flushWorkspace(runQuery);
    }
  };
}

const firstTable = { schema: "public", name: "items", qualifiedName: "public.items", kind: "table", columns: [] };
const secondTable = { ...firstTable, name: "orders", qualifiedName: "public.orders" };
const firstState = {
  connection: { database: "audit_database" },
  schema: { engine: "postgresql", schemas: [{ name: "public" }], tables: [firstTable], relationships: [] },
  workspace: { history: [], snippets: [] }
};
const secondState = { ...firstState, schema: { ...firstState.schema, tables: [secondTable] } };

describe("Database Workspace automatic table admission", () => {
  it("opens Overview without querying records and only admits a query when Data is selected", async () => {
    const fixture = mountDatabaseWorkspace({ initialState: firstState, view: "overview" });
    try {
      await flushWorkspace(fixture.runQuery);
      expect(fixture.workspace.activeView).toBe("overview");
      expect(fixture.runQuery).not.toHaveBeenCalled();
      fixture.workspace.activeView = "erd";
      await flushWorkspace(fixture.runQuery);
      expect(fixture.runQuery).not.toHaveBeenCalled();
      fixture.workspace.activeView = "data";
      await flushWorkspace(fixture.runQuery);
      expect(fixture.runQuery).toHaveBeenCalledTimes(1);
      fixture.workspace.activeView = "overview";
      fixture.workspace.activeView = "data";
      await flushWorkspace(fixture.runQuery);
      expect(fixture.runQuery).toHaveBeenCalledTimes(1);
    } finally { await fixture.close(); }
  });

  it.each(["cached", "late"])("defers %s hidden schema until activation without requiring another state update", async (arrival) => {
    const fixture = mountDatabaseWorkspace({
      active: arrival === "late", initialState: arrival === "cached" ? firstState : null
    });
    try {
      if (arrival === "late") {
        fixture.props.active = false;
        await flushWorkspace(fixture.runQuery);
        fixture.state.value = firstState;
      }
      await flushWorkspace(fixture.runQuery);
      expect(fixture.runQuery).not.toHaveBeenCalled();
      expect(fixture.editor().props.value).toBe("");
      const retainedState = fixture.state.value;

      fixture.props.active = true;
      await flushWorkspace(fixture.runQuery);
      expect(fixture.state.value).toBe(retainedState);
      expect(fixture.runQuery).toHaveBeenCalledTimes(1);
      expect(fixture.runQuery).toHaveBeenCalledWith(expect.objectContaining({
        automatic: true, readOnly: true, confirmationDatabase: "audit_database",
        sql: 'SELECT *\nFROM "public"."items";'
      }));
      expect(fixture.editor().props.value).toBe('SELECT *\nFROM "public"."items";');
      fixture.props.active = false;
      await flushWorkspace(fixture.runQuery);
      fixture.props.active = true;
      await flushWorkspace(fixture.runQuery);
      expect(fixture.runQuery).toHaveBeenCalledTimes(1);
    } finally {
      await fixture.close();
    }
  });

  it("preserves a mounted SQL draft and result through hidden same-table refresh and return", async () => {
    const fixture = mountDatabaseWorkspace({ initialState: firstState });
    const draft = 'SELECT value FROM "public"."items" WHERE value IS NOT NULL;';
    try {
      await flushWorkspace(fixture.runQuery);
      expect(fixture.runQuery).toHaveBeenCalledTimes(1);
      const editor = fixture.editor();
      editor.props.onInput({ target: { value: draft } });
      await flushWorkspace(fixture.runQuery);
      fixture.props.active = false;
      await flushWorkspace(fixture.runQuery);
      fixture.state.value = { ...firstState, schema: { ...firstState.schema, refreshedAt: "2026-09-07T00:00:00Z" } };
      await flushWorkspace(fixture.runQuery);
      expect(fixture.editor()).toBe(editor);
      expect(editor.props.value).toBe(draft);
      fixture.props.active = true;
      await flushWorkspace(fixture.runQuery);
      expect(fixture.editor()).toBe(editor);
      expect(editor.props.value).toBe(draft);
      expect(findNode(fixture.container, (node) => node.text === "kept row")).not.toBeNull();
      expect(fixture.runQuery).toHaveBeenCalledTimes(1);
    } finally {
      await fixture.close();
    }
  });

  it("defers replacement of a removed selected table until the workspace is active", async () => {
    const fixture = mountDatabaseWorkspace({ initialState: firstState });
    try {
      await flushWorkspace(fixture.runQuery);
      expect(fixture.runQuery).toHaveBeenCalledTimes(1);
      fixture.props.active = false;
      await flushWorkspace(fixture.runQuery);
      fixture.state.value = secondState;
      await flushWorkspace(fixture.runQuery);
      expect(fixture.runQuery).toHaveBeenCalledTimes(1);
      expect(fixture.editor().props.value).toBe('SELECT *\nFROM "public"."items";');
      fixture.props.active = true;
      await flushWorkspace(fixture.runQuery);
      expect(fixture.runQuery).toHaveBeenCalledTimes(2);
      expect(fixture.runQuery).toHaveBeenLastCalledWith(expect.objectContaining({
        automatic: true, readOnly: true, sql: 'SELECT *\nFROM "public"."orders";'
      }));
      expect(fixture.editor().props.value).toBe('SELECT *\nFROM "public"."orders";');
    } finally {
      await fixture.close();
    }
  });

  it("does not admit a table query after component teardown", async () => {
    const fixture = mountDatabaseWorkspace();
    try {
      expect(fixture.runQuery).not.toHaveBeenCalled();
    } finally {
      await fixture.close();
    }
    fixture.state.value = firstState;
    fixture.props.active = false;
    await flushWorkspace(fixture.runQuery);
    fixture.props.active = true;
    await flushWorkspace(fixture.runQuery);
    expect(fixture.runQuery).not.toHaveBeenCalled();
  });
});

describe("Database Workspace shared ERD hydration", () => {
  const original = { nodes: [{ table: "public.items", x: 10, y: 20 }], revision: 1 };
  const remote = { nodes: [{ table: "public.items", x: 200, y: 300 }], revision: 2 };

  it("applies live layouts without rerunning SQL and catches up when reactivated", async () => {
    const fixture = mountDatabaseWorkspace({ initialState: { ...firstState, layout: original } });
    try {
      await flushWorkspace(fixture.runQuery);
      expect(fixture.workspace.erdLayout).toEqual(original);
      fixture.state.value = { ...firstState, layout: remote };
      await flushWorkspace(fixture.runQuery);
      expect(fixture.workspace.erdLayout).toEqual(remote);
      expect(fixture.runQuery).toHaveBeenCalledTimes(1);
      fixture.props.active = false;
      fixture.state.value = { ...firstState, layout: { ...remote, revision: 3 } };
      await flushWorkspace(fixture.runQuery);
      expect(fixture.workspace.erdLayout.revision).toBe(2);
      fixture.props.active = true;
      await flushWorkspace(fixture.runQuery);
      expect(fixture.workspace.erdLayout.revision).toBe(3);
    } finally {
      await fixture.close();
    }
  });

  it("defers remote hydration through a pending save and refuses an older refresh", async () => {
    let finish;
    const saveLayout = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const fixture = mountDatabaseWorkspace({ initialState: { ...firstState, layout: original }, saveLayout });
    try {
      await flushWorkspace(fixture.runQuery);
      const pending = fixture.workspace.saveDiagramLayout({ nodes: [{ table: "public.items", x: 400, y: 500 }] });
      await flushWorkspace(fixture.runQuery);
      fixture.state.value = { ...firstState, layout: { ...remote, revision: 4 } };
      await flushWorkspace(fixture.runQuery);
      expect(fixture.workspace.erdLayout.nodes[0].x).toBe(400);
      finish({ layout: { nodes: [{ table: "public.items", x: 400, y: 500 }], revision: 3 } });
      await pending;
      await flushWorkspace(fixture.runQuery);
      expect(fixture.workspace.erdLayout.revision).toBe(4);
      fixture.state.value = { ...firstState, layout: remote };
      await flushWorkspace(fixture.runQuery);
      expect(fixture.workspace.erdLayout.revision).toBe(4);
    } finally {
      await fixture.close();
    }
  });

  it("does not send queued layout writes after unmount", async () => {
    const saveLayout = vi.fn();
    const fixture = mountDatabaseWorkspace({ initialState: { ...firstState, layout: original }, saveLayout });
    await flushWorkspace(fixture.runQuery);
    const pending = fixture.workspace.saveDiagramLayout(remote);
    await fixture.close();
    await pending;
    expect(saveLayout).not.toHaveBeenCalled();
  });
});
