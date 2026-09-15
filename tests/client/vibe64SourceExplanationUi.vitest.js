import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { compile } from "@vue/compiler-dom";
import { compileScript, parse } from "@vue/compiler-sfc";
import { renderToString } from "@vue/server-renderer";
import * as VueRuntime from "vue";
import { createSSRApp, defineComponent, h } from "vue";
import { describe, expect, it, vi } from "vitest";

vi.mock("vuetify/components/VBtn", () => ({
  VBtn: passthroughComponent("button")
}));
vi.mock("vuetify/components/VChip", () => ({
  VChip: passthroughComponent("span")
}));
vi.mock("vuetify/components/VAlert", () => ({
  VAlert: passthroughComponent("div")
}));
vi.mock("@/components/studio/vibe64-session/Vibe64AutopilotPromptTextarea.vue", () => ({
  default: defineComponent({
    inheritAttrs: false,
    setup(_props, { attrs, slots }) {
      return () => h("div", [
        h("textarea", {
          "aria-label": attrs.label,
          disabled: attrs.disabled
        }, attrs.modelValue),
        slots.footer?.()
      ]);
    }
  })
}));
vi.mock("@jskit-ai/assistant-core/client/conversation", () => ({
  LongTextPreviewBlocks: defineComponent({
    props: { blocks: { required: true, type: Array } },
    setup(props) {
      return () => h("div", props.blocks.map((block) => block.text).join("\n"));
    }
  })
}));

import Vibe64SourceExplanationPanel from "../../src/components/studio/vibe64-session/Vibe64SourceExplanationPanel.vue";

const panelPath = fileURLToPath(new URL(
  "../../src/components/studio/vibe64-session/Vibe64SourceExplanationPanel.vue",
  import.meta.url
));
const { descriptor } = parse(readFileSync(panelPath, "utf8"), { filename: panelPath });
const panelScript = compileScript(descriptor, { id: "source-explanation-ui-test" });
Vibe64SourceExplanationPanel.render = new Function("Vue", compile(descriptor.template.content, {
  bindingMetadata: panelScript.bindings,
  mode: "function",
  prefixIdentifiers: true
}).code)(VueRuntime);

function passthroughComponent(element) {
  return defineComponent({
    inheritAttrs: false,
    setup(_props, { attrs, slots }) {
      return () => h(element, attrs, slots.default?.());
    }
  });
}

async function renderExplanationPanel(props = {}) {
  const app = createSSRApp(Vibe64SourceExplanationPanel, props);
  app.component("VBtn", passthroughComponent("button"));
  app.component("VChip", passthroughComponent("span"));
  app.component("VAlert", passthroughComponent("div"));
  return renderToString(app);
}

const cachedExplanation = {
  agentThreadId: "",
  body: "This handles startup.",
  engine: "agent-cache",
  id: "exp-cache",
  sourceRange: { path: "src/app.js", startLine: 1 },
  status: "ready"
};

describe("source explanation Material interaction", () => {
  it.each([
    { answer: "body", explanation: cachedExplanation },
    {
      answer: "completed message",
      explanation: {
        ...cachedExplanation,
        body: "",
        messages: [{
          id: "assistant-cache",
          role: "assistant",
          status: "complete",
          text: cachedExplanation.body
        }]
      }
    }
  ])("offers follow-ups for a cached $answer without an agent thread", async ({ explanation }) => {
    const html = await renderExplanationPanel({ explanation, followup: "Why?" });

    expect(html).toContain(cachedExplanation.body);
    expect(html).toContain('<form class="vibe64-source-explanation__followup"');
    expect(html).toContain('aria-label="Ask about this explanation"');
    expect(html).toMatch(/<button[^>]*aria-label="Send follow-up"/u);
    expect(html).not.toContain("No explanation was produced");
    expect(html).not.toContain(" disabled");
  });

  it("keeps a busy cached follow-up disabled with a stop action", async () => {
    const html = await renderExplanationPanel({
      busy: true,
      explanation: { ...cachedExplanation, status: "running" },
      followup: "Why?"
    });

    expect(html).toMatch(/<textarea[^>]*disabled/u);
    expect(html).toMatch(/<button[^>]*aria-label="Send follow-up"[^>]*disabled/u);
    expect(html).toContain('aria-label="Stop explanation"');
    expect(html).not.toContain("Retry explanation");
  });

  it("keeps a cached answer readable when its assistant is unavailable", async () => {
    const html = await renderExplanationPanel({
      assistantAvailable: false,
      assistantUnavailableMessage: "Reconnect the assistant account.",
      explanation: cachedExplanation,
      followup: "Why?"
    });

    expect(html).toContain(cachedExplanation.body);
    expect(html).toMatch(/<textarea[^>]*disabled/u);
    expect(html).toMatch(/<button[^>]*aria-label="Send follow-up"[^>]*disabled/u);
    expect(html).toContain('title="Reconnect the assistant account."');
    expect(html).not.toContain("No explanation was produced");
  });

  it.each([
    { state: "answered", explanation: cachedExplanation },
    { state: "incomplete", explanation: { ...cachedExplanation, body: "", status: "running" } }
  ])("shows a non-cancellable Closing state for $state explanations", async ({ explanation, state }) => {
    const html = await renderExplanationPanel({
      busy: true,
      closing: true,
      explanation,
      followup: "Why?"
    });
    const closeButton = html.match(/<button[^>]*aria-label="Close explanation"[^>]*>[\s\S]*?<\/button>/u)?.[0];

    expect(closeButton).toBeDefined();
    expect(closeButton).toContain("Closing…");
    expect(closeButton).toContain('aria-busy="true"');
    expect(closeButton).toContain("disabled");
    expect(html).not.toContain('aria-label="Stop explanation"');
    expect(html).not.toContain("progressbar");
    if (state === "answered") {
      expect(html).toContain(cachedExplanation.body);
      expect(html).toMatch(/<textarea[^>]*disabled/u);
      expect(html).toMatch(/<button[^>]*aria-label="Send follow-up"[^>]*disabled/u);
    } else {
      expect(html).not.toContain("<form");
      expect(html).toMatch(/<button[^>]*disabled[^>]*>\s*Retry explanation\s*<\/button>/u);
    }
  });

  it.each([true, false])("restores Close retry after cleanup failure with assistant availability %s", async (assistantAvailable) => {
    const html = await renderExplanationPanel({
      assistantAvailable,
      closing: false,
      explanation: cachedExplanation,
      followup: "Why?"
    });
    const closeButton = html.match(/<button[^>]*aria-label="Close explanation"[^>]*>[\s\S]*?<\/button>/u)?.[0];

    expect(closeButton).toBeDefined();
    expect(closeButton).toContain("Close");
    expect(closeButton).not.toContain("disabled");
    expect(closeButton).not.toContain('aria-busy="true"');
    expect(html).not.toContain("Closing…");
    expect(html).toContain(cachedExplanation.body);
    if (assistantAvailable) {
      expect(html).not.toContain(" disabled");
    } else {
      expect(html).toMatch(/<textarea[^>]*disabled/u);
    }
  });

  it("keeps incomplete cached answers in recovery with cancellation while busy", async () => {
    const explanation = {
      ...cachedExplanation,
      body: "",
      messages: [{ id: "assistant-cache", role: "assistant", status: "thinking", text: "" }],
      status: "running"
    };
    const busy = await renderExplanationPanel({ busy: true, explanation });
    const stopped = await renderExplanationPanel({
      explanation: { ...explanation, status: "stopped" }
    });

    expect(busy).not.toContain("<form");
    expect(busy).toContain("Waiting for the explanation…");
    expect(busy).toContain('aria-label="Stop explanation"');
    expect(stopped).not.toContain("<form");
    expect(stopped).toContain("Retry explanation");
  });

  it.each(["", "thread-cache-followup"])("offers retry for a failed cached conversation with thread '%s'", async (agentThreadId) => {
    const html = await renderExplanationPanel({
      explanation: { ...cachedExplanation, agentThreadId, status: "failed" },
      followup: "Why?"
    });

    expect(html).toContain(cachedExplanation.body);
    expect(html).not.toContain("<form");
    expect(html).toContain("Retry explanation");
  });

  it("uses a stable pending action instead of a loading spinner", () => {
    const editor = readFileSync(new URL(
      "../../src/components/studio/vibe64-session/Vibe64SessionSourceEditor.vue",
      import.meta.url
    ), "utf8");
    const explainButton = editor.match(
      /<v-btn\s+class="vibe64-source-editor__explain-button"[\s\S]*?<\/v-btn>/u
    )?.[0] || "";

    expect(explainButton).toContain(":aria-busy=");
    expect(explainButton).toContain("!assistantAvailable");
    expect(explainButton).toContain("assistantUnavailableMessage");
    expect(explainButton).toContain("Working…");
    expect(explainButton).not.toContain(":loading=");
    expect(editor).toContain("min-inline-size: 6.25rem");
  });

  it("honors reduced-motion preferences for the thinking status", () => {
    const panel = readFileSync(new URL(
      "../../src/components/studio/vibe64-session/Vibe64SourceExplanationPanel.vue",
      import.meta.url
    ), "utf8");

    expect(panel).toContain("@media (prefers-reduced-motion: reduce)");
    expect(panel).toContain("animation: none");
  });

  it("keeps every icon-only explanation action explicitly named", () => {
    const panel = readFileSync(new URL(
      "../../src/components/studio/vibe64-session/Vibe64SourceExplanationPanel.vue",
      import.meta.url
    ), "utf8");

    expect(panel).toContain('aria-label="Close explanation"');
    expect(panel.match(/aria-label="Stop explanation"/gu)).toHaveLength(2);
    expect(panel).toContain('aria-label="Send follow-up"');
    expect(panel).toContain('aria-label="Collapse explanation"');
    expect(panel).toContain(".vibe64-source-explanation__action-target");
    expect(panel).toContain("min-block-size: 3rem");
    expect(panel).toContain("min-inline-size: 3rem");
  });

  it("keeps cancellation available throughout a busy follow-up", () => {
    const panel = readFileSync(new URL(
      "../../src/components/studio/vibe64-session/Vibe64SourceExplanationPanel.vue",
      import.meta.url
    ), "utf8");
    const followupFooter = panel.match(
      /<div class="vibe64-source-explanation__followup-footer">[\s\S]*?<\/div>/u
    )?.[0] || "";

    expect(followupFooter).toContain('v-if="busy && !closing"');
    expect(followupFooter).toContain('aria-label="Stop explanation"');
    expect(followupFooter).toContain("!assistantAvailable");
    expect(followupFooter).not.toContain('v-if="thinking"');
  });

  it("keeps existing explanations readable while disabling new AI work", () => {
    const editor = readFileSync(new URL(
      "../../src/components/studio/vibe64-session/Vibe64SessionSourceEditor.vue",
      import.meta.url
    ), "utf8");
    const panel = readFileSync(new URL(
      "../../src/components/studio/vibe64-session/Vibe64SourceExplanationPanel.vue",
      import.meta.url
    ), "utf8");

    expect(editor).toContain(':assistant-available="assistantAvailable"');
    expect(editor).toContain("if (!props.assistantAvailable)");
    expect(panel).toContain(':disabled="busy || closing || !assistantAvailable"');
    expect(panel).toContain(':disabled="!followup.trim() || busy || closing || !assistantAvailable"');
    expect(panel).not.toContain('v-if="assistantAvailable" class="vibe64-source-explanation__thread"');
  });

  it("restores focus when the explanation is collapsed, expanded, or closed", () => {
    const editor = readFileSync(new URL(
      "../../src/components/studio/vibe64-session/Vibe64SessionSourceEditor.vue",
      import.meta.url
    ), "utf8");
    const panel = readFileSync(new URL(
      "../../src/components/studio/vibe64-session/Vibe64SourceExplanationPanel.vue",
      import.meta.url
    ), "utf8");

    expect(editor).toContain('ref="sourceEditorElement"');
    expect(editor).toContain('@close="closeExplanationPanel"');
    expect(editor).toContain("explanationFocusTimer = setTimeout(() =>");
    expect(editor).toContain("clearTimeout(explanationFocusTimer)");
    expect(editor).toContain("sourceEditorUnmounted = true");
    expect(editor).toContain('focusAfterLayout(rootElement, ".vibe64-source-editor__side-rail--right")');
    expect(editor).toContain('focusAfterLayout(rootElement, ".vibe64-source-explanation__range")');
    expect(editor).toContain('focusAfterLayout(rootElement, ".vibe64-source-editor__explain-button")');
    expect(panel).toContain("emit('collapse', $event)");
    expect(panel).toContain("emit('close', $event)");
    expect(panel).toContain('tabindex="0"');
    expect(panel).toContain(".vibe64-source-explanation__thread:focus-visible");
  });
});
