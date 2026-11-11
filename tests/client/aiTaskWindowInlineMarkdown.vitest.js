// What a task says about its problem often names things as Markdown inline code, such as a Stack's
// `## Deployment` section. The AI task window shows those as code, as the conversation does, and
// never as literal backticks; a tooltip that repeats a line keeps its raw text.
import { createSSRApp, defineComponent, h } from "vue";
import { renderToString } from "@vue/server-renderer";
import { createVuetify } from "vuetify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projectAiTask } from "../../packages/vibe64-ai-tasks/src/client/aiTaskProjection.js";
import Vibe64AiTaskWindow from "../../packages/vibe64-ai-tasks/src/client/Vibe64AiTaskWindow.vue";

// The dialog's overlay renders nothing on a server; this one shows its content while open.
vi.mock("vuetify/components/VDialog", async () => {
  const { defineComponent: define, h: render } = await import("vue");
  return {
    VDialog: define({
      inheritAttrs: false,
      props: { modelValue: Boolean },
      setup: (props, { slots }) => () => render("div", { "data-dialog": "" }, props.modelValue ? slots.default?.() : [])
    })
  };
});

const SUMMARY = "Publish check: Publish can't start: the `## Deployment` section has no `- Runtimes:` line.";
const SHOWN_SUMMARY = "Publish check: Publish can't start: the ## Deployment section has no - Runtimes: line.";

function task(fields = {}) {
  return {
    id: "task-1", kind: "publish", title: "Fix Publish", noun: "fix", tray: "Fixing Publish…",
    steps: ["The AI repairs what stopped Publish", "Vibe64 checks Publish"],
    check: { by: "vibe64", label: "Checking Publish…", retryLimit: 3, output: "", unstoppable: "", whileAiWorks: null },
    revision: 1, phase: "working", active: true, reason: "", message: "", waiting: false, checkRunning: false,
    mainChatSince: "", problem: { key: "publish", summary: SUMMARY, details: "" }, conflictReview: "", conflictPaths: [],
    startedBy: null, endedBy: null, attempt: 1, report: "", log: [], diagnostic: "",
    ...fields
  };
}

/** The window as a server would render it, for a task in the state its fields give. */
async function render(fields) {
  const shown = task(fields);
  const noop = () => {};
  const source = {
    task: shown, projection: projectAiTask(shown, { viewerId: "ana" }), open: true, view: "progress",
    cancelRequested: false, closing: false, transcriptOpen: false, error: "",
    setView: noop, setTranscript: noop, hide: noop, cancel: async () => {}, close: async () => {}, run: noop,
    returnFocusTarget: () => null
  };
  const app = createSSRApp(defineComponent({
    render: () => h(Vibe64AiTaskWindow, { source, commentary: [], output: false })
  }));
  app.use(createVuetify({ ssr: true }));
  return (await renderToString(app)).replace(/<!--[\s\S]*?-->/g, "");
}

const decode = text => text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'")
  .replace(/&amp;/g, "&");
const visibleText = html => decode(html.replace(/<[^>]*>/g, ""));

/** The opening tag's attributes and the inner HTML of the first element `pattern` finds. */
function element(html, pattern) {
  const found = html.match(pattern);
  expect(found, `no element matches ${pattern}`).not.toBeNull();
  return { attributes: found[1], inner: found[2] };
}

function expectInlineCode(inner, ...codes) {
  for (const code of codes) expect(inner).toMatch(new RegExp(`<code[^>]*>${code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</code>`));
  expect(visibleText(inner)).not.toContain("`");
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the AI task window shows a task's Markdown inline code as code", () => {
  it("in the problem line, whose tooltip keeps the raw summary", async () => {
    const html = await render();
    const line = element(html, /<span class="ai-task__problem-line"([^>]*)>([\s\S]*?)<\/span><\/div>/);
    expectInlineCode(line.inner, "## Deployment", "- Runtimes:");
    expect(visibleText(line.inner)).toBe(SHOWN_SUMMARY);
    expect(decode(line.attributes.match(/ title="([^"]*)"/)[1])).toBe(SUMMARY);
  });

  it("in the status line and the explanation under the steps when its check is stuck", async () => {
    const html = await render({
      phase: "needs_you", reason: "check_stuck",
      message: "Publish still can't start: `## Deployment` names no runtime.",
      diagnostic: "Nothing has run `vibe64-helper pages data notes <file>` yet."
    });
    const status = element(html, /<p([^>]*data-vibe64-ai-task-status[^>]*)>([\s\S]*?)<\/p>/);
    expectInlineCode(status.inner, "## Deployment");
    expect(visibleText(status.inner).trim()).toBe("Publish still can't start: ## Deployment names no runtime.");
    const note = element(html, /<p([^>]*class="ai-task-progress__note"[^>]*)>([\s\S]*?)<\/p>/);
    expectInlineCode(note.inner, "vibe64-helper pages data notes &lt;file&gt;");
    expect(visibleText(note.inner)).toBe("Nothing has run vibe64-helper pages data notes <file> yet.");
  });

  it("in the outcome's problem, what happened and what the AI did", async () => {
    const html = await render({
      phase: "done", active: false, message: "Publish can start: `## Deployment` is complete.",
      report: "Added `- Runtimes: node` to `## Deployment`."
    });
    const outcome = element(html, /<div class="ai-task-outcome"([^>]*)>([\s\S]*?)<\/div>/).inner;
    const [problem, happened, report] = [...outcome.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map(([, inner]) => inner);
    expectInlineCode(problem, "## Deployment", "- Runtimes:");
    expect(visibleText(problem)).toBe(SHOWN_SUMMARY);
    expectInlineCode(happened, "## Deployment");
    expect(visibleText(happened)).toBe("Publish can start: ## Deployment is complete.");
    expectInlineCode(report, "- Runtimes: node", "## Deployment");
    expect(visibleText(report)).toBe("Added - Runtimes: node to ## Deployment.");
  });
});
