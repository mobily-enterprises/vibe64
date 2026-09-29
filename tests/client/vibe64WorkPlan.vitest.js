import { createRenderer, h, nextTick, ref, ssrContextKey } from "vue";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ options: null, realtime: null, resource: null, request: vi.fn() }));
vi.mock("@jskit-ai/http-web/client/composables/useEndpointResource", () => ({ useEndpointResource(options) { mocks.options = options; return mocks.resource; } }));
vi.mock("@jskit-ai/realtime/client/composables/useRealtimeEvent", () => ({ useRealtimeEvent(options) { mocks.realtime = options; } }));
vi.mock("@jskit-ai/http-web/client/lib/httpClient", () => ({ getHttpWebClient: () => ({ request: mocks.request }) }));
vi.mock("@/composables/useVibe64ProjectScope.js", () => ({ useVibe64ProjectSlug: () => ({ value: "fixture" }) }));
import WorkPlan from "../../src/components/studio/vibe64-session/Vibe64WorkPlan.vue";

let app;
afterEach(() => { app?.unmount(); mocks.request.mockReset(); });
function mount(data) {
  mocks.resource = { data: ref(data), loadError: ref(""), reload: vi.fn() };
  const props = ref({ active: true, session: { sessionId: "one" }, sessionsApiPath: "/api/projects/fixture/sessions" });
  const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} });
  const notice = ref();
  app = renderer.createApp({ render: () => h({ ...WorkPlan, render: () => null }, { ...props.value, ref: notice }) });
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount({});
  return { props, state: () => notice.value.$.setupState };
}
const active = { available: true, status: "active", current: { status: "active" }, history: [],
  checked: 0, total: 1, text: "Status: active\n# Reporting\n- [ ] Prove privacy\n\nEvidence will appear here." };

it("keeps the document open while live ticks and unticks arrive, and keeps completed plans accessible", async () => {
  const f = mount(active);
  expect(f.state().visible).toBe(true);
  expect(f.state().currentActive).toBe(true);
  f.state().open = true;
  mocks.resource.data.value = { ...active, text: active.text.replace("[ ]", "[x]"), checked: 1 };
  await nextTick();
  expect(f.state().sections.filter(row => row.checked !== undefined).map(row => row.checked)).toEqual([true]);
  expect(f.state().open).toBe(true);
  mocks.resource.data.value = { ...active, text: active.text + "\n- [ ] Review discovered gap" };
  await nextTick();
  expect(f.state().sections.filter(row => row.checked !== undefined).map(row => row.checked)).toEqual([false, false]);
  mocks.resource.data.value = { ...active, status: "completed", current: { status: "completed" } };
  await nextTick();
  expect(f.state().currentActive).toBe(false);
  expect(f.state().visible).toBe(true);
  expect(f.state().open).toBe(true);
  expect(f.state().label).toBe("View plan and history");
});

it("shows history with no current plan and keeps code examples separate from checklist claims", async () => {
  const f = mount({ available: false, current: null, history: [{ id: "a".repeat(64), title: "Archived", status: "active", archivedAt: "2026-09-29T00:00:00Z" }] });
  expect(f.state().visible).toBe(true);
  expect(f.state().choices[1].title).toContain("Unfinished");
  f.state().archiveId = "a".repeat(64);
  mocks.resource.data.value = { ...active, text: active.text + "\n```md\n- [ ] An example, not a requirement\n```", archiveId: "a".repeat(64), current: null };
  await nextTick();
  expect(f.state().sections.filter(row => row.checked !== undefined)).toHaveLength(1);
  expect(f.state().currentActive).toBe(false);
  f.props.value.session = { sessionId: "two" };
  await nextTick();
  expect(f.state().archiveId).toBe("");
  expect(f.state().open).toBe(false);
});

it("live notifications refresh only the matching session and show archive notices", () => {
  const f = mount(active);
  const payload = { projectSlug: "fixture", sessionId: "one", reason: "work-plan-changed", planNotice: "Archived Reporting. Available in Plan history." };
  expect(mocks.realtime.matches({ payload })).toBe(true);
  expect(mocks.realtime.matches({ payload: { ...payload, sessionId: "other" } })).toBe(false);
  mocks.realtime.onEvent({ payload });
  expect(mocks.resource.reload).toHaveBeenCalledOnce();
  expect(f.state().notice).toContain("Archived Reporting");
});

it("reads every page at one revision and targets the selected archive", async () => {
  const f = mount(active);
  f.state().archiveId = "a".repeat(64);
  mocks.request.mockResolvedValueOnce({ available: true, revision: "b".repeat(64), text: "First", hasMore: true, nextOffset: 5 })
    .mockResolvedValueOnce({ text: " second", hasMore: false });
  const result = await mocks.options.queryOptions.queryFn({ signal: new AbortController().signal });
  expect(result.text).toBe("First second");
  expect(mocks.request.mock.calls[0][0]).toContain("archiveId=" + "a".repeat(64));
  expect(mocks.request.mock.calls[1][0]).toContain("expectedRevision=" + "b".repeat(64));
  mocks.request.mockResolvedValueOnce({ revision: "b".repeat(64), text: "Old", hasMore: true, nextOffset: 3 })
    .mockRejectedValueOnce(new Error("The plan changed"));
  await expect(mocks.options.queryOptions.queryFn({ signal: new AbortController().signal })).rejects.toThrow("plan changed");
});
