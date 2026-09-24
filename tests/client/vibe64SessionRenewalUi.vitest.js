import fs from "node:fs";
import path from "node:path";
import { compile } from "@vue/compiler-dom";
import { compileScript, parse } from "@vue/compiler-sfc";
import * as VueRuntime from "vue";
import { createSSRApp, defineComponent, h } from "vue";
import { renderToString } from "@vue/server-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

const renewalUiHarness = vi.hoisted(() => ({
  assistantReady: true,
  assistantSelection: {
    agentId: "codex",
    catalogRevision: `sha256:${"a".repeat(64)}`,
    engineId: "codex",
    modelId: "gpt-5.6",
    modelProviderId: "openai",
    variantId: "high"
  },
  buttons: [],
  compact: false,
  dialogAttrs: null
}));

vi.mock("vuetify", () => ({
  useDisplay: () => ({
    smAndDown: {
      __v_isRef: true,
      get value() {
        return renewalUiHarness.compact;
      }
    }
  })
}));

vi.mock("vuetify/components/VAlert", () => ({
  VAlert: passthroughComponent("aside")
}));
vi.mock("vuetify/components/VBtn", () => ({
  VBtn: passthroughComponent("button", { captureButton: true })
}));
vi.mock("vuetify/components/VCard", () => ({
  VCard: passthroughComponent("section"),
  VCardActions: passthroughComponent("footer"),
  VCardText: passthroughComponent("div"),
  VCardTitle: passthroughComponent("header")
}));
vi.mock("vuetify/components/VDialog", () => ({
  VDialog: passthroughComponent("div", { captureDialog: true })
}));
vi.mock("vuetify/components/VDivider", () => ({
  VDivider: passthroughComponent("hr")
}));
vi.mock("vuetify/components/VIcon", () => ({
  VIcon: passthroughComponent("span")
}));
vi.mock("vuetify/components/VProgressLinear", () => ({
  VProgressLinear: passthroughComponent("div")
}));
vi.mock("vuetify/components/VSheet", () => ({
  VSheet: passthroughComponent("section")
}));
vi.mock("vuetify/components/VSkeletonLoader", () => ({
  VSkeletonLoader: passthroughComponent("div")
}));
vi.mock("vuetify/components/VTextarea", () => ({
  VTextarea: passthroughComponent("div")
}));

vi.mock("@/components/studio/StudioErrorNotice.vue", () => ({
  default: passthroughComponent("section")
}));
vi.mock("@/components/studio/vibe64-session/Vibe64WorkflowSelector.vue", () => ({
  default: defineComponent({
    props: {
      active: Boolean
    },
    emits: ["update:ready", "update:selection"],
    setup(props, { emit }) {
      if (props.active) {
        emit("update:workflow", "codex");
        emit("update:ready", renewalUiHarness.assistantReady);
      }
      return () => h("section", "AI for the fresh session");
    }
  })
}));

import Vibe64SessionRenewalDialog from "../../src/components/studio/vibe64-session/Vibe64SessionRenewalDialog.vue";

const dialogPath = path.resolve(
  "src/components/studio/vibe64-session/Vibe64SessionRenewalDialog.vue"
);
const dialogSource = fs.readFileSync(dialogPath, "utf8");
const autopilotSource = fs.readFileSync(path.resolve(
  "src/components/studio/vibe64-session/Vibe64AutopilotView.vue"
), "utf8");
const { descriptor } = parse(dialogSource, { filename: dialogPath });
const componentScript = compileScript(descriptor, {
  id: "vibe64-session-renewal-ui-test"
});
const componentTemplate = compile(descriptor.template.content, {
  bindingMetadata: componentScript.bindings,
  mode: "function",
  prefixIdentifiers: true
});
Vibe64SessionRenewalDialog.render = new Function(
  "Vue",
  componentTemplate.code
)(VueRuntime);

function slotChildren(slots = {}) {
  return Object.entries(slots).flatMap(([name, slot]) => h(
    "span",
    { "data-slot": name },
    slot?.() || []
  ));
}

function renderedAttrs(attrs = {}) {
  return Object.fromEntries(Object.entries(attrs).filter(([, value]) => (
    typeof value !== "function"
  )));
}

function passthroughComponent(element = "div", {
  captureButton = false,
  captureDialog = false
} = {}) {
  return defineComponent({
    inheritAttrs: false,
    setup(_props, { attrs, slots }) {
      if (captureDialog) {
        renewalUiHarness.dialogAttrs = attrs;
      }
      if (captureButton) {
        renewalUiHarness.buttons.push(attrs);
      }
      return () => h(element, renderedAttrs(attrs), slotChildren(slots));
    }
  });
}

function renewalModel(overrides = {}) {
  return {
    actionLabel: "",
    acceptLatestDraft: vi.fn(),
    advisoryPresentation: {
      attention: true,
      color: "warning",
      label: "Renew soon",
      reason: "This conversation is approaching its safe context limit."
    },
    busy: false,
    canConfirm: true,
    canSaveDraft: false,
    cancel: vi.fn(),
    close: vi.fn(),
    confirm: vi.fn(),
    draftCharacterCount: 0,
    draftConflict: null,
    draftDirty: false,
    draftError: "",
    draftText: "",
    draftTooLong: false,
    loadError: "",
    keepLocalDraft: vi.fn(),
    maxHandoverCharacters: 20_000,
    maintenanceError: "",
    maintenanceInProgress: false,
    maintenanceNeedsRetry: false,
    open: true,
    openSuccessor: vi.fn(),
    pendingAction: "",
    phase: "intro",
    refreshError: "",
    refreshing: false,
    reload: vi.fn(),
    renewal: null,
    requestDraft: vi.fn(),
    retry: vi.fn(),
    restoreTriggerFocus: vi.fn(),
    saveDraft: vi.fn(),
    setDraftText: vi.fn(),
    stageLabel: "Preparing the handover…",
    steps: [],
    successorSelectionError: "",
    successorSelectionPending: false,
    ...overrides
  };
}

async function renderRenewal(renewal, { compact = false } = {}) {
  renewalUiHarness.compact = compact;
  renewalUiHarness.buttons = [];
  renewalUiHarness.dialogAttrs = null;
  const app = createSSRApp(Vibe64SessionRenewalDialog, { renewal });
  app.component("VAlert", passthroughComponent("aside"));
  app.component("VBtn", passthroughComponent("button", { captureButton: true }));
  app.component("VCard", passthroughComponent("section"));
  app.component("VCardActions", passthroughComponent("footer"));
  app.component("VCardText", passthroughComponent("div"));
  app.component("VCardTitle", passthroughComponent("header"));
  app.component("VDialog", passthroughComponent("div", { captureDialog: true }));
  app.component("VDivider", passthroughComponent("hr"));
  app.component("VIcon", passthroughComponent("span"));
  app.component("VProgressLinear", passthroughComponent("div"));
  app.component("VSheet", passthroughComponent("section"));
  app.component("VSkeletonLoader", passthroughComponent("div"));
  app.component("VTextarea", passthroughComponent("div"));
  return renderToString(app);
}

beforeEach(() => {
  renewalUiHarness.assistantReady = true;
  renewalUiHarness.buttons = [];
  renewalUiHarness.compact = false;
  renewalUiHarness.dialogAttrs = null;
});

describe("session renewal dialog", () => {
  it("names the dialog semantically and shows the advisory reason without hover", async () => {
    const renewal = renewalModel();
    const html = await renderRenewal(renewal);
    const titleId = html.match(/<h2[^>]*id="([^"]+)"/u)?.[1];

    expect(titleId).toBeTruthy();
    expect(html).toContain(`aria-labelledby="${titleId}"`);
    expect(html).toContain("Renew soon");
    expect(html).toContain("This conversation is approaching its safe context limit.");
    expect(html).toContain("Prepare handover");
    expect(html).toContain("renewal completes even if the model cannot answer");
    expect(html).toContain("autofocus");
    expect(html).toContain('height="48"');
    expect(renewalUiHarness.dialogAttrs.persistent).toBe(false);
  });

  it("cannot dismiss the dialog through its model while an operation is busy", async () => {
    const renewal = renewalModel({ actionLabel: "Starting…", busy: true });
    const html = await renderRenewal(renewal);

    expect(renewalUiHarness.dialogAttrs.persistent).toBe(true);
    renewalUiHarness.dialogAttrs["onUpdate:modelValue"](false);
    expect(renewal.close).not.toHaveBeenCalled();
    expect(html).toContain("Starting…");
    expect(html).toContain("disabled");
  });

  it("restores trigger focus after Escape dismissal finishes leaving", async () => {
    const renewal = renewalModel();
    await renderRenewal(renewal);

    renewalUiHarness.dialogAttrs["onUpdate:modelValue"](false);
    expect(renewal.close).toHaveBeenCalledOnce();
    expect(renewal.restoreTriggerFocus).not.toHaveBeenCalled();

    renewalUiHarness.dialogAttrs.onAfterLeave();
    expect(renewal.restoreTriggerFocus).toHaveBeenCalledOnce();
  });

  it.each([
    ["icon", "icon close"],
    ["footer", "footer close"]
  ])("restores trigger focus after the %s close finishes leaving", async (closeKind) => {
    const renewal = renewalModel();
    await renderRenewal(renewal);
    const closeButton = renewalUiHarness.buttons.find((attrs) => (
      attrs["data-vibe64-session-renewal-close"] === closeKind
    ));

    expect(closeButton).toBeTruthy();
    closeButton.onClick();
    expect(renewal.close).toHaveBeenCalledOnce();
    expect(renewal.restoreTriggerFocus).not.toHaveBeenCalled();

    renewalUiHarness.dialogAttrs.onAfterLeave();
    expect(renewal.restoreTriggerFocus).toHaveBeenCalledOnce();
  });

  it("keeps durable progress closable while its initiating command settles", async () => {
    const renewal = renewalModel({
      actionLabel: "Renewing…",
      busy: true,
      phase: "progress",
      renewal: { sessionId: "session-1", stage: "old_quiescing", status: "running" }
    });
    const html = await renderRenewal(renewal);

    expect(renewalUiHarness.dialogAttrs.persistent).toBe(false);
    expect(html).toContain("You can close this window");
    renewalUiHarness.dialogAttrs["onUpdate:modelValue"](false);
    expect(renewal.close).toHaveBeenCalledOnce();
  });

  it("renders the Unicode-aware counter and the correct cancel pending label", async () => {
    const html = await renderRenewal(renewalModel({
      actionLabel: "Cancelling…",
      busy: true,
      draftCharacterCount: 2,
      draftText: "😀😀",
      phase: "review",
      pendingAction: "cancel",
      renewal: {
        draft: { text: "😀😀" },
        sessionId: "session-1",
        status: "review"
      }
    }));

    expect(html).toContain("2 / 20,000");
    expect(html).toContain("Cancelling…");
    expect(html).not.toContain(">Cancel renewal<");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("autofocus");
    expect(renewalUiHarness.dialogAttrs.persistent).toBe(true);
  });

  it("uses the responsive Vuetify state for a full-screen compact layout", async () => {
    const html = await renderRenewal(renewalModel(), { compact: true });

    expect(html).toContain("studio-session-renewal--fullscreen");
    expect(html).toContain("studio-session-renewal__actions--compact");
    expect(html).toContain('rounded="0"');
    expect(renewalUiHarness.dialogAttrs.fullscreen).toBe(true);
  });

  it("focuses the recovery action in each actionable error state", async () => {
    const loadError = await renderRenewal(renewalModel({
      loadError: "offline",
      phase: "load_error"
    }));
    const failed = await renderRenewal(renewalModel({
      phase: "failed",
      renewal: { error: { message: "Try again.", retryable: true } }
    }));

    expect(loadError).toMatch(/<button autofocus[^>]*>[\s\S]*?Try again[\s\S]*?<\/button>/u);
    expect(failed).toMatch(/<button autofocus[^>]*>[\s\S]*?Retry[\s\S]*?<\/button>/u);
  });

  it("describes every failed renewal as leaving the predecessor available", async () => {
    const html = await renderRenewal(renewalModel({
      phase: "failed",
      renewal: {
        error: { message: "Try again.", retryable: true }
      }
    }));

    expect(html).toContain("The old session remains available.");
    expect(html).not.toContain("safely archived");
  });

  it("reports retained recovery without promising availability after restore failure", async () => {
    const html = await renderRenewal(renewalModel({
      phase: "failed",
      renewal: {
        error: {
          code: "vibe64_session_renewal_restore_failed",
          message: "Writable restoration unavailable.",
          retryable: true
        }
      }
    }));

    expect(html).toContain("recovery state are retained");
    expect(html).toContain("not writable yet");
    expect(html).not.toContain("remains available");
  });

  it("uses public component seams and removes motion instead of slowing it", () => {
    expect(dialogSource).not.toContain(":deep(");
    expect(dialogSource).not.toContain("@media (max-width:");
    expect(dialogSource).toContain(":fullscreen=\"smAndDown\"");
    expect(dialogSource).toContain("@media (prefers-reduced-motion: reduce)");
    expect(dialogSource).toMatch(/prefers-reduced-motion:[\s\S]*?__progress-line[\s\S]*?display: none/u);
    expect(dialogSource).not.toContain("animation-duration:");
  });

  it("keeps pending labels on the action that owns them", async () => {
    const saving = await renderRenewal(renewalModel({
      actionLabel: "Saving…",
      busy: true,
      canSaveDraft: false,
      pendingAction: "save",
      phase: "review",
      renewal: { draft: { text: "Draft" }, sessionId: "session-1", status: "review" }
    }));
    const confirming = await renderRenewal(renewalModel({
      actionLabel: "Saving…",
      busy: true,
      pendingAction: "confirm",
      phase: "review",
      renewal: { draft: { text: "Draft" }, sessionId: "session-1", status: "review" }
    }));

    expect(saving).toContain("Saving…");
    expect(saving).toContain('aria-busy="true"');
    expect(saving).toContain("Renew session");
    expect(confirming).toContain("Save draft");
    expect(confirming).toContain("Saving…");
    expect(confirming).toContain('aria-busy="true"');
  });

  it("confirms with the exact ready assistant selected for the fresh session", async () => {
    const renewal = renewalModel({
      phase: "review",
      renewal: { draft: { text: "Draft" }, sessionId: "session-1", status: "review" }
    });
    await renderRenewal(renewal);
    const confirmButton = renewalUiHarness.buttons.find((attrs) => (
      String(attrs.class || "").includes("studio-session-renewal__action--primary") &&
      attrs.variant === "flat"
    ));

    expect(confirmButton).toBeTruthy();
    expect(confirmButton.disabled).toBe(false);
    confirmButton.onClick();
    expect(renewal.confirm).toHaveBeenCalledWith("codex");
  });

  it("cannot confirm while the fresh-session assistant choice is unresolved", async () => {
    renewalUiHarness.assistantReady = false;
    const html = await renderRenewal(renewalModel({
      phase: "review",
      renewal: { draft: { text: "Draft" }, sessionId: "session-1", status: "review" }
    }));

    expect(html).toMatch(/Renew session[\s\S]*?disabled|disabled[\s\S]*?Renew session/u);
  });

  it("makes concurrent handover edits explicit without discarding either version", async () => {
    const html = await renderRenewal(renewalModel({
      canConfirm: false,
      canSaveDraft: false,
      draftConflict: {
        identity: "2:hash",
        text: "Newer remote handover"
      },
      draftText: "My unsaved handover",
      phase: "review",
      renewal: { draft: { text: "Newer remote handover" }, sessionId: "session-1", status: "review" }
    }));

    expect(html).toContain("This handover changed elsewhere");
    expect(html).toContain("Your unsaved edits are still here.");
    expect(html).toContain("Keep my edits");
    expect(html).toContain("Discard my edits and use latest");
    expect(html).toMatch(/Save draft[\s\S]*?disabled|disabled[\s\S]*?Save draft/u);
    expect(html).toMatch(/Renew session[\s\S]*?disabled|disabled[\s\S]*?Renew session/u);
  });

  it("keeps validation beside the handover field and makes discarding edits explicit", async () => {
    const html = await renderRenewal(renewalModel({
      canConfirm: false,
      canSaveDraft: false,
      draftDirty: true,
      draftError: "The Saved source commit must match exactly.",
      draftText: "Locally edited handover",
      phase: "review",
      renewal: { draft: { text: "Draft" }, sessionId: "session-1", status: "review" }
    }));

    expect(html).toContain("The Saved source commit must match exactly.");
    expect(html).toContain("Unsaved edits are kept in this browser tab");
    expect(html).toContain("Discard edits and cancel");
  });

  it("guides a manual handover with the exact Saved source envelope", async () => {
    const commit = "a".repeat(40);
    const html = await renderRenewal(renewalModel({
      draftText: "# Session handover",
      phase: "review",
      renewal: {
        basis: {
          source: {
            authority: "github",
            commit,
            ref: "refs/heads/main",
            repository: "https://github.com/example/project.git"
          }
        },
        draft: { origin: "manual", text: "# Session handover" },
        error: { message: "The generated handover could not be verified." },
        sessionId: "session-1",
        status: "review"
      }
    }));

    expect(html).toContain("Complete the handover template");
    expect(html).toContain("Fill in every section");
    expect(html).toContain("keep the Saved source details unchanged");
    expect(html).toContain("Saved source details to preserve");
    expect(html).toContain("https://github.com/example/project.git");
    expect(html).toContain("refs/heads/main");
    expect(html).toContain(commit);
  });

  it("announces the active renewal step and presents stale progress as a retryable snapshot", async () => {
    const html = await renderRenewal(renewalModel({
      phase: "progress",
      refreshError: "offline",
      steps: [
        { id: "handover", label: "Prepare the handover", state: "complete" },
        { id: "successor", label: "Create the fresh session", state: "active" },
        { id: "briefing", label: "Brief the fresh assistant", state: "pending" }
      ]
    }));

    expect(html).toContain("Latest progress could not be checked");
    expect(html).toContain("Check again");
    expect(html).toContain('aria-current="step"');
    expect(html).toContain("Current step");
    expect(html).toContain("Complete");
    expect(html).toContain("Not started");
    expect(html).toContain('aria-live="off"');
  });

  it("allows an explicit retry of a saved failure marked non-retryable", async () => {
    const model = renewalModel({
      phase: "failed",
      renewal: {
        stage: "draft_generating",
        status: "failed",
        error: { message: "Save this session before renewing it.", retryable: false }
      }
    });
    const html = await renderRenewal(model);

    expect(html).toContain("retry the same saved renewal");
    expect(html).not.toContain("cannot be retried");
    const retry = renewalUiHarness.buttons.find((button) => button.onClick === model.retry);
    expect(retry).toHaveProperty("autofocus");
    expect(retry.disabled).toBe(false);
    retry.onClick();
    expect(model.retry).toHaveBeenCalledOnce();
  });

  it("keeps opening a completed successor actionable after automatic navigation fails", async () => {
    const html = await renderRenewal(renewalModel({
      phase: "completed",
      successorSelectionError: "Session list is temporarily unavailable."
    }));

    expect(html).toContain("The fresh session could not be opened automatically");
    expect(html).toContain("Open fresh session");
    expect(html).toContain("autofocus");
  });

  it("keeps a completed renewal successful while making failed cleanup retryable", async () => {
    const html = await renderRenewal(renewalModel({
      maintenanceError: "The old preview process did not stop.",
      maintenanceNeedsRetry: true,
      phase: "completed",
      renewal: {
        maintenance: {
          error: { message: "The old preview process did not stop." },
          status: "failed"
        },
        status: "completed"
      }
    }));

    expect(html).toContain("The fresh session is ready.");
    expect(html).toContain("Cleanup needs retry");
    expect(html).toContain("The old preview process did not stop.");
    expect(html).toContain("Retry cleanup");
    expect(html).toContain("Open fresh session");
  });

  it("makes the advisory available by tap with full-size header targets", () => {
    expect(autopilotSource).toContain(":title=\"sessionRenewalActionPresentation.reason\"");
    expect(autopilotSource).toContain('ref="sessionActionsTrigger"');
    expect(autopilotSource).toContain('@click="requestSessionRenewal(sessionActionsTrigger)"');
    expect(autopilotSource).toContain('@click="requestSessionRenewal($event.currentTarget)"');
    expect(autopilotSource).toContain("returnFocusTarget: returnFocusTarget?.$el || returnFocusTarget");
    expect(autopilotSource).toMatch(/height="48"[\s\S]*?:icon="mdiAutorenew"[\s\S]*?width="48"/u);
    expect(autopilotSource).toMatch(/:aria-label="temporaryAiHasUnreadMessages[^"\n]+"[\s\S]*?height="48"[\s\S]*?width="48"/u);
    expect(autopilotSource).toContain(":aria-label=\"sessionActionsLabel\"");
    expect(autopilotSource).toContain('sessionRenewalActionPresentation.value.attention ? sessionRenewalActionPresentation.value.label : ""');
    expect(autopilotSource).toContain('].filter(Boolean).join(": ")');
    expect(autopilotSource).toContain(':icon="mdiDotsVertical"');
    expect(autopilotSource).toContain('title="Temporary AI"');
    expect(autopilotSource).toContain("studio-autopilot__session-action-item");
    expect(autopilotSource).toContain("studio-autopilot__header-actions--compact");
    expect(autopilotSource).toContain("@container studio-chat-pane (max-width: 32rem)");
    expect(autopilotSource).not.toContain("v-if=\"smAndDown\"");
  });
});
