import { createRenderer, h, nextTick, ref, shallowRef, ssrContextKey } from "vue";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ options: null, realtime: null, resource: null, request: vi.fn(), report: vi.fn() }));
vi.mock("@jskit-ai/http-web/client/composables/useEndpointResource", () => ({ useEndpointResource(options) { mocks.options = options; return mocks.resource; } }));
vi.mock("@jskit-ai/realtime/client/composables/useRealtimeEvent", () => ({ useRealtimeEvent(options) { mocks.realtime = options; } }));
vi.mock("@jskit-ai/http-web/client/lib/httpClient", () => ({ getHttpWebClient: () => ({ request: mocks.request }) }));
vi.mock("@jskit-ai/shell-web/client/error", () => ({ useShellWebErrorRuntime: () => ({ report: mocks.report }) }));
vi.mock("@/composables/useVibe64ProjectScope.js", () => ({ useVibe64ProjectSlug: () => ({ value: "fixture" }) }));
import WorkPlan from "../../src/components/studio/vibe64-session/Vibe64WorkPlan.vue";
import { VIBE64_ASSISTANT_VIEWER_KEY, VIBE64_COLLEAGUE_PLAN_KEY } from "../../src/lib/vibe64AssistantHost.js";
import { parseWorkPlanLines } from "../../packages/vibe64-terminals/src/shared/assistantWorkPlan.js";

let app;
afterEach(() => { app?.unmount(); mocks.request.mockReset(); mocks.report.mockReset(); });
function mount(data) {
  mocks.resource = { data: ref(data), loadError: ref(""), isFetching: ref(false), reload: vi.fn() };
  const props = ref({ active: true, session: { sessionId: "one" }, sessionsApiPath: "/api/projects/fixture/sessions" });
  const actor = ref({ actorKey: "local" });
  const colleague = shallowRef(null);
  const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} });
  const notice = ref();
  const component = { ...WorkPlan, render: () => null };
  app = renderer.createApp({ render: () => h(component, { ...props.value, ref: notice }) });
  app.provide(ssrContextKey, { modules: new Set() });
  app.provide(VIBE64_ASSISTANT_VIEWER_KEY, actor);
  app.provide(VIBE64_COLLEAGUE_PLAN_KEY, colleague);
  app.mount({});
  return { props, actor, colleague, state: () => notice.value.$.setupState };
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
  expect(f.state().history[0].title).toBe("Archived");
  f.state().view = "history";
  expect(f.state().showHistory).toBe(true);
  f.state().archiveId = "a".repeat(64);
  expect(f.state().showHistory).toBe(false);
  expect(f.state().selectedArchive.title).toBe("Archived");
  expect(f.state().selectedPlanReady).toBe(false);
  mocks.resource.data.value = { ...active, text: active.text + "\n```md\n- [ ] An example, not a requirement\n```", archiveId: "a".repeat(64), current: null };
  await nextTick();
  expect(f.state().sections.filter(row => row.checked !== undefined)).toHaveLength(1);
  expect(f.state().currentActive).toBe(false);
  f.props.value.session = { sessionId: "two" };
  await nextTick();
  expect(f.state().archiveId).toBe("");
  expect(f.state().view).toBe("current");
  expect(f.state().open).toBe(false);
});

it("archives the displayed current revision without starting AI and opens preserved history", async () => {
  const revision = "c".repeat(64);
  const f = mount({ ...active, current: { status: "active", revision } });
  mocks.request.mockResolvedValueOnce({ ok: true, notice: "Archived Reporting. Available in Plan history." });
  await f.state().changePlan("archive");
  expect(mocks.request).toHaveBeenCalledWith("/api/projects/fixture/sessions/one/work-plan/archive", {
    method: "POST", body: { expectedRevision: revision, expectedProgressRevision: "" }
  });
  expect(mocks.resource.reload).toHaveBeenCalledOnce();
  expect(f.state().showHistory).toBe(true);
  expect(f.state().pendingOperation).toBe("");
  expect(f.state().notice).toContain("Archived Reporting");
});

it("keeps the plan visible when archiving fails or the assistant is busy", async () => {
  const f = mount({ ...active, current: { status: "active", revision: "d".repeat(64) } });
  mocks.request.mockResolvedValueOnce({ ok: false, error: "The plan changed" });
  await f.state().changePlan("archive");
  expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({
    source: "vibe64.work-plan.archive", intent: "action-feedback", severity: "error", message: "The plan changed"
  }));
  expect(f.state().showHistory).toBe(false);
  expect(f.state().visible).toBe(true);
  f.props.value.busy = true;
  await nextTick();
  await f.state().changePlan("archive");
  expect(mocks.request).toHaveBeenCalledOnce();
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

it("makes an archive current only into an empty slot and leaves a failed restore visible", async () => {
  const id = "a".repeat(64);
  const f = mount({ ...active, archiveId: id, current: null, history: [{ id, title: "Archived", archivedAt: "2026-09-29T00:00:00Z" }] });
  f.state().view = "history";
  f.state().archiveId = id;
  mocks.request.mockRejectedValueOnce(new Error("There is already a current plan"));
  await f.state().changePlan("restore");
  expect(f.state().archiveId).toBe(id);
  expect(f.state().view).toBe("history");
  expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ source: "vibe64.work-plan.restore" }));
  mocks.request.mockResolvedValueOnce({ ok: true });
  await f.state().changePlan("restore");
  expect(mocks.request).toHaveBeenLastCalledWith("/api/projects/fixture/sessions/one/work-plan/restore", { method: "POST", body: { archiveId: id } });
  expect(f.state().archiveId).toBe("");
  expect(f.state().view).toBe("current");
  mocks.resource.data.value = { ...active, archiveId: id };
  f.state().archiveId = id;
  await f.state().changePlan("restore");
  expect(mocks.request).toHaveBeenCalledTimes(2);
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


it.each([
  [active, "current"],
  [{ current: null, history: [{ id: "a".repeat(64), title: "Archived" }] }, "history"]
])("opens through Colleague with the plan button's default and no mutation (%s)", async (data, expectedView) => {
  const f = mount(data);
  const viewer = f.colleague.value;
  expect(viewer.projectSlug).toBe("fixture");
  expect(viewer.sessionId).toBe("one");
  f.state().showPlan();
  expect(f.state().view).toBe(expectedView);
  f.state().open = false;
  await viewer.openPlan();
  expect(viewer.open).toBe(true);
  expect(viewer.view).toBe(expectedView);
  expect(mocks.resource.reload).toHaveBeenCalledOnce();
  expect(mocks.request).not.toHaveBeenCalled();
  f.state().open = false;
  await nextTick();
  expect(viewer.open).toBe(false);
});

it("selects the requested native tab and leaves an archived document through the normal read", async () => {
  const f = mount({ ...active, history: [{ id: "a".repeat(64), title: "Archived" }] });
  f.state().archiveId = "a".repeat(64);
  await f.colleague.value.openPlan("history");
  expect(f.state().archiveId).toBe("");
  expect(f.state().showHistory).toBe(true);
  await f.colleague.value.openPlan("current");
  expect(f.state().view).toBe("current");
  expect(mocks.request).not.toHaveBeenCalled();
});

it.each([
  [{ current: null, history: [] }, "", "no current plan or plan history"],
  [active, "Access denied", "Access denied"],
  [active, "The plan could not be loaded", "could not be loaded"]
])("does not open an unavailable plan (%s)", async (data, error, expectedError) => {
  const f = mount(data);
  mocks.resource.loadError.value = error;
  await expect(f.colleague.value.openPlan()).rejects.toThrow(expectedError);
  expect(f.state().open).toBe(false);
  expect(mocks.request).not.toHaveBeenCalled();
});

it.each(["session", "actor", "inactive", "superseded"])("rejects a %s change during its fresh read", async (change) => {
  const f = mount(active);
  let finish;
  mocks.resource.reload.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  let current = true;
  const pending = f.colleague.value.openPlan("default", () => current);
  if (change === "session") f.props.value.session = { sessionId: "two" };
  if (change === "actor") f.actor.value = { actorKey: "other" };
  if (change === "inactive") f.props.value.active = false;
  if (change === "superseded") current = false;
  await nextTick();
  finish();
  await expect(pending).rejects.toThrow("changed before its plan opened");
  expect(f.state().open).toBe(false);
  expect(mocks.request).not.toHaveBeenCalled();
});

it("publishes only its active lifetime and does not clear a replacement owner on unmount", async () => {
  const f = mount(active);
  const viewer = f.colleague.value;
  f.props.value.active = false;
  await nextTick();
  expect(f.colleague.value).toBe(null);
  expect(viewer.open).toBe(false);
  f.props.value.active = true;
  await nextTick();
  expect(f.colleague.value).toBe(viewer);
  const replacement = {};
  f.colleague.value = replacement;
  app.unmount();
  app = null;
  expect(f.colleague.value).toBe(replacement);
});


it("Plan and Progress select the same artifact and accumulate companion pages at exact paired revisions", async () => {
  const f = mount({ ...active, progressAvailable: true, progressRevision: "e".repeat(64), progressText: "# Progress\nVerified evidence" });
  expect(f.state().document).toBe("plan");
  f.state().document = "progress";
  await nextTick();
  expect(f.state().sections.flatMap(section => section.blocks)).not.toEqual([]);
  expect(f.state().archiveId).toBe("");
  mocks.request.mockResolvedValueOnce({ ...active, revision: "b".repeat(64), progressRevision: "e".repeat(64), progressText: "", hasMore: true, nextOffset: 100 })
    .mockResolvedValueOnce({ text: "", progressText: "Actual complete companion", hasMore: false });
  const result = await mocks.options.queryOptions.queryFn({ signal: new AbortController().signal });
  expect(result.text).toBe(active.text);
  expect(result.progressText).toBe("Actual complete companion");
  expect(mocks.request.mock.calls[1][0]).toContain("expectedProgressRevision=" + "e".repeat(64));
  expect(mocks.request.mock.calls[1][0]).toContain("expectedRevision=" + "b".repeat(64));
});

it("keeps the summary and checklist visible while retaining the complete technical plan in a collapsed section", async () => {
  const text = "# Reporting\nShort user summary\n- [ ] Prove privacy\n\n## Technical details\n### Ownership\nUse the existing authorization owner.\n- [ ] Reject foreign access\n```js\nconst retained = true;\n```";
  const f = mount({ ...active, revision: "b".repeat(64), text });
  expect(f.state().technicalPanel).toBe(null);
  expect(f.state().overviewSections.map(section => section.checked)).toEqual([undefined, false, undefined]);
  expect(f.state().technicalSections.map(section => section.checked)).toEqual([undefined, false, undefined]);
  expect(JSON.stringify(f.state().overviewSections)).toContain("Short user summary");
  expect(JSON.stringify(f.state().overviewSections)).not.toContain("authorization owner");
  expect(JSON.stringify(f.state().technicalSections)).toContain("authorization owner");
  expect(JSON.stringify(f.state().technicalSections)).toContain("const retained = true;");
  expect(mocks.resource.data.value.text).toBe(text, "Collapse is presentation only; canonical Plan is unchanged");
  f.state().technicalPanel = "technical";
  mocks.resource.data.value = { ...mocks.resource.data.value, progressText: "New evidence", progressRevision: "e".repeat(64) };
  await nextTick();
  expect(f.state().technicalPanel).toBe("technical", "Progress updates do not collapse the same Plan");
  mocks.resource.data.value = { ...mocks.resource.data.value, revision: "c".repeat(64) };
  await nextTick();
  expect(f.state().technicalPanel).toBe(null);
});

it("never mistakes a fenced heading for the technical boundary or hides unmarked legacy content", () => {
  const text = "# Legacy\n```md\n## Technical details\n- [ ] Code example only\n```\n- [ ] Actual requirement\nLegacy detailed instructions remain visible.";
  const f = mount({ ...active, text });
  expect(f.state().technicalSections).toEqual([]);
  expect(f.state().overviewSections).toEqual(f.state().sections);
  expect(JSON.stringify(f.state().overviewSections)).toContain("Legacy detailed instructions");
  expect(f.state().sections.filter(section => section.checked !== undefined)).toHaveLength(1);
  expect(parseWorkPlanLines(text, { markTechnicalDetails: true })).toEqual(parseWorkPlanLines(text));
  const heading = "## Technical details\n- [ ] Step";
  expect(parseWorkPlanLines(heading)).toEqual([{ text: "## Technical details" }, { text: "Step", checked: false }]);
  expect(parseWorkPlanLines(heading, { markTechnicalDetails: true })[0].technicalDetails).toBe(true);
});

it("keeps Progress fully visible and resets expansion across documents, archives and sessions", async () => {
  const text = "# Plan\n- [ ] Deliver\n## Technical details\nExact implementation instructions";
  const f = mount({ ...active, revision: "b".repeat(64), text, progressText: text, progressAvailable: true });
  f.state().technicalPanel = "technical";
  f.state().document = "progress";
  await nextTick();
  expect(f.state().technicalPanel).toBe(null);
  expect(f.state().technicalSections).toEqual([]);
  expect(JSON.stringify(f.state().overviewSections)).toContain("Exact implementation instructions");
  f.state().document = "plan";
  await nextTick();
  f.state().technicalPanel = "technical";
  f.state().archiveId = "a".repeat(64);
  await nextTick();
  expect(f.state().technicalPanel).toBe(null);
  f.state().technicalPanel = "technical";
  f.props.value.session = { sessionId: "two" };
  await nextTick();
  expect(f.state().technicalPanel).toBe(null);
});


it("uses the same native viewer to show automatically archived plans while preserving both documents", () => {
  const f = mount({ available: false, current: null, history: [{ id: "b".repeat(64), title: "Completed scope", status: "completed", archivedAt: "2026-10-09T00:00:00Z" }] });
  f.state().showPlan("history");
  expect(f.state().open).toBe(true);
  expect(f.state().showHistory).toBe(true);
  expect(f.state().history[0].status).toBe("completed");
  expect(mocks.request).not.toHaveBeenCalled();
});
