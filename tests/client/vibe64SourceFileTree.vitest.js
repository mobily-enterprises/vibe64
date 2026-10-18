import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { compile } from "@vue/compiler-dom";
import { compileScript, parse } from "@vue/compiler-sfc";
import { renderToString } from "@vue/server-renderer";
import * as VueRuntime from "vue";
import { createSSRApp, defineComponent, h } from "vue";
import { describe, expect, it, vi } from "vitest";

vi.mock("vuetify/components/VBtn", () => ({ VBtn: passthroughComponent("button") }));
vi.mock("vuetify/components/VIcon", () => ({ VIcon: passthroughComponent("i") }));
vi.mock("vuetify/components/VMenu", () => ({ VMenu: passthroughComponent("div") }));
vi.mock("vuetify/components/VList", () => ({
  VList: passthroughComponent("div"),
  VListItem: passthroughComponent("div")
}));

import Vibe64SourceFileTree from "../../src/components/studio/vibe64-session/Vibe64SourceFileTree.vue";

const treePath = fileURLToPath(new URL(
  "../../src/components/studio/vibe64-session/Vibe64SourceFileTree.vue",
  import.meta.url
));
const { descriptor } = parse(readFileSync(treePath, "utf8"), { filename: treePath });
const treeScript = compileScript(descriptor, { id: "source-file-tree-test" });
Vibe64SourceFileTree.render = new Function("Vue", compile(descriptor.template.content, {
  bindingMetadata: treeScript.bindings,
  mode: "function",
  prefixIdentifiers: true
}).code)(VueRuntime);

function passthroughComponent(element) {
  return defineComponent({
    inheritAttrs: false,
    setup(_props, { attrs, slots }) {
      return () => h(element, attrs, [slots.activator?.({ props: {} }), slots.default?.()]);
    }
  });
}

function renderTree(props = {}) {
  const app = createSSRApp(Vibe64SourceFileTree, {
    node: {
      children: [
        { name: "src", path: "src", type: "directory" },
        { name: "app.js", path: "app.js", type: "file" }
      ],
      path: ""
    },
    ...props
  });
  return renderToString(app);
}

describe("source file tree actions", () => {
  it("offers file actions outside a lesson", async () => {
    const html = await renderTree();

    expect(html).toContain('title="Star file"');
    expect(html).toContain('title="Download file"');
    expect(html).toContain('title="New file here"');
    expect(html).toContain('title="Copy path"');
  });

  it("offers only actions the lesson routes allow in lesson-scoped mode", async () => {
    const html = await renderTree({ lessonScoped: true });

    expect(html).toContain('title="Copy path"');
    expect(html).not.toContain("Star file");
    expect(html).not.toContain("Download file");
    expect(html).not.toContain("New file here");
  });
});
