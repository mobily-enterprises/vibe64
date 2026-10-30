import { readFileSync } from "node:fs";
import { parse } from "@vue/compiler-sfc";
import { createRenderer, h, nextTick, reactive, ref, ssrContextKey } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/composables/useVibe64ProjectScope.js", () => ({ useVibe64ProjectSlug: () => ref("books") }));

const { default: RuntimeConfigRecordsTable } = await import("../../src/components/studio/RuntimeConfigRecordsTable.vue");

let app;
afterEach(() => {
  app?.unmount();
  app = null;
});

// Mounts the person's rows with live props, so a refresh can replace the
// records while the rows stay mounted, as the Env panel does after a save.
function mountRows(initialProps) {
  const node = () => ({});
  const renderer = createRenderer({ createComment: node, createElement: node, createText: node, setText() {}, setElementText() {},
    patchProp() {}, insert() {}, remove() {}, parentNode() {}, nextSibling() {} });
  const props = reactive({ environmentLabel: "development", saveBusy: false, showActions: true, ...initialProps });
  const Rows = { ...RuntimeConfigRecordsTable, render: () => null };
  app = renderer.createApp({ render: () => h(Rows, { ...props }) });
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount({});
  return { props, rows: app._instance.subTree.component.setupState };
}

// The row's Save and Remove bindings, evaluated for one record.
function buttons(rows, record) {
  return {
    remove: { disabled: rows.writeBusy && !rows.rowPending(record, "remove"), loading: rows.rowPending(record, "remove") },
    save: { disabled: !rows.draftTouched(record) || (rows.writeBusy && !rows.rowPending(record, "save")), loading: rows.rowPending(record, "save") }
  };
}

const API_URL = { editable: true, key: "API_URL", scope: "dev", source: "user", value: "https://old.example.test", valuePresent: true };
const SHOP_NAME = { editable: true, key: "SHOP_NAME", scope: "dev", source: "user", value: "Books", valuePresent: true };

describe("saving one Env row", () => {
  it("shows progress on that row alone, waits the others and keeps their drafts through the refresh", async () => {
    let finish;
    const onSaveRecord = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const { props, rows } = mountRows({ onSaveRecord, records: [API_URL, SHOP_NAME] });
    rows.setDraftValue(API_URL, "https://new.example.test");
    rows.setDraftValue(SHOP_NAME, "Books & more");
    expect(buttons(rows, SHOP_NAME).save).toEqual({ disabled: false, loading: false });

    const saving = rows.saveRecord(API_URL);
    await nextTick();
    expect(onSaveRecord).toHaveBeenCalledWith({ record: API_URL, value: "https://new.example.test" });
    expect(buttons(rows, API_URL)).toEqual({ remove: { disabled: true, loading: false }, save: { disabled: false, loading: true } });
    expect(buttons(rows, SHOP_NAME)).toEqual({ remove: { disabled: true, loading: false }, save: { disabled: true, loading: false } });
    expect(rows.draftValue(API_URL)).toBe("https://new.example.test");
    expect(await rows.saveRecord(SHOP_NAME)).toBe(false);
    expect(onSaveRecord).toHaveBeenCalledTimes(1);

    // Progress ends once the value is written; the row shows it until the
    // quiet refresh swaps in new records while the rows stay mounted.
    finish();
    expect(await saving).toBe(true);
    expect(buttons(rows, API_URL)).toEqual({ remove: { disabled: false, loading: false }, save: { disabled: true, loading: false } });
    expect(rows.draftTouched(API_URL)).toBe(false);
    expect(rows.recordValueLabel(API_URL)).toBe("https://new.example.test");
    expect(rows.draftValue(SHOP_NAME)).toBe("Books & more");
    expect(buttons(rows, SHOP_NAME).save).toEqual({ disabled: false, loading: false });

    props.records = [{ ...API_URL, value: "https://refreshed.example.test" }, { ...SHOP_NAME }];
    await nextTick();
    expect(rows.recordValueLabel(props.records[0])).toBe("https://refreshed.example.test", "the refreshed record replaces the saved value");
    expect(rows.draftValue(SHOP_NAME)).toBe("Books & more");
  });

  it("shows a saved secret as hidden until the refresh", async () => {
    const TOKEN = { editable: true, key: "API_TOKEN", scope: "dev", secret: true, source: "user", value: "", valuePresent: false };
    const { rows } = mountRows({ onSaveRecord: async () => {}, records: [TOKEN] });
    expect(rows.recordValueLabel(TOKEN)).toBe("");
    rows.setDraftValue(TOKEN, "sk-new");
    expect(await rows.saveRecord(TOKEN)).toBe(true);
    expect(rows.recordValueLabel(TOKEN)).toBe("********");
  });

  it("keeps the typed value and shows the failure inline on that row only", async () => {
    const onSaveRecord = vi.fn(async () => {
      throw new Error("API_URL must be a URL.");
    });
    const { rows } = mountRows({ onSaveRecord, records: [API_URL, SHOP_NAME] });
    rows.setDraftValue(API_URL, "not a url");

    expect(await rows.saveRecord(API_URL)).toBe(false);
    expect(rows.draftValue(API_URL)).toBe("not a url");
    expect(rows.rowError(API_URL)).toBe("API_URL must be a URL.");
    expect(rows.rowError(SHOP_NAME)).toBe("");
    expect(buttons(rows, API_URL).save).toEqual({ disabled: false, loading: false });
    rows.setDraftValue(API_URL, "https://fixed.example.test");
    expect(rows.rowError(API_URL)).toBe("");
  });

  it("keeps an edit typed while the save was in flight", async () => {
    let finish;
    const { rows } = mountRows({ onSaveRecord: () => new Promise((resolve) => { finish = resolve; }), records: [API_URL] });
    rows.setDraftValue(API_URL, "https://first.example.test");
    const saving = rows.saveRecord(API_URL);
    rows.setDraftValue(API_URL, "https://second.example.test");
    finish();
    expect(await saving).toBe(true);
    expect(rows.draftValue(API_URL)).toBe("https://second.example.test");
  });

  it("removes with progress and errors on that row alone, and another write only waits the rows", async () => {
    let fail;
    const onRemoveRecord = vi.fn(() => new Promise((_resolve, reject) => { fail = reject; }));
    const { props, rows } = mountRows({ onRemoveRecord, onSaveRecord: vi.fn(), records: [API_URL, SHOP_NAME] });
    rows.setDraftValue(API_URL, "https://draft.example.test");

    const removing = rows.removeRecord(SHOP_NAME);
    await nextTick();
    expect(onRemoveRecord).toHaveBeenCalledWith(SHOP_NAME);
    expect(buttons(rows, SHOP_NAME).remove).toEqual({ disabled: false, loading: true });
    expect(buttons(rows, API_URL)).toEqual({ remove: { disabled: true, loading: false }, save: { disabled: true, loading: false } });
    fail(new Error("SHOP_NAME could not be removed."));
    expect(await removing).toBe(false);
    expect(rows.rowError(SHOP_NAME)).toBe("SHOP_NAME could not be removed.");
    expect(rows.draftValue(API_URL)).toBe("https://draft.example.test");

    props.saveBusy = true;
    await nextTick();
    for (const record of [API_URL, SHOP_NAME]) {
      expect(buttons(rows, record).remove).toEqual({ disabled: true, loading: false });
      expect(buttons(rows, record).save.loading).toBe(false);
      expect(buttons(rows, record).save.disabled).toBe(true);
    }
  });

  it("binds each row's progress and inline error to that row, never to the panel-wide flag", () => {
    const source = readFileSync(new URL("../../src/components/studio/RuntimeConfigRecordsTable.vue", import.meta.url), "utf8");
    const markup = parse(source).descriptor.template.content;
    expect(markup).not.toContain('"saveBusy"');
    expect(markup).toMatch(/<v-text-field\s+:error-messages="rowError\(record\)"\s+:hide-details="!rowError\(record\)"/u);
    expect(markup).toMatch(/<v-btn\s+:disabled="!draftTouched\(record\) \|\| \(writeBusy && !rowPending\(record, 'save'\)\)"\s+:loading="rowPending\(record, 'save'\)"[\s\S]*?@click="saveRecord\(record\)"/u);
    expect(markup).toMatch(/<v-btn\s+:disabled="writeBusy && !rowPending\(record, 'remove'\)"\s+:loading="rowPending\(record, 'remove'\)"[\s\S]*?@click="removeRecord\(record\)"/u);
  });

  it("lays rows out by the table's own width, as cards when three columns do not fit", () => {
    const source = readFileSync(new URL("../../src/components/studio/RuntimeConfigRecordsTable.vue", import.meta.url), "utf8");
    const style = parse(source).descriptor.styles[0].content;
    expect(style).toContain("container: runtime-config-records / inline-size;");
    expect(style).toContain("@container runtime-config-records (max-width: 40rem) {");
    expect(style).toContain("@container runtime-config-records (max-width: 56rem) {");
    expect(style).not.toContain("@media");
    expect(style).not.toMatch(/min-width: 40rem/u);
  });

  it("refreshes the Env panel quietly: only the first load replaces the list", () => {
    const source = readFileSync(new URL("../../src/components/studio/EnvPanel.vue", import.meta.url), "utf8");
    const { descriptor } = parse(source);
    const markup = descriptor.template.content;
    const script = descriptor.scriptSetup.content;
    expect(markup).toContain('v-if="projectEnvTabActive && (envInitialLoading || envLoadError)"');
    expect(script).toContain("const envInitialLoading = computed(() => envResource.isInitialLoading.value === true);");
    expect(script).not.toContain("isLoading.value");
    expect(markup).toMatch(/:disabled="!newValue\.key \|\| \(saveBusy && !addBusy\)"\s+:loading="addBusy"/u);
    expect(markup).toMatch(/<v-btn\s+:loading="refreshBusy"\s+:prepend-icon="mdiRefresh"/u);
    expect(markup).toContain('@save-record="saveRecord"');
    expect(markup).toContain('@remove-record="requestRemoveRecord"');
  });
});
