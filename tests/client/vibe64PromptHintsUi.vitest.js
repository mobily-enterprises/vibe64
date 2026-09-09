import fs from "node:fs";
import path from "node:path";
import { compile } from "@vue/compiler-dom";
import { compileScript, parse } from "@vue/compiler-sfc";
import * as VueRuntime from "vue";
import {
  createRenderer,
  defineComponent,
  h,
  nextTick,
  reactive,
  ssrContextKey
} from "vue";
import { describe, expect, it, vi } from "vitest";

vi.mock("vuetify/lib/components/VBtn/index.mjs", () => ({
  VBtn: defineComponent({ render: () => null })
}));

vi.mock("vuetify/lib/components/VIcon/index.mjs", () => ({
  VIcon: defineComponent({ render: () => null })
}));

import Vibe64PromptHints from "../../src/components/studio/vibe64-session/Vibe64PromptHints.vue";

const hintComponentPath = path.resolve(
  "src/components/studio/vibe64-session/Vibe64PromptHints.vue"
);
const autopilotPath = path.resolve(
  "src/components/studio/vibe64-session/Vibe64AutopilotView.vue"
);
const promptTextareaPath = path.resolve(
  "src/components/studio/vibe64-session/Vibe64AutopilotPromptTextarea.vue"
);
const sessionPanelPath = path.resolve("src/components/studio/Vibe64SessionPanel.vue");
const sessionPanelComposablePath = path.resolve("src/composables/useVibe64SessionPanel.js");
const runtimeHostPath = path.resolve(
  "src/components/studio/vibe64-session/Vibe64SessionRuntimeHost.vue"
);
const hintComponentSource = fs.readFileSync(hintComponentPath, "utf8");
const { descriptor: hintDescriptor } = parse(hintComponentSource, {
  filename: hintComponentPath
});
const hintScript = compileScript(hintDescriptor, { id: "vibe64-prompt-hints-test" });
const hintTemplate = compile(hintDescriptor.template.content, {
  bindingMetadata: hintScript.bindings,
  mode: "function",
  prefixIdentifiers: true
});
Vibe64PromptHints.render = new Function("Vue", hintTemplate.code)(VueRuntime);

function passthroughComponent(element) {
  return defineComponent({
    inheritAttrs: false,
    setup(_props, { attrs, slots }) {
      return () => h(element, attrs, slots.default?.());
    }
  });
}

function testRenderer() {
  return createRenderer({
    createComment: (text) => ({ text, type: "comment" }),
    createElement: (type) => ({ children: [], parent: null, props: {}, type }),
    createText: (text) => ({ text, type: "text" }),
    insert(child, parent, anchor = null) {
      child.parent = parent;
      const index = anchor ? parent.children.indexOf(anchor) : -1;
      if (index < 0) {
        parent.children.push(child);
      } else {
        parent.children.splice(index, 0, child);
      }
    },
    nextSibling(node) {
      const index = node.parent?.children?.indexOf(node) ?? -1;
      return index >= 0 ? node.parent.children[index + 1] || null : null;
    },
    parentNode: (node) => node.parent,
    patchProp(element, key, _previous, value) {
      element.props[key] = value;
    },
    remove(child) {
      const index = child.parent?.children?.indexOf(child) ?? -1;
      if (index >= 0) {
        child.parent.children.splice(index, 1);
      }
    },
    setElementText(element, text) {
      element.text = text;
    },
    setText(node, text) {
      node.text = text;
    }
  });
}

function findNodes(root, predicate, matches = []) {
  if (predicate(root)) {
    matches.push(root);
  }
  for (const child of root.children || []) {
    findNodes(child, predicate, matches);
  }
  return matches;
}

function nodeText(node) {
  return [node?.text, ...(node?.children || []).map(nodeText)]
    .filter(Boolean)
    .join("");
}

function mountPromptHints(input = {}) {
  const state = reactive({
    assistantLabel: "",
    loading: false,
    statusId: "prompt-hint-status",
    suggestions: [],
    ...input
  });
  const events = {
    dismiss: vi.fn(),
    focusout: vi.fn(),
    preview: vi.fn(),
    select: vi.fn()
  };
  const Root = defineComponent({
    setup() {
      return () => h(Vibe64PromptHints, {
        ...state,
        onDismiss: events.dismiss,
        onFocusout: events.focusout,
        onPreview: events.preview,
        onSelect: events.select
      });
    }
  });
  const container = { children: [], parent: null, type: "root" };
  const app = testRenderer().createApp(Root);
  app.component("VBtn", passthroughComponent("button"));
  app.component("VIcon", passthroughComponent("span"));
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount(container);
  return { app, container, events, state };
}

describe("Vibe64 prompt hints UI", () => {
  it("uses one minimal icon-led short-label rail with a persistent footprint", () => {
    const component = hintComponentSource;

    expect(component).toContain("mdiLightbulbOnOutline");
    expect(component).not.toContain("vibe64-prompt-hints__label");
    expect(component).not.toContain("<span>Suggestions</span>");
    expect(component).toContain('v-for="suggestion in suggestions"');
    expect(component).toContain(':aria-label="`Use suggestion: ${suggestion.prompt}`"');
    expect(component).toContain("{{ suggestion.label }}");
    expect(component).not.toContain(':title="suggestion"');
    expect(component).toContain('aria-orientation="horizontal"');
    expect(component).toContain('rounded="xl"');
    expect(component).toContain('size="small"');
    expect(component).toContain('variant="tonal"');
    expect(component).not.toContain("\n          block\n");
    expect(component).not.toContain("height: 0;");
    expect(component).toContain("height: 2.25rem;");
    expect(component).toContain("grid-template-columns: 1.25rem minmax(0, 1fr);");
    expect(component).toContain("display: flex;");
    expect(component).toContain("height: 100%;");
    expect(component).toContain("overflow-x: auto;");
    expect(component).toContain("overflow-y: hidden;");
    expect(component).toContain("flex: 0 0 auto;");
    expect(component).not.toContain(":deep(.v-btn__content)");
    expect(component).toContain("white-space: nowrap;");
    expect(component).toContain("@media (prefers-reduced-motion: reduce)");
    expect(component).not.toMatch(/v-progress|spinner|circular-progress/iu);
  });

  it("shows a stable pending label without creating a transcript message", () => {
    const component = hintComponentSource;
    const autopilot = fs.readFileSync(autopilotPath, "utf8");

    expect(component).toContain("Thinking of a few ideas");
    expect(component).toContain('aria-live="polite"');
    expect(component).not.toContain("vibe64-prompt-hints__typing");
    expect(autopilot).toContain("<Vibe64PromptHints");
    expect(autopilot.indexOf("<Vibe64PromptHints")).toBeGreaterThan(
      autopilot.indexOf("<Vibe64ConversationLog")
    );
    expect(autopilot.indexOf("<Vibe64PromptHints")).toBeLessThan(
      autopilot.indexOf('class="studio-autopilot__composer"')
    );
    expect(autopilot.indexOf("<Vibe64PromptHints")).toBeLessThan(
      autopilot.indexOf("<Vibe64TemporaryAiWorkspace")
    );
    expect(component).toContain("grid-row: 4;");
    expect(autopilot).toContain("grid-row: 5;");
    expect(autopilot).not.toContain("studio-autopilot__thinking-mark");
  });

  it("keeps static starters available without granting dynamic hints", () => {
    const autopilot = fs.readFileSync(autopilotPath, "utf8");
    const canRequestStart = autopilot.indexOf("const promptHintsCanRequest");
    const canRequestEnd = autopilot.indexOf(
      "const promptHintsConversationKey",
      canRequestStart
    );
    const canRequest = autopilot.slice(canRequestStart, canRequestEnd);

    expect(autopilot.indexOf("const promptHintsBlankConversation"))
      .toBeLessThan(canRequestStart);
    expect(canRequest).toMatch(
      /promptHintsBlankConversation\.value \|\| \(\s*props\.agentConnectionStatus === "connected" &&\s*assistantDirectAllowed\.value\s*\)/u
    );
  });

  it("reuses the support row for authenticated typing presence", () => {
    const autopilot = fs.readFileSync(autopilotPath, "utf8");
    const promptTextarea = fs.readFileSync(promptTextareaPath, "utf8");

    expect(autopilot).toContain("useVibe64SessionTypingPresence({");
    expect(autopilot).toContain(
      "thinkingVisible.value ? thinkingLabel.value : typingLabel.value"
    );
    expect(autopilot).toContain('event: VIBE64_SESSION_CHANGED_EVENT');
    expect(autopilot).toContain('payload.assistantProgress');
    expect(autopilot).toContain('deepseek: "DeepSeek"');
    expect(autopilot).toContain('"zai-coding-plan": "Z.AI"');
    expect(autopilot).toContain('`${openCodeProviderLabel.value} is using a tool…`');
    expect(autopilot).toContain('`${openCodeProviderLabel.value} is reasoning…`');
    expect(autopilot).toContain('"opencode-server-message-delivered"');
    expect(autopilot).toContain('"opencode-server-turn-active"');
    expect(autopilot).toContain('"opencode-server-turn-idle"');
    expect(autopilot).toContain(
      "openCodeProgressLabel.value ||"
    );
    expect(autopilot).toMatch(
      /watch\(agentActive,[\s\S]{0,120}!active[\s\S]{0,120}openCodeProgressLabel\.value = ""[\s\S]{0,80}immediate: true/u
    );
    expect(autopilot).toContain(':assistant-label="composerAssistantLabel"');
    expect(autopilot).toContain('@input-activity="noteTypingActivity"');
    expect(autopilot).toContain("stopTypingOnSubmit();");
    expect(autopilot).toContain("stopTypingOnBlur();");
    expect(promptTextarea).toContain('"input-activity"');
    expect(promptTextarea).toContain('emit("input-activity");');
  });

  it("fills and refocuses the editable composer rather than sending", () => {
    const component = hintComponentSource;
    const autopilot = fs.readFileSync(autopilotPath, "utf8");
    const promptTextarea = fs.readFileSync(promptTextareaPath, "utf8");

    expect(autopilot).toContain('@select="selectPromptHint"');
    expect(autopilot).toContain('@preview="previewPromptHint"');
    expect(autopilot).toContain(':placeholder="composerPromptHintPlaceholder"');
    expect(autopilot).toContain(
      ':placeholder-affects-height="!composerPromptHintPreview"'
    );
    expect(autopilot).toContain("promptHintPreview.value");
    expect(autopilot).toContain("composerDraft.value = suggestion;");
    expect(autopilot).toContain(
      "composerInput.value?.preserveHeightForNextModelValue?.();"
    );
    expect(autopilot.indexOf("preserveHeightForNextModelValue"))
      .toBeLessThan(autopilot.indexOf("composerDraft.value = suggestion;"));
    expect(autopilot).toContain("composerInput.value?.focus?.({ preventScroll: true });");
    expect(autopilot).not.toMatch(/function applyPromptHint[\s\S]{0,500}submitComposerMessage/gu);
    expect(promptTextarea).toContain('"attachment-state-change"');
    expect(promptTextarea).toContain('"escape"');
    expect(promptTextarea).toContain('@focus="handleTextareaFocus"');
    expect(promptTextarea).toContain('@blur="handleTextareaBlur"');
    expect(promptTextarea).toContain("focus: focusTextarea");
    expect(promptTextarea).toContain("function preserveHeightForNextModelValue()");
    expect(promptTextarea).toContain("placeholderAffectsHeight");
    expect(promptTextarea).toMatch(
      /!props\.placeholderAffectsHeight && !textarea\.value[\s\S]{0,80}return;[\s\S]{0,300}textarea\.scrollHeight/u
    );
    expect(promptTextarea).toContain("preserveHeightForNextModelValueChange = false;");
    expect(promptTextarea).toMatch(
      /function preserveHeightForNextModelValue\(\)[\s\S]{0,500}cancelAnimationFrame\(resizeFrame\)[\s\S]{0,500}getBoundingClientRect\(\)\.height[\s\S]{0,500}overflowY = "auto"/u
    );
    expect(promptTextarea).toMatch(
      /function handleTextareaInput[\s\S]{0,200}preserveHeightForNextModelValueChange = false;[\s\S]{0,300}queueResizeTextarea\(\)/u
    );
    expect(promptTextarea).toMatch(
      /preserveHeightForNextModelValueChange && modelValueChanged[\s\S]{0,200}return;[\s\S]{0,200}queueResizeTextarea\(\)/u
    );
    expect(promptTextarea).toMatch(
      /props\.modelValue,\s*props\.placeholder,\s*props\.placeholderAffectsHeight,\s*props\.rows/u
    );
    expect(autopilot).toContain('@blur="handleComposerBlur"');
    expect(autopilot).toContain('@focusout="handleComposerRegionFocusOut"');
    expect(autopilot).toContain('@dismiss="dismissPromptHintsAndFocus"');
    expect(autopilot).toContain("composerAssistantLabel.value || promptHintsVisible.value");
    expect(component).toContain('@keydown.esc.stop.prevent="$emit(\'dismiss\')"');
  });

  it("renders a persistent live status and a keyboard-operable suggestion group", async () => {
    const mounted = mountPromptHints({ loading: true });
    let statuses = findNodes(mounted.container, (node) => node.props?.role === "status");
    expect(statuses).toHaveLength(1);
    expect(statuses[0].props["aria-live"]).toBe("polite");
    expect(statuses[0].props["aria-atomic"]).toBe("true");
    expect(nodeText(statuses[0])).toBe("Thinking of a few ideas.");

    mounted.state.loading = false;
    const maximumLengthPrompt = "Set up a dashboard on the home page so I can see all my tracked projects and their status at a quick glance.";
    expect(maximumLengthPrompt).toHaveLength(108);
    mounted.state.suggestions = [
      {
        label: "Create dashboard view",
        prompt: maximumLengthPrompt
      },
      {
        label: "Explain current project",
        prompt: "Explain the current project in plain language before we decide what to change"
      },
      {
        label: "Plan small improvement",
        prompt: "Help me plan one small improvement that we can verify together"
      }
    ];
    await nextTick();

    statuses = findNodes(mounted.container, (node) => node.props?.role === "status");
    expect(statuses).toHaveLength(1);
    expect(nodeText(statuses[0])).toBe(
      "Three suggested prompts are available before the message controls."
    );
    const groups = findNodes(mounted.container, (node) => node.props?.role === "group");
    expect(groups).toHaveLength(1);
    expect(groups[0].props["aria-label"]).toBe("Suggested prompts");
    const buttons = findNodes(groups[0], (node) => node.type === "button");
    expect(buttons).toHaveLength(3);
    expect(buttons[0].props["aria-label"]).toContain(maximumLengthPrompt);
    expect(nodeText(buttons[0])).toBe("Create dashboard view");
    buttons[0].props.onMouseenter();
    expect(mounted.events.preview).toHaveBeenLastCalledWith(mounted.state.suggestions[0]);
    buttons[0].props.onMouseleave();
    expect(mounted.events.preview).toHaveBeenLastCalledWith(null);
    buttons[0].props.onFocus();
    expect(mounted.events.preview).toHaveBeenLastCalledWith(mounted.state.suggestions[0]);
    buttons[0].props.onBlur();
    expect(mounted.events.preview).toHaveBeenLastCalledWith(null);
    buttons[0].props.onClick();
    expect(mounted.events.select).toHaveBeenCalledWith(mounted.state.suggestions[0]);

    const section = findNodes(mounted.container, (node) => node.type === "section")[0];
    const keyboardEvent = {
      key: "Escape",
      preventDefault: vi.fn(),
      stopPropagation: vi.fn()
    };
    section.props.onKeydown(keyboardEvent);
    expect(keyboardEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(keyboardEvent.stopPropagation).toHaveBeenCalledTimes(1);
    expect(mounted.events.dismiss).toHaveBeenCalledTimes(1);

    const focusoutEvent = { relatedTarget: null };
    section.props.onFocusout(focusoutEvent);
    expect(mounted.events.focusout).toHaveBeenCalledWith(focusoutEvent);
    mounted.app.unmount();
  });

  it("hydrates one shared project policy and passes it through hidden runtime hosts", () => {
    const sessionPanel = fs.readFileSync(sessionPanelPath, "utf8");
    const sessionPanelComposable = fs.readFileSync(sessionPanelComposablePath, "utf8");
    const runtimeHost = fs.readFileSync(runtimeHostPath, "utf8");

    expect(sessionPanelComposable).toContain("const projectSettings = useEndpointResource({");
    expect(sessionPanelComposable).toContain("projectSettingsQueryKey(");
    expect(sessionPanel).toContain(':prompt-hint-policy="promptHintPolicy"');
    expect(runtimeHost).toContain(':prompt-hint-policy="props.promptHintPolicy"');
    expect(fs.readFileSync(autopilotPath, "utf8")).toContain(
      "sessionsApiPath: computed(() => readRefOrGetterValue(props.sessionsApiPath))"
    );
  });
});
