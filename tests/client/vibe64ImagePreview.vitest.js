import { readFileSync } from "node:fs";
import { createRenderer, nextTick, ssrContextKey } from "vue";
import { afterEach, describe, expect, it } from "vitest";

import Vibe64ImagePreview from "../../src/components/studio/files/Vibe64ImagePreview.vue";
import { FILE_PREVIEW_IMAGE_TYPES, filePreviewImageType } from "../../packages/vibe64-source-editor/src/shared/fileTypes.js";

let app;
function mount(props) {
  const renderer = createRenderer({ createComment: (text) => ({ text }), insert() {}, remove() {}, parentNode() {}, nextSibling() {} });
  app = renderer.createApp({ ...Vibe64ImagePreview, render: () => null }, props);
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount({});
  return app._instance;
}
afterEach(() => app?.unmount());

describe("image preview", () => {
  it("covers the common image formats, SVG included, by extension", () => {
    expect(Object.keys(FILE_PREVIEW_IMAGE_TYPES).sort()).toEqual(["avif", "bmp", "gif", "ico", "jpeg", "jpg", "png", "svg", "webp"]);
    expect(filePreviewImageType("shots/Photo.JPG")).toBe("image/jpeg");
    expect(filePreviewImageType("logo.svg")).toBe("image/svg+xml");
    expect(filePreviewImageType("notes.txt")).toBe("");
    expect(filePreviewImageType("svg")).toBe("");
  });

  it("shows the name, then the dimensions and size once the image loads", () => {
    const { setupState: state } = mount({ name: "photo.png", size: 46_182, src: "/download?path=photo.png&inline=1" });
    expect(state.status).toBe("loading");
    expect(state.details).toBe("45.1 KiB");
    state.loaded({ target: { naturalWidth: 1200, naturalHeight: 800 } });
    expect(state.status).toBe("loaded");
    expect(state.details).toBe("1200 × 800 px · 45.1 KiB");
  });

  it("fits by default, toggles actual size, and starts over for the next image", async () => {
    const instance = mount({ name: "a.png", src: "/a" });
    const state = instance.setupState;
    state.loaded({ target: { naturalWidth: 10, naturalHeight: 10 } });
    expect(state.actualSize).toBe(false);
    state.actualSize = true;
    instance.props.src = "/b";
    await nextTick();
    expect(state.actualSize).toBe(false);
    expect(state.status).toBe("loading");
    expect(state.details).toBe("a.png");
  });

  it("offers a retry when the image cannot be shown", () => {
    const { setupState: state } = mount({ name: "broken.webp", src: "/broken" });
    state.status = "failed";
    state.retry();
    expect(state.status).toBe("loading");
    expect(state.version).toBe(1);
  });

  it("always loads the file as an image, never as inline markup", () => {
    const source = readFileSync(new URL("../../src/components/studio/files/Vibe64ImagePreview.vue", import.meta.url), "utf8");
    expect(source).toMatch(/<img\b[^>]*:src="src"/u);
    expect(source).not.toMatch(/v-html|innerHTML|<object|<iframe|<embed/u);
  });
});
