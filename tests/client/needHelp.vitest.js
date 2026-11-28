import { readFileSync } from "node:fs";
import { createRenderer, ssrContextKey } from "vue";
import { afterEach, expect, it, vi } from "vitest";

// Each command the dialog makes, and what it sent: its method, path and body.
const mocks = vi.hoisted(() => ({ commands: [], sent: [] }));
vi.mock("@jskit-ai/http-web/client/composables/useCommand", () => ({
  useCommand: (options) => {
    mocks.commands.push(options);
    return {
      async run() {
        mocks.sent.push({ ...options.buildCommandOptions(), body: options.buildRawPayload(), placementSource: options.placementSource });
        return { ok: true };
      }
    };
  }
}));
import { NEED_HELP_STILL_OPEN_MS } from "@local/vibe64-terminals/shared/needHelp";
import { vibe64NeedHelpPresentation, vibe64SessionNeedHelp } from "../../src/lib/vibe64NeedHelp.js";
import NeedHelpDialog from "../../src/components/studio/vibe64-session/Vibe64NeedHelpDialog.vue";

// How a session shows its Need help (its tab, its header and the dialog), and what the dialog sends.

const RAISED = Date.parse("2026-11-28T19:00:00.000Z");
const request = (at, text = "The database is locked.") => ({ at: new Date(at).toISOString(), from: "agent", author: "", kind: "request", text });
const flag = (messages, forwarded = null) => ({ schema: "vibe64.need-help.v1", id: "f-1", raisedAt: messages[0].at, raisedBy: "agent", messages, forwarded });
const session = (stored) => ({ sessionId: "s-1", metadata: stored ? { need_help: JSON.stringify(stored) } : {} });

let app;
let emitted;
function mount(props) {
  emitted = [];
  const renderer = createRenderer({ createComment: (text) => ({ text }), insert() {}, remove() {}, parentNode() {}, nextSibling() {} });
  app = renderer.createApp({ ...NeedHelpDialog, render: () => null }, {
    ...props,
    onClose: () => emitted.push("close"),
    onChanged: () => emitted.push("changed")
  });
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount({});
  return app._instance.setupState;
}
afterEach(() => {
  app?.unmount();
  mocks.commands.length = 0;
  mocks.sent.length = 0;
});

it("reads a session's Need help from its record, and says when its request has waited 15 minutes unanswered", () => {
  expect(vibe64SessionNeedHelp(session(null))).toBeNull();
  expect(vibe64SessionNeedHelp({ sessionId: "s-1", metadata: { need_help: "{not json" } })).toBeNull();
  const open = vibe64SessionNeedHelp(session(flag([request(RAISED)])));
  expect(open.messages).toHaveLength(1);
  expect(vibe64NeedHelpPresentation(null, RAISED)).toBeNull();
  expect(vibe64NeedHelpPresentation(open, RAISED + NEED_HELP_STILL_OPEN_MS - 1)).toMatchObject({ label: "Need help", color: "warning", stillOpen: false });
  expect(vibe64NeedHelpPresentation(open, RAISED + NEED_HELP_STILL_OPEN_MS)).toEqual({
    label: "Need help · no answer yet",
    color: "error",
    stillOpen: true,
    title: "Still open: nobody has answered this request for 15 minutes. Open it to answer, or to add what you know."
  });
  // An answer stops the clock; a later request starts it again, from that request.
  const answered = flag([request(RAISED), { ...request(RAISED + 60_000, "Ended the lock."), from: "person", author: "ada", kind: "answer" }]);
  expect(vibe64NeedHelpPresentation(answered, RAISED + 60 * 60_000)).toMatchObject({ label: "Need help · answered", stillOpen: false });
  const reopened = flag([...answered.messages, request(RAISED + 30 * 60_000, "Still locked.")]);
  expect(vibe64NeedHelpPresentation(reopened, RAISED + 44 * 60_000).stillOpen).toBe(false);
  expect(vibe64NeedHelpPresentation(reopened, RAISED + 45 * 60_000).stillOpen).toBe(true);
});

it("answers, adds to and clears the session's Need help through its session routes, and asks for help without one", async () => {
  const sessionsApiPath = "/api/app/shop/vibe64/sessions";
  const state = mount({ session: session(flag([request(RAISED)], { state: "sent", at: request(RAISED).at, to: "the operator", reference: "PR-1", message: "" })), sessionsApiPath });
  expect(state.forwardText).toBe("Sent to the operator (reference PR-1).");
  // Nothing to send yet, or too much: nothing is sent.
  await state.run("answer");
  state.text = "x".repeat(2001);
  expect(state.tooLong).toBe(true);
  await state.run("answer");
  expect(mocks.sent).toEqual([]);
  state.text = "  I ended pid 4711; try again.  ";
  await state.run("answer");
  state.text = "Ask again if it comes back.";
  await state.run("raise");
  await state.run("clear");
  expect(mocks.sent).toEqual([
    { method: "POST", path: `${sessionsApiPath}/s-1/need-help/answer`, body: { text: "I ended pid 4711; try again." }, placementSource: "vibe64.sessions.need-help.answer" },
    { method: "POST", path: `${sessionsApiPath}/s-1/need-help`, body: { text: "Ask again if it comes back." }, placementSource: "vibe64.sessions.need-help.raise" },
    { method: "DELETE", path: `${sessionsApiPath}/s-1/need-help`, body: {}, placementSource: "vibe64.sessions.need-help.clear" }
  ]);
  expect(emitted).toEqual(["changed", "changed", "changed", "close"]);
  expect(state.text).toBe("");
  app.unmount();
  app = null;

  const fresh = mount({ session: session(null), sessionsApiPath });
  expect(fresh.flag).toBeNull();
  expect(fresh.presentation).toBeNull();
});

it("shows Need help on each session's tab and in the session header, and says it in the guide", () => {
  const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
  const toolbar = read("src/components/studio/vibe64-session/Vibe64SessionToolbar.vue");
  const header = read("src/components/studio/vibe64-session/Vibe64AutopilotSessionHeader.vue");
  expect(toolbar).toContain('v-if="needHelpPresentation(sessionItem)"');
  expect(toolbar).toContain('{{ needHelpPresentation(sessionItem) ? "Open Need help" : "Ask for help" }}');
  expect(header).toMatch(/<v-chip\s+v-if="needHelp"\s+class="studio-autopilot__need-help-chip studio-autopilot__header-fixed"/u);
  expect(read("docs/colleague-usage/need-help.md")).toContain("**Need help · no answer yet**: nobody has answered its newest request for 15");
});
