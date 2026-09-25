import { createRenderer, h, nextTick, ref, ssrContextKey } from "vue";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ upload: vi.fn(), remove: vi.fn(), error: vi.fn() }));
vi.mock("@/composables/useVibe64AttachmentCommands.js", () => ({
  useVibe64AttachmentCommands: () => ({ uploadAttachment: mocks.upload, deleteAttachment: mocks.remove })
}));
vi.mock("@jskit-ai/http-web/client/composables/useUiFeedback", () => ({
  useUiFeedback: () => ({ error: mocks.error })
}));
import Prompt from "../../src/components/studio/vibe64-session/Vibe64AutopilotPromptTextarea.vue";

const savedFile = { attachmentId: "saved", fileName: "requirements.txt", sessionId: "session-1", size: 12, reference: "[File #1]" };
const TestPrompt = { ...Prompt, render: () => null };
let app;
function mount(saved = [savedFile], attachmentsOwnedByConversation = false) {
  const files = ref(saved), draft = ref("Keep [File #1]."), child = ref(null);
  app = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} }).createApp({
    setup: () => () => h(TestPrompt, {
      ref: child, sessionId: "session-1", modelValue: draft.value, savedAttachments: files.value, attachmentsOwnedByConversation,
      "onUpdate:modelValue": value => { draft.value = value; },
      "onAttachments-change": value => { files.value = value; }
    })
  });
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount({});
  return { files, draft, child };
}
beforeEach(() => {
  mocks.upload.mockReset().mockResolvedValue({ ok: true, attachmentId: "new", fileName: "notes.txt", size: 8 });
  mocks.remove.mockReset().mockResolvedValue({ ok: true });
  mocks.error.mockReset();
});
afterEach(() => { app?.unmount(); app = null; });

it("shows saved uploads immediately and retains both receipts when another file is uploaded", async () => {
  const { child, files, draft } = mount();
  expect(child.value.queueItems.map(row => row.fileName)).toEqual(["requirements.txt"]);
  await child.value.attachFiles([{ name: "notes.txt", size: 8 }]);
  await nextTick();
  expect(files.value.map(file => [file.attachmentId, file.reference])).toEqual([["saved", "[File #1]"], ["new", "[File #2]"]]);
  expect(draft.value).toContain("[File #2]");
  expect(child.value.queueItems.map(row => row.receipt.reference)).toEqual(["[File #1]", "[File #2]"]);
});

it("clears only accepted attachments while preserving the newer draft upload", async () => {
  const { child, files } = mount();
  await child.value.attachFiles([{ name: "notes.txt", size: 8 }]);
  await nextTick();
  child.value.clearAttachments({ attachmentIds: ["saved"] });
  await nextTick();
  expect(files.value.map(file => file.attachmentId)).toEqual(["new"]);
  expect(child.value.queueItems.map(row => row.attachmentId)).toEqual(["new"]);
  expect(mocks.remove).not.toHaveBeenCalled();
});

it("does not delete a completed upload when its saved composer is unmounted", async () => {
  const { child, files } = mount([]);
  await child.value.attachFiles([{ name: "notes.txt", size: 8 }]);
  await nextTick();
  expect(files.value).toHaveLength(1);
  app.unmount();app = null;
  await nextTick();
  expect(mocks.remove).not.toHaveBeenCalled();
});

it("counts saved attachments towards the upload limit", async () => {
  const { child, files } = mount(Array.from({ length: 9 }, (_, index) => ({ ...savedFile, attachmentId: `saved-${index}` })));
  await child.value.attachFiles([{ name: "notes.txt", size: 8 }, { name: "overflow.txt", size: 8 }]);
  await nextTick();
  expect(mocks.upload).toHaveBeenCalledTimes(1);
  expect(files.value).toHaveLength(10);
  expect(child.value.attachmentState.atCapacity).toBe(true);
});

it("removes a restored file and renumbers the surviving upload in the draft", async () => {
  const { child, files, draft } = mount();
  await child.value.attachFiles([{ name: "notes.txt", size: 8 }]);
  await nextTick();
  child.value.$.setupState.removeUploadedAttachment(child.value.queueItems[0]);
  await nextTick();
  expect(mocks.remove).toHaveBeenCalledWith("session-1", "saved");
  expect(files.value.map(file => [file.attachmentId, file.reference])).toEqual([["new", "[File #1]"]]);
  expect(draft.value).not.toContain("[File #2]");
  expect(draft.value.match(/\[File #1\]/g)).toHaveLength(1);
});

it("drops the prior viewer's local queue when the parent restores a different draft", async () => {
  const { child, files } = mount([]);
  await child.value.attachFiles([{ name: "notes.txt", size: 8 }]);
  await nextTick();
  files.value = [savedFile];
  await nextTick();
  expect(child.value.queueItems.map(row => row.attachmentId)).toEqual(["saved"]);
  expect(mocks.remove).not.toHaveBeenCalled();
});

it("still cleans up an unfinished upload that finishes after unmount", async () => {
  const deferred = Promise.withResolvers();
  mocks.upload.mockReturnValueOnce(deferred.promise);
  const { child } = mount([]);
  const uploading = child.value.attachFiles([{ name: "notes.txt", size: 8 }]);
  app.unmount();app = null;
  deferred.resolve({ ok: true, attachmentId: "late", fileName: "notes.txt", size: 8 });
  await uploading;
  await vi.waitFor(() => expect(mocks.remove).toHaveBeenCalledWith("session-1", "late"));
});


it("removes a temporary draft reference while leaving its conversation-owned file for Close", async () => {
  const { child, files } = mount([savedFile], true);
  child.value.$.setupState.removeUploadedAttachment(child.value.queueItems[0]);
  await nextTick();
  expect(files.value).toEqual([]);
  expect(child.value.queueItems).toEqual([]);
  expect(mocks.remove).not.toHaveBeenCalled();
});
