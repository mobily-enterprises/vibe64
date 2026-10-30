import { afterEach, describe, expect, it, vi } from "vitest";
import { createRenderer, markRaw, nextTick, reactive, ref } from "vue";

const surfaceHost = vi.hoisted(() => ({ outputs: null, projectSlug: null }));
vi.mock("@/composables/useVibe64OutputControls.js", async original => ({
  ...await original(), useVibe64OutputControls: () => surfaceHost.outputs
}));
vi.mock("@/composables/useVibe64ProjectScope.js", () => ({ useVibe64ProjectSlug: () => surfaceHost.projectSlug }));

import {
  PREVIEW_BRIDGE_READY_MESSAGE_TYPE,
  PREVIEW_BRIDGE_VERSION,
  PREVIEW_INTERACTION_MESSAGE_TYPE,
  PREVIEW_PICK_RESULT_MESSAGE_TYPE,
  PREVIEW_PICK_START_MESSAGE_TYPE,
  PREVIEW_PICK_STOP_MESSAGE_TYPE,
  PREVIEW_RECORDING_MESSAGE_TYPE
} from "../../packages/vibe64-terminals/src/shared/launchPreviewProtocol.js";
import {
  previewComponentSourcePath,
  previewUsageEntryForFile,
  useVibe64OutputControlsSurface
} from "../../src/composables/useVibe64OutputControlsSurface.js";

// Click in Preview from the editor's side: Pick asks the bridge, turns the
// picked component into a usage entry, and forwards recorded interactions.
const SOURCE_ROOT = "/home/person/projects/notes/sessions/active/session-a/source";
const PREVIEW_ORIGIN = "https://preview.example.test";
const RECORDING = { id: "rec_abcdefghijklmnopqrst", state: "recording", target: { id: "preview", kind: "web", label: "Preview" } };
const ENTRIES = [
  { id: "entry:page:src/pages/notes.vue", kind: "page", title: "Notes", file: "src/pages/notes.vue" },
  { id: "entry:component:src/components/NoteCard.vue", kind: "component", title: "NoteCard", file: "src/components/NoteCard.vue" },
  { id: "entry:route:GET /api/notes", kind: "route", title: "GET /api/notes", file: "server/routes.js" }
];

const mounted = [];
afterEach(() => {
  for (const fixture of mounted.splice(0)) fixture.dispose();
  vi.unstubAllGlobals();
});

function mountPick({ entries = ENTRIES, recording = null, readFails = false } = {}) {
  const outputs = Object.fromEntries([
    "launchButtonsDisabled", "loading", "loadError", "operationBusy", "launchError", "launchStarting", "launchWaiting",
    "outputTargetsLoaded", "terminalDisplayed", "terminalDockVisible", "terminalExpanded", "terminalCanRestart",
    "terminalCanRetry", "terminalCanStart", "terminalError", "terminalStatus", "terminalTitle", "terminalSubtitle",
    "terminalCommandPreview", "terminalIndicatorLabel", "terminalIndicatorState", "terminalVisible", "terminalIsRunning",
    "terminalPreviewRequiresProxy", "terminalWindowVisible", "terminalWindowStorageKey", "previewCanRestart", "previewCanShowLog",
    "previewCanStart", "previewStoppedIntent", "previewMessage", "previewIdentity", "outputExecution", "outputResults", "outputRuns",
    "visible", "launchStatusAttempt"
  ].map(name => [name, ref(false)]));
  const target = { id: "app", presentation: { kind: "web" } };
  Object.assign(outputs, { activeOutputTarget: ref(target), activeOutputTargetId: ref("app"), outputTargets: ref([target]),
    previewState: ref("ready"), previewTestNotice: ref(null), resourceAdmissionId: ref(""), testApproval: ref(null),
    run: vi.fn(async () => ({ ok: true })), terminal: { metadata: ref({ outputTargetId: "app" }) }, terminalSessionId: ref("terminal-a"),
    launchActions: ref([{ href: `${PREVIEW_ORIGIN}/` }]), requestPreviewIdentityGrant: vi.fn(), publishPreviewState: vi.fn(),
    publishPreviewDiagnostic: vi.fn(async () => true), refresh: vi.fn(async () => {}), restartTerminal: vi.fn(async () => ({ ok: true })) });
  surfaceHost.outputs = outputs;
  surfaceHost.projectSlug = ref("notes");
  const windowListeners = new Map();
  const windowObject = { innerWidth: 1280, innerHeight: 800, location: { href: "https://studio.example.test/app" },
    addEventListener(type, handler) { windowListeners.set(type, handler); },
    removeEventListener(type) { windowListeners.delete(type); } };
  const documentObject = { visibilityState: "visible", addEventListener() {}, removeEventListener() {} };
  vi.stubGlobal("window", windowObject);
  vi.stubGlobal("document", documentObject);
  const props = reactive({ embeddedPreview: true, previewDisplayed: true, windowDisplayed: true,
    session: { sessionId: "session-a", sourcePath: SOURCE_ROOT } });
  const usage = {
    openUsage: vi.fn(),
    readUsageEntries: vi.fn(async () => {
      if (readFails) throw new Error("Usage needs a fresh architecture scan.");
      return { entries };
    }),
    recordInteraction: vi.fn(async () => ({ ok: true })),
    recording: ref(recording)
  };
  let state;
  const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode: () => null, nextSibling: () => null });
  const app = renderer.createApp({ setup() {
    state = useVibe64OutputControlsSurface(props, usage); return () => null;
  } });
  app.mount({});
  const posts = [];
  const frame = markRaw({ dataset: { previewFrameRequestId: String(state.previewFrameRequestId.value) },
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 600 }),
    contentWindow: { postMessage(data, origin) { posts.push({ data, origin }); } } });
  state.previewFrame.value = frame;
  const fixture = {
    state, props, posts, usage, windowListeners,
    message(data, { source = frame.contentWindow, origin = PREVIEW_ORIGIN } = {}) {
      windowListeners.get("message")({ data, source, origin });
    },
    ready() {
      state.handlePreviewFrameLoad({ currentTarget: frame });
      fixture.message({ type: PREVIEW_BRIDGE_READY_MESSAGE_TYPE, version: PREVIEW_BRIDGE_VERSION });
    },
    sent: (type) => posts.filter(post => post.data.type === type),
    dispose() {
      vi.stubGlobal("window", windowObject);
      vi.stubGlobal("document", documentObject);
      app.unmount();
      expect(windowListeners.has("keydown")).toBe(false);
    }
  };
  mounted.push(fixture);
  return fixture;
}

const settle = async () => { for (let index = 0; index < 4; index += 1) await nextTick(); };

describe("Preview component paths and entries", () => {
  it("keeps a picked file only when it lies inside the session source", () => {
    expect(previewComponentSourcePath(`${SOURCE_ROOT}/src/components/NoteCard.vue`, SOURCE_ROOT)).toBe("src/components/NoteCard.vue");
    expect(previewComponentSourcePath("src/components/NoteCard.vue", SOURCE_ROOT)).toBe("src/components/NoteCard.vue");
    for (const outside of ["/home/person/other/NoteCard.vue", "../NoteCard.vue", "src/../../NoteCard.vue",
      "https://cdn.example/NoteCard.vue", "", null]) {
      expect(previewComponentSourcePath(outside, SOURCE_ROOT)).toBe("");
    }
  });

  it("prefers the component entry for exactly that file, then its page entry", () => {
    expect(previewUsageEntryForFile(ENTRIES, "src/components/NoteCard.vue").id).toBe("entry:component:src/components/NoteCard.vue");
    expect(previewUsageEntryForFile(ENTRIES, "src/pages/notes.vue").id).toBe("entry:page:src/pages/notes.vue");
    expect(previewUsageEntryForFile(ENTRIES, "server/routes.js")).toBeNull();
    expect(previewUsageEntryForFile(ENTRIES, "src/components/NoteCard")).toBeNull();
  });
});

describe("Pick", () => {
  it("is available once a bridge 8 page is ready, and starts and stops through the bridge origin", async () => {
    const f = mountPick();
    expect(f.state.previewPickAvailable.value).toBe(false);
    expect(f.state.togglePreviewPick()).toBe(false);
    f.ready();
    expect(f.state.previewPickAvailable.value).toBe(true);
    expect(f.state.togglePreviewPick()).toBe(true);
    expect(f.state.previewPicking.value).toBe(true);
    expect(f.sent(PREVIEW_PICK_START_MESSAGE_TYPE)).toEqual([{ data: { type: PREVIEW_PICK_START_MESSAGE_TYPE, version: PREVIEW_BRIDGE_VERSION }, origin: PREVIEW_ORIGIN }]);
    f.windowListeners.get("keydown")({ key: "Escape" });
    expect(f.state.previewPicking.value).toBe(false);
    expect(f.sent(PREVIEW_PICK_STOP_MESSAGE_TYPE)).toHaveLength(1);
    f.state.togglePreviewPick();
    f.props.previewDisplayed = false;
    await settle();
    expect(f.state.previewPicking.value).toBe(false, "hiding Preview ends Pick");
    expect(f.sent(PREVIEW_PICK_STOP_MESSAGE_TYPE)).toHaveLength(2);
  });

  it("opens Usage › Calls at the picked component's entry", async () => {
    const f = mountPick();
    f.ready();
    f.state.togglePreviewPick();
    f.message({ type: PREVIEW_PICK_RESULT_MESSAGE_TYPE, componentFile: `${SOURCE_ROOT}/src/components/NoteCard.vue`,
      componentName: "NoteCard", elementLabel: "button \"Save\"" });
    await settle();
    expect(f.usage.readUsageEntries).toHaveBeenCalledWith({ limit: 50, q: "src/components/NoteCard.vue" });
    expect(f.usage.openUsage).toHaveBeenCalledWith({ entryId: "entry:component:src/components/NoteCard.vue", mode: "calls" });
    expect(f.state.previewPicking.value).toBe(false);
    expect(f.state.previewPickNoticeVisible.value).toBe(false);
  });

  it("explains a page without component information, a file without an entry, and a failed read", async () => {
    const f = mountPick();
    f.ready();
    for (const componentFile of [null, "/somewhere/else/Widget.vue"]) {
      f.state.togglePreviewPick();
      f.message({ type: PREVIEW_PICK_RESULT_MESSAGE_TYPE, componentFile, componentName: null, elementLabel: "div" });
      await settle();
      expect(f.state.previewPickNoticeText.value).toBe("No component information on this page. Record while clicking to see its requests.");
    }
    expect(f.usage.readUsageEntries).not.toHaveBeenCalled();

    f.state.togglePreviewPick();
    f.message({ type: PREVIEW_PICK_RESULT_MESSAGE_TYPE, componentFile: "src/components/Unscanned.vue", elementLabel: "div" });
    await settle();
    expect(f.state.previewPickNoticeText.value).toBe("Unscanned.vue has no usage entry yet. Refresh the architecture scan, then pick again.");

    const failing = mountPick({ readFails: true });
    failing.ready();
    failing.state.togglePreviewPick();
    failing.message({ type: PREVIEW_PICK_RESULT_MESSAGE_TYPE, componentFile: "src/components/NoteCard.vue", elementLabel: "div" });
    await settle();
    expect(failing.state.previewPickNoticeText.value).toBe("Usage needs a fresh architecture scan.");
    expect(f.usage.openUsage).not.toHaveBeenCalled();
    expect(failing.usage.openUsage).not.toHaveBeenCalled();
  });

  it("ignores a cancelled pick, a result after Cancel, and results from other windows or origins", async () => {
    const f = mountPick();
    f.ready();
    const picked = { type: PREVIEW_PICK_RESULT_MESSAGE_TYPE, componentFile: "src/components/NoteCard.vue", elementLabel: "div" };
    f.state.togglePreviewPick();
    f.message({ type: PREVIEW_PICK_RESULT_MESSAGE_TYPE, cancelled: true });
    await settle();
    expect(f.state.previewPicking.value).toBe(false);
    f.message(picked);
    f.state.togglePreviewPick();
    f.message(picked, { source: {} });
    f.message(picked, { origin: "https://evil.example" });
    await settle();
    expect(f.state.previewPicking.value).toBe(true);
    expect(f.usage.readUsageEntries).not.toHaveBeenCalled();
    expect(f.state.previewPickNoticeVisible.value).toBe(false);
  });
});

describe("Recorded interactions", () => {
  it("tells each ready page about the Preview recording and continues numbering after reported interactions", async () => {
    const f = mountPick();
    f.ready();
    expect(f.sent(PREVIEW_RECORDING_MESSAGE_TYPE).at(-1).data).toEqual({ type: PREVIEW_RECORDING_MESSAGE_TYPE,
      active: false, recordingId: null, nextInteraction: 1, version: PREVIEW_BRIDGE_VERSION });
    f.usage.recording.value = RECORDING;
    await settle();
    expect(f.sent(PREVIEW_RECORDING_MESSAGE_TYPE).at(-1).data).toMatchObject({ active: true, recordingId: RECORDING.id, nextInteraction: 1 });

    f.message({ type: PREVIEW_INTERACTION_MESSAGE_TYPE, id: "i_0004", at: "2026-10-30T10:00:00.000Z", kind: "submit",
      elementLabel: "button \"Save\"", componentFile: `${SOURCE_ROOT}/src/components/NoteCard.vue` });
    expect(f.usage.recordInteraction).toHaveBeenCalledWith({ id: "i_0004", at: "2026-10-30T10:00:00.000Z",
      kind: "submit", label: "button \"Save\"", componentFile: "src/components/NoteCard.vue" });
    f.message({ type: PREVIEW_BRIDGE_READY_MESSAGE_TYPE, version: PREVIEW_BRIDGE_VERSION });
    expect(f.sent(PREVIEW_RECORDING_MESSAGE_TYPE).at(-1).data).toMatchObject({ active: true, nextInteraction: 5 },
      "a page that loads later continues after i_0004");

    f.usage.recording.value = { ...RECORDING, id: "rec_bcdefghijklmnopqrstu" };
    await settle();
    expect(f.sent(PREVIEW_RECORDING_MESSAGE_TYPE).at(-1).data).toMatchObject({ recordingId: "rec_bcdefghijklmnopqrstu", nextInteraction: 1 });
  });

  it("continues after the interactions the recording already holds, after a reload or in a second tab", async () => {
    // This editor loaded while the recording already held i_0001 to i_0004.
    const f = mountPick({ recording: { ...RECORDING, highestInteraction: 4 } });
    f.ready();
    expect(f.sent(PREVIEW_RECORDING_MESSAGE_TYPE).at(-1).data).toMatchObject({ active: true, nextInteraction: 5 });

    // The recording loads after the page did.
    const late = mountPick();
    late.ready();
    late.usage.recording.value = { ...RECORDING, highestInteraction: 6 };
    await settle();
    expect(late.sent(PREVIEW_RECORDING_MESSAGE_TYPE).at(-1).data).toMatchObject({ active: true, nextInteraction: 7 });
  });

  it("moves the bridge on to the next free number when the server refuses a number another page used", async () => {
    const f = mountPick({ recording: RECORDING });
    f.usage.recordInteraction.mockResolvedValueOnce({ ok: false, nextInteraction: 9 });
    f.ready();
    expect(f.sent(PREVIEW_RECORDING_MESSAGE_TYPE).at(-1).data).toMatchObject({ nextInteraction: 1 });
    f.message({ type: PREVIEW_INTERACTION_MESSAGE_TYPE, id: "i_0001", at: "2026-10-30T10:00:00.000Z", elementLabel: "button \"Add\"" });
    await settle();
    expect(f.sent(PREVIEW_RECORDING_MESSAGE_TYPE).at(-1).data).toMatchObject({ active: true, recordingId: RECORDING.id, nextInteraction: 9 });

    // A refusal that arrives after the recording changed moves nothing.
    const sent = f.sent(PREVIEW_RECORDING_MESSAGE_TYPE).length;
    let answer;
    f.usage.recordInteraction.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    f.message({ type: PREVIEW_INTERACTION_MESSAGE_TYPE, id: "i_0009", at: "2026-10-30T10:00:01.000Z", elementLabel: "button \"Add\"" });
    f.usage.recording.value = { ...RECORDING, id: "rec_bcdefghijklmnopqrstu" };
    await settle();
    answer({ ok: false, nextInteraction: 40 });
    await settle();
    expect(f.sent(PREVIEW_RECORDING_MESSAGE_TYPE)).toHaveLength(sent + 1);
    expect(f.sent(PREVIEW_RECORDING_MESSAGE_TYPE).at(-1).data).toMatchObject({ recordingId: "rec_bcdefghijklmnopqrstu", nextInteraction: 1 });
  });

  it("forwards nothing outside a Preview recording, nor ids, paths or labels it cannot trust", async () => {
    const f = mountPick({ recording: { ...RECORDING, state: "stopping" } });
    f.ready();
    const interaction = { type: PREVIEW_INTERACTION_MESSAGE_TYPE, id: "i_0001", at: "2026-10-30T10:00:00.000Z", elementLabel: "button \"Add\"" };
    f.message(interaction);
    f.usage.recording.value = { ...RECORDING, target: { id: "output:tests", kind: "terminal", label: "Run tests" } };
    await settle();
    f.message(interaction);
    expect(f.usage.recordInteraction).not.toHaveBeenCalled();

    f.usage.recording.value = RECORDING;
    await settle();
    f.message({ ...interaction, id: "r_000001" });
    f.message({ ...interaction, id: "i_12" });
    f.message(interaction, { origin: "https://evil.example" });
    expect(f.usage.recordInteraction).not.toHaveBeenCalled();
    f.message({ ...interaction, at: "not a time", elementLabel: "", componentFile: "/elsewhere/Widget.vue" });
    f.message({ ...interaction, id: "i_0002", elementLabel: "x".repeat(120) });
    const [[first], [second]] = f.usage.recordInteraction.mock.calls;
    expect(first).toMatchObject({ id: "i_0001", label: "element", componentFile: null });
    expect(Number.isNaN(Date.parse(first.at))).toBe(false);
    expect(second.label).toHaveLength(80);
  });

  it("forwards each interaction number once, only above the last one, and at most 500 per recording", async () => {
    const f = mountPick({ recording: RECORDING });
    f.ready();
    const interaction = (number) => ({ type: PREVIEW_INTERACTION_MESSAGE_TYPE, id: `i_${String(number).padStart(4, "0")}`,
      at: "2026-10-30T10:00:00.000Z", elementLabel: "button \"Add\"" });
    f.usage.recordInteraction.mockResolvedValue({ ok: false, nextInteraction: 3 });
    for (const number of [2, 2, 1, 2]) f.message(interaction(number));
    await settle();
    expect(f.usage.recordInteraction.mock.calls.map(([sent]) => sent.id)).toEqual(["i_0002"]);
    f.usage.recordInteraction.mockResolvedValue({ ok: true });
    for (let number = 3; number <= 600; number += 1) f.message(interaction(number));
    expect(f.usage.recordInteraction).toHaveBeenCalledTimes(500);

    // A new recording forwards again from its own first interaction.
    f.usage.recording.value = { ...RECORDING, id: "rec_bcdefghijklmnopqrstu" };
    await settle();
    f.message(interaction(1));
    expect(f.usage.recordInteraction).toHaveBeenCalledTimes(501);
  });
});
