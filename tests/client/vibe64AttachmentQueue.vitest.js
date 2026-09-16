import { createSSRApp, defineComponent, h } from "vue";
import { renderToString } from "@vue/server-renderer";
import { describe, expect, it, vi } from "vitest";

vi.mock("vuetify/components/VBtn", async () => {
  const { defineComponent: define, h: create } = await import("vue");
  return {
    VBtn: define({
      inheritAttrs: false,
      setup(_props, { attrs, slots }) {
        return () => create("button", attrs, slots.default?.());
      }
    })
  };
});
vi.mock("vuetify/components/VIcon", async () => {
  const { defineComponent: define, h: create } = await import("vue");
  return {
    VIcon: define({
      inheritAttrs: false,
      setup(_props, { attrs }) {
        return () => create("span", attrs);
      }
    })
  };
});
vi.mock("vuetify/components/VProgressLinear", async () => {
  const { defineComponent: define, h: create } = await import("vue");
  return {
    VProgressLinear: define({
      inheritAttrs: false,
      props: {
        modelValue: {
          default: 0,
          type: Number
        }
      },
      setup(props, { attrs }) {
        return () => create("progress", {
          ...attrs,
          max: 100,
          value: props.modelValue
        });
      }
    })
  };
});

vi.mock("../../src/components/studio/vibe64-session/Vibe64AttachmentDialog.vue", () => ({ default: { render: () => null } }));

import Vibe64AttachmentQueue from "../../src/components/studio/vibe64-session/Vibe64AttachmentQueue.vue";

const VBtn = defineComponent({
  inheritAttrs: false,
  setup(_props, { attrs, slots }) {
    return () => h("button", attrs, slots.default?.());
  }
});
const VIcon = defineComponent({
  inheritAttrs: false,
  setup(_props, { attrs }) {
    return () => h("span", attrs);
  }
});
const VProgressLinear = defineComponent({
  inheritAttrs: false,
  props: {
    modelValue: {
      default: 0,
      type: Number
    }
  },
  setup(props, { attrs }) {
    return () => h("progress", {
      ...attrs,
      max: 100,
      value: props.modelValue
    });
  }
});

async function renderQueue(items) {
  const app = createSSRApp({
    render: () => h(Vibe64AttachmentQueue, { items })
  });
  app.component("VBtn", VBtn);
  app.component("VIcon", VIcon);
  app.component("VProgressLinear", VProgressLinear);
  return renderToString(app);
}

describe("Vibe64 attachment queue", () => {
  it("renders truthful aggregate and byte progress for active uploads", async () => {
    const html = await renderQueue([
      {
        bytesSent: 512,
        clientId: "uploading",
        fileName: "draft.txt",
        phase: "uploading",
        size: 1024
      },
      {
        bytesSent: 2048,
        clientId: "ready",
        fileName: "ready.png",
        phase: "ready",
        size: 2048
      }
    ]);

    expect(html).toContain("1 of 2 ready · 83%");
    expect(html).toContain("512 B / 1.0 KB · 50%");
    expect(html).toContain("Cancel draft.txt");
    expect(html).toContain("Remove ready.png");
    expect(html).toContain("1 attachment is in progress. 1 attachment ready.");
    expect(html).toContain("aria-busy=\"true\"");
    expect(html).toContain("<progress");
  });

  it("keeps failed and cancelled files recoverable without an indeterminate spinner", async () => {
    const html = await renderQueue([
      {
        clientId: "failed",
        error: "The connection was interrupted.",
        fileName: "broken.bin",
        phase: "failed",
        size: 300
      },
      {
        clientId: "cancelled",
        fileName: "paused.log",
        phase: "cancelled",
        size: 400
      }
    ]);

    expect(html).toContain("0 of 1 ready · 1 needs attention");
    expect(html).toContain("The connection was interrupted.");
    expect(html).toContain("Retry broken.bin");
    expect(html).toContain("Remove broken.bin");
    expect(html).toContain("Retry paused.log");
    expect(html).toContain("1 attachment needs attention. 1 attachment cancelled.");
    expect(html).not.toContain("<progress");
  });

  it("keeps unknown preparation progress stationary when reduced motion is requested", async () => {
    const originalWindow = globalThis.window;
    globalThis.window = {
      matchMedia: () => ({
        addEventListener: vi.fn(),
        matches: true,
        removeEventListener: vi.fn()
      })
    };
    let html = "";
    try {
      html = await renderQueue([{
        clientId: "preparing",
        fileName: "Preview screenshot",
        phase: "preparing",
        size: 0
      }]);
    } finally {
      globalThis.window = originalWindow;
    }

    expect(html).toContain("Preparing");
    expect(html).toContain("0 of 1 ready · in progress");
    expect(html).toContain("assistant-attachment-queue__progress--stationary");
    expect(html).not.toContain("<progress");
  });

  it("uses plural live-region copy for multiple completed and cancelled files", async () => {
    const html = await renderQueue([
      { clientId: "ready-1", fileName: "one.txt", phase: "ready", size: 1 },
      { clientId: "ready-2", fileName: "two.txt", phase: "ready", size: 1 },
      { clientId: "cancelled-1", fileName: "three.txt", phase: "cancelled", size: 1 },
      { clientId: "cancelled-2", fileName: "four.txt", phase: "cancelled", size: 1 }
    ]);

    expect(html).toContain("2 attachments cancelled. 2 attachments ready.");
  });

  it("uses plural summary copy for multiple failed files", async () => {
    const html = await renderQueue([
      { clientId: "failed-1", fileName: "one.txt", phase: "failed", size: 1 },
      { clientId: "failed-2", fileName: "two.txt", phase: "failed", size: 1 }
    ]);

    expect(html).toContain("0 of 2 ready · 2 need attention");
    expect(html).toContain("2 attachments need attention.");
  });

  it("renders nothing when the queue is empty", async () => {
    expect((await renderQueue([])).replace(/<!--.*?-->/gu, "")).toBe("");
  });
});
