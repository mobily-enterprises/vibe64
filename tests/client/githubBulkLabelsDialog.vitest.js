import { createRenderer, h, nextTick, ref } from "vue";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ save: vi.fn(), invalidate: vi.fn(), feedback: { error: vi.fn(), success: vi.fn(), message: { value: "" } } }));
vi.mock("@jskit-ai/http-web/client/composables/useEndpointResource", () => ({ useEndpointResource: () => ({ save: mocks.save }) }));
vi.mock("@jskit-ai/http-web/client/composables/useUiFeedback", () => ({ useUiFeedback: () => mocks.feedback }));
vi.mock("@tanstack/vue-query", () => ({ useQueryClient: () => ({ invalidateQueries: mocks.invalidate }) }));
import GithubBulkLabelsDialog from "../../src/components/studio/GithubBulkLabelsDialog.vue";

const basePath = "/api/projects/fixture/github/issues";
let app;
afterEach(() => { app?.unmount(); vi.clearAllMocks(); });

async function mount(numbers) {
  const component = { ...GithubBulkLabelsDialog, render: () => null };
  const dialog = ref();
  app = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
    .createApp({ render: () => h(component, { ref: dialog, modelValue: true, basePath, numbers, labels: [{ name: "bug" }] }) });
  app.mount({});
  await nextTick();
  return dialog.value.$.setupState;
}

it("rereads each changed issue, and the issue list and mentions once for the whole batch", async () => {
  mocks.save.mockImplementation(async (_payload, { path }) => {
    if (path === `${basePath}/2/labels`) throw new Error("Not allowed");
    return { ok: true };
  });
  const state = await mount([1, 2, 3]);
  state.selectedLabels = ["bug"];
  await state.submit();
  const keys = mocks.invalidate.mock.calls.map(([{ queryKey }]) => queryKey);
  expect(keys.filter(([name]) => name === "vibe64.issue")).toEqual([["vibe64.issue", `${basePath}/1`], ["vibe64.issue", `${basePath}/3`]]);
  expect(keys.filter(([name]) => name === "vibe64.issues")).toEqual([["vibe64.issues", basePath]]);
  expect(keys.filter(([name]) => name === "vibe64.issueMentions")).toHaveLength(1);
  expect(state.remaining).toEqual([2]);
});

it("rereads no list when no issue changed", async () => {
  mocks.save.mockRejectedValue(new Error("Not allowed"));
  const state = await mount([1, 2]);
  state.selectedLabels = ["bug"];
  await state.submit();
  expect(mocks.invalidate).not.toHaveBeenCalled();
});
