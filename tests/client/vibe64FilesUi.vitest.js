import { readFileSync } from "node:fs";
import { createRenderer, nextTick, ref, ssrContextKey } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requests: [], responses: null, uploads: [], feedback: [], downloads: [] }));
vi.mock("vuetify", () => ({ useDisplay: () => ({ smAndDown: ref(false) }) }));
vi.mock("@jskit-ai/http-web/client/lib/httpClient", () => ({
  getHttpWebClient: () => ({
    request: async (url, options = {}) => {
      mocks.requests.push({ url, method: options.method || "GET", body: options.body });
      return mocks.responses(url, options);
    }
  })
}));
vi.mock("@jskit-ai/http-web/client/composables/useUiFeedback", () => ({
  useUiFeedback: () => ({
    success: (message) => mocks.feedback.push(["success", message]),
    error: (error, fallback) => mocks.feedback.push(["error", error?.message || fallback])
  })
}));
vi.mock("../../src/lib/vibe64AttachmentDownload.js", () => ({
  downloadAttachment: (url, name) => new Promise((resolve) => mocks.downloads.push({ url, name, resolve }))
}));
vi.mock("../../src/lib/vibe64FileUpload.js", () => ({
  uploadFileRequest: (request) => {
    mocks.uploads.push(request);
    return new Promise(() => {});
  }
}));

import Vibe64FileArea from "../../src/components/studio/files/Vibe64FileArea.vue";
import Vibe64FileConflictDialog from "../../src/components/studio/files/Vibe64FileConflictDialog.vue";
import Vibe64FileTransferDialog from "../../src/components/studio/files/Vibe64FileTransferDialog.vue";
import Vibe64ProjectFiles from "../../src/components/studio/files/Vibe64ProjectFiles.vue";
import Vibe64SessionFiles from "../../src/components/studio/vibe64-session/Vibe64SessionFiles.vue";
import { VIBE64_ACTIVE_SESSION_NAV_KEY } from "../../src/lib/vibe64ActiveSessionNav.js";

const apps = [];
function mount(component, props, provides = []) {
  const renderer = createRenderer({ createComment: (text) => ({ text }), insert() {}, remove() {}, parentNode() {}, nextSibling() {} });
  const app = renderer.createApp({ ...component, render: () => null }, props);
  app.provide(ssrContextKey, { modules: new Set() });
  for (const [key, value] of provides) app.provide(key, value);
  app.mount({});
  apps.push(app);
  return app._instance;
}

async function settle() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
  await nextTick();
}

const tree = (children) => ({ ok: true, location: "/state/drop-zone", tree: { children, hasMore: false, nextOffset: 0 } });
const BASE = "/api/vibe64/project-files/project-drop-zone";

beforeEach(() => {
  mocks.requests = [];
  mocks.uploads = [];
  mocks.feedback = [];
  mocks.downloads = [];
  vi.useFakeTimers();
});
afterEach(() => {
  while (apps.length) apps.pop().unmount();
  vi.useRealTimers();
});

describe("Files area", () => {
  it("creates a text file in the open folder and opens it for editing", async () => {
    mocks.responses = (url, options) => url.includes("/tree?") ? tree([])
      : { ok: true, file: { path: options.body.path, text: options.body.text, hash: "h1" } };
    const { setupState: state } = mount(Vibe64FileArea, { area: "project-drop-zone", base: BASE });
    await settle();
    await state.loadDirectory("docs");
    state.openNewFile();
    state.newFileName = "notes.md";
    state.newFileText = "# Notes\n";
    await state.createFile();
    await settle();
    expect(mocks.requests.find((request) => request.method === "POST")).toEqual({
      url: `${BASE}/file`, method: "POST", body: { path: "docs/notes.md", text: "# Notes\n" }
    });
    expect(state.newFileOpen).toBe(false);
    expect(state.file).toMatchObject({ path: "docs/notes.md", text: "# Notes\n" });
    expect(state.canWrite).toBe(true);
  });

  it("refuses a new file name with a folder in it", async () => {
    mocks.responses = () => tree([]);
    const { setupState: state } = mount(Vibe64FileArea, { area: "backups", base: "/api/vibe64/project-files/backups" });
    await settle();
    state.openNewFile();
    state.newFileName = "../escape.txt";
    await state.createFile();
    expect(state.nameError).toBe("Enter a file name without slashes.");
    expect(mocks.requests.some((request) => request.method === "POST")).toBe(false);
  });

  it("keeps Session read only: no writes, and items can only be copied out", async () => {
    mocks.responses = () => tree([{ type: "file", name: "log.txt", path: "log.txt", size: 3 }]);
    const { setupState: state } = mount(Vibe64FileArea, {
      area: "session", base: "/api/vibe64/sessions/s1/files/session", destinations: [{ key: "repo", area: "repo", label: "Repo", base: "/x" }]
    });
    await settle();
    expect(state.readOnly).toBe(true);
    expect(state.canWrite).toBe(false);
    const template = readFileSync(new URL("../../src/components/studio/files/Vibe64FileArea.vue", import.meta.url), "utf8");
    expect(template).toContain(":read-only=\"readOnly\"");
    expect(template).toContain("readOnly ? 'Copy to…' : 'Move or copy…'");
  });

  it("asks once about names already in the folder and uploads straight into it", async () => {
    mocks.responses = (url) => url.endsWith("/conflicts") ? { ok: true, existing: ["a.txt"] } : tree([]);
    const { setupState: state } = mount(Vibe64FileArea, { area: "project-drop-zone", base: BASE });
    await settle();
    await state.loadDirectory("inbox");
    const files = [{ name: "a.txt", size: 1 }, { name: "b.txt", size: 2 }];
    await state.startUploads(files);
    expect(mocks.requests.at(-1)).toEqual({ url: `${BASE}/conflicts`, method: "POST", body: { path: "inbox", names: ["a.txt", "b.txt"] } });
    expect(state.uploadConflicts.names).toEqual(["a.txt"]);
    expect(mocks.uploads).toHaveLength(0);

    state.resolveUploadConflict("skip");
    await settle();
    expect(state.uploadConflicts.names).toEqual([]);
    expect(state.uploads.items.value.map((item) => item.fileName)).toEqual(["b.txt"]);
    expect(mocks.uploads[0].path).toBe(`${BASE}/upload?path=inbox%2Fb.txt`);
  });

  it("uploads every file with the one choice, or nothing when the question is cancelled", async () => {
    mocks.responses = (url) => url.endsWith("/conflicts") ? { ok: true, existing: ["a.txt"] } : tree([]);
    const { setupState: state } = mount(Vibe64FileArea, { area: "project-drop-zone", base: BASE });
    await settle();
    await state.startUploads([{ name: "a.txt", size: 1 }]);
    state.resolveUploadConflict("");
    await settle();
    expect(mocks.uploads).toHaveLength(0);
    await state.startUploads([{ name: "a.txt", size: 1 }]);
    state.resolveUploadConflict("keep-both");
    await settle();
    expect(mocks.uploads[0].path).toBe(`${BASE}/upload?path=a.txt&conflict=keep-both`);
  });

  it("previews an image in place from its inline address and walks the folder's images with the keyboard", async () => {
    mocks.responses = () => tree([
      { type: "file", name: "a.png", path: "a.png", size: 10 },
      { type: "file", name: "notes.txt", path: "notes.txt", size: 4 },
      { type: "file", name: "b.svg", path: "b.svg", size: 20 }
    ]);
    const { setupState: state } = mount(Vibe64FileArea, { area: "project-drop-zone", base: BASE });
    await settle();
    const before = mocks.requests.length;
    await state.openEntry(state.entries[0]);
    expect(state.file).toMatchObject({ image: true, path: "a.png", size: 10, src: `${BASE}/download?path=a.png&inline=1` });
    expect(mocks.requests).toHaveLength(before);
    expect(state.imageSiblings.map((entry) => entry.name)).toEqual(["a.png", "b.svg"]);

    const key = (name) => ({ key: name, target: {}, preventDefault: vi.fn(), defaultPrevented: false });
    state.previewKey(key("ArrowRight"));
    await settle();
    expect(state.file.path).toBe("b.svg");
    state.previewKey(key("ArrowRight"));
    await settle();
    expect(state.file.path).toBe("a.png");

    // At actual size the arrows scroll the image; a refresh keeps it open.
    const actualSize = { closest: (selector) => selector.includes("--actual") ? {} : null };
    state.previewKey({ ...key("ArrowRight"), target: actualSize });
    await settle();
    expect(state.file.path).toBe("a.png");
    await state.refresh();
    await settle();
    expect(state.file.path).toBe("a.png");
    expect(mocks.requests.at(-1).url).toBe(`${BASE}/tree?path=&offset=0`);

    state.previewKey(key("Escape"));
    expect(state.file).toBe(null);
  });

  it("reloads after moving an item out and tells the host where it went", async () => {
    mocks.responses = () => tree([]);
    const instance = mount(Vibe64FileArea, { area: "project-drop-zone", base: BASE, onTransferred: vi.fn() });
    const { setupState: state } = instance;
    await settle();
    const loads = mocks.requests.length;
    state.transferred({ mode: "move", item: { name: "report.pdf", path: "report.pdf" }, path: "2026/report.pdf", destination: { area: "backups", label: "Project Backups" } });
    await settle();
    expect(mocks.feedback.at(-1)).toEqual(["success", "Moved “report.pdf” to Project Backups › 2026."]);
    expect(mocks.requests.length).toBe(loads + 1);
    expect(instance.vnode.props.onTransferred).toHaveBeenCalledOnce();

    // Skip changed nothing, so it says nothing and reloads nothing.
    state.transferred({ mode: "move", item: { name: "a.txt", path: "a.txt" }, path: "a.txt", skipped: true, destination: { area: "backups", label: "Project Backups" } });
    await settle();
    expect(mocks.feedback).toHaveLength(1);
    expect(mocks.requests.length).toBe(loads + 1);
    expect(instance.vnode.props.onTransferred).toHaveBeenCalledOnce();
  });

  it("downloads beside other work, showing progress only on that item", async () => {
    mocks.responses = () => tree([{ type: "file", name: "big.zip", path: "big.zip", size: 9 }]);
    const { setupState: state } = mount(Vibe64FileArea, { area: "project-drop-zone", base: BASE, projectSlug: "books" });
    await settle();
    void state.download("big.zip");
    void state.download("big.zip");
    expect(mocks.downloads).toHaveLength(1);
    expect(mocks.downloads[0]).toMatchObject({ name: "big.zip", url: "/api/app/books/vibe64/project-files/project-drop-zone/download?path=big.zip" });
    expect(state.downloading).toEqual(["big.zip"]);
    expect(state.busy).toBe(false);
    mocks.downloads[0].resolve();
    await settle();
    expect(state.downloading).toEqual([]);
  });
});

describe("Move or copy", () => {
  const destinations = [
    { key: "project-drop-zone", area: "project-drop-zone", label: "Project Dropzone", base: BASE },
    { key: "backups", area: "backups", label: "Project Backups", base: "/api/vibe64/project-files/backups" },
    { key: "s1:repo", area: "repo", label: "Repo · Fix login", base: "/api/vibe64/sessions/s1/files/repo", sessionId: "s1" }
  ];
  const item = { name: "docs", path: "docs", type: "directory" };

  it("starts as a copy to another area and lists only its folders", async () => {
    mocks.responses = () => tree([{ type: "directory", name: "2026", path: "2026" }, { type: "file", name: "a.txt", path: "a.txt" }]);
    const { setupState: state } = mount(Vibe64FileTransferDialog, { destinations, item, sourceArea: "project-drop-zone", sourceBase: BASE, sourceLabel: "Project Dropzone" });
    await settle();
    expect(state.mode).toBe("copy");
    expect(state.destinationKey).toBe("backups");
    expect(mocks.requests.at(-1).url).toBe("/api/vibe64/project-files/backups/tree?path=&offset=0");
    expect(state.folders.map((entry) => entry.name)).toEqual(["2026"]);
  });

  it("names the copy Keep both would make, as the server numbers it", () => {
    const subtitle = (names) => mount(Vibe64FileConflictDialog, { names }).setupState.choices[1].subtitle;
    expect(subtitle(["brief.md"])).toBe("Add a number to the new name, like “brief (1).md”");
    expect(subtitle(["archive.tar.gz"])).toBe("Add a number to the new name, like “archive.tar (1).gz”");
    expect(subtitle([".env"])).toBe("Add a number to the new name, like “.env (1)”");
    expect(subtitle(["Makefile", "a.txt"])).toBe("Add a number to the new name, like “Makefile (1)”");
  });

  it("offers only Copy for a read-only item", async () => {
    mocks.responses = () => tree([]);
    const { setupState: state } = mount(Vibe64FileTransferDialog, {
      destinations, item: { name: "log.txt", path: "log.txt", type: "file" }, readOnly: true, sourceArea: "session", sourceBase: "/s", sourceLabel: "Session"
    });
    await settle();
    expect(state.title).toBe("Copy to");
    expect(state.actionLabel).toBe("Copy here");
  });

  it("explains a destination it cannot use", async () => {
    mocks.responses = () => tree([{ type: "directory", name: "docs", path: "docs" }]);
    const { setupState: state } = mount(Vibe64FileTransferDialog, { destinations, item, sourceArea: "project-drop-zone", sourceBase: BASE, sourceLabel: "Project Dropzone" });
    await settle();
    state.destinationKey = "project-drop-zone";
    await settle();
    state.mode = "move";
    expect(state.blockedReason).toBe("It is already in this folder.");
    expect(state.insideItself("docs")).toBe(true);
    await state.browse("docs/inner");
    expect(state.blockedReason).toBe("A folder cannot go inside itself.");
  });

  it("checks the destination first, asks once about a taken name, then sends the choice to the server", async () => {
    mocks.responses = (url) => url.endsWith("/conflicts") ? { ok: true, existing: ["docs"] }
      : url.endsWith("/transfer") ? { ok: true, path: "docs (1)", mode: "copy" } : tree([]);
    const instance = mount(Vibe64FileTransferDialog, { destinations, item, sourceArea: "project-drop-zone", sourceBase: BASE, sourceLabel: "Project Dropzone", onDone: vi.fn() });
    const { setupState: state } = instance;
    await settle();
    state.destinationKey = "s1:repo";
    await settle();
    await state.confirm();
    expect(mocks.requests.at(-1)).toEqual({ url: "/api/vibe64/sessions/s1/files/repo/conflicts", method: "POST", body: { path: "", names: ["docs"] } });
    expect(state.conflictNames).toEqual(["docs"]);
    state.resolveConflict("keep-both");
    await settle();
    expect(mocks.requests.at(-1)).toEqual({
      url: `${BASE}/transfer`, method: "POST",
      body: { path: "docs", mode: "copy", targetArea: "repo", targetPath: "", conflict: "keep-both", targetSessionId: "s1" }
    });
    expect(instance.vnode.props.onDone).toHaveBeenCalledWith(expect.objectContaining({ path: "docs (1)", mode: "copy", skipped: false }));
  });

  it("sends a plain transfer when nothing is in the way", async () => {
    mocks.responses = (url) => url.endsWith("/conflicts") ? { ok: true, existing: [] }
      : url.endsWith("/transfer") ? { ok: true, path: "docs", mode: "move" } : tree([]);
    const { setupState: state } = mount(Vibe64FileTransferDialog, { destinations, item, sourceArea: "project-drop-zone", sourceBase: BASE, sourceLabel: "Project Dropzone" });
    await settle();
    state.mode = "move";
    await state.confirm();
    expect(mocks.requests.at(-1).body).toEqual({ path: "docs", mode: "move", targetArea: "backups", targetPath: "", conflict: "fail" });
  });
});

describe("Files hosts", () => {
  it("session Files shows Repo, Session Dropzone and Session, and sends items to the project's areas too", async () => {
    mocks.responses = () => ({ ok: true, areas: ["repo", "drop-zone", "session"] });
    const { setupState: state } = mount(Vibe64SessionFiles, { sessionId: "s1", sessionsApiPath: "/api/vibe64/sessions" });
    await settle();
    expect(state.tabAreas).toEqual(["drop-zone", "session"]);
    expect(state.destinations.map((destination) => [destination.area, destination.base])).toEqual([
      ["repo", "/api/vibe64/sessions/s1/files/repo"],
      ["drop-zone", "/api/vibe64/sessions/s1/files/drop-zone"],
      ["project-drop-zone", "/api/vibe64/sessions/s1/files/project-drop-zone"],
      ["backups", "/api/vibe64/sessions/s1/files/backups"]
    ]);
    const template = readFileSync(new URL("../../src/components/studio/vibe64-session/Vibe64SessionFiles.vue", import.meta.url), "utf8");
    expect(template).not.toContain("Project Backups");
  });

  it("an archived session can only send its files to the project", async () => {
    mocks.responses = () => ({ ok: true, areas: ["repo", "drop-zone", "session"] });
    const { setupState: state } = mount(Vibe64SessionFiles, { archived: true, sessionId: "s1", sessionsApiPath: "/api/vibe64/sessions" });
    await settle();
    expect(state.area).toBe("session");
    expect(state.destinations.map((destination) => destination.area)).toEqual(["project-drop-zone", "backups"]);
  });

  it("project Files has the Project Dropzone and Project Backups, and reaches the open session's Repo and Dropzone", async () => {
    const nav = ref({ visible: true, sessionId: "s1", label: "Fix login" });
    const { setupState: state } = mount(Vibe64ProjectFiles, { projectSlug: "books" }, [[VIBE64_ACTIVE_SESSION_NAV_KEY, nav]]);
    expect(state.AREAS).toEqual(["project-drop-zone", "backups"]);
    expect(state.destinations.map((destination) => [destination.label, destination.base, destination.sessionId || ""])).toEqual([
      ["Project Dropzone", "/api/app/books/vibe64/project-files/project-drop-zone", ""],
      ["Project Backups", "/api/app/books/vibe64/project-files/backups", ""],
      ["Repo · Fix login", "/api/app/books/vibe64/sessions/s1/files/repo", "s1"],
      ["Session Dropzone · Fix login", "/api/app/books/vibe64/sessions/s1/files/drop-zone", "s1"]
    ]);
    nav.value = { visible: false };
    await nextTick();
    expect(state.destinations.map((destination) => destination.area)).toEqual(["project-drop-zone", "backups"]);
  });
});

describe("move or copy result", () => {
  it("says where the item went and any new name it was given", async () => {
    const { vibe64FileTransferMessage } = await import("../../src/lib/vibe64FileAreas.js");
    const item = { name: "brief.md" };
    const destination = { label: "Project Backups" };
    expect(vibe64FileTransferMessage({ item, destination, mode: "copy", path: "brief (1).md" })).toBe("Copied “brief.md” to Project Backups as “brief (1).md”.");
    expect(vibe64FileTransferMessage({ item, destination, mode: "move", path: "2026/brief.md" })).toBe("Moved “brief.md” to Project Backups › 2026.");
    expect(vibe64FileTransferMessage({ item, destination, mode: "copy", skipped: true })).toBe("");
  });
});
