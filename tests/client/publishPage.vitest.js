// The Publish page: it reads the project's publishing state, shows each target
// with what it still needs, and publishes only through the person's own
// confirmation (unlock, open the confirmation, redeem it) for the plan shown.
import { createRenderer, createSSRApp, nextTick, ssrContextKey } from "vue";
import { renderToString } from "@vue/server-renderer";
import { createVuetify } from "vuetify";
import { afterEach, expect, it, vi } from "vitest";

import PublishPage from "../../packages/vibe64-publishing/src/client/PublishPage.vue";
import ConfirmPublishDialog from "../../packages/vibe64-publishing/src/client/ConfirmPublishDialog.vue";
import ReleaseDialog from "../../packages/vibe64-publishing/src/client/ReleaseDialog.vue";
import { lastFailure } from "../../packages/vibe64-publishing/src/client/publishFormat.js";
import AndroidSideloadCard from "../../packages/vibe64-publishing/src/client/cards/AndroidSideloadCard.vue";
import TargetCard from "../../packages/vibe64-publishing/src/client/cards/TargetCard.vue";
import NpmCard from "../../packages/vibe64-publishing/src/client/cards/NpmCard.vue";
import { PUBLISH_ACCOUNT_KINDS, PUBLISH_DESTINATION_CATALOG } from "../../packages/vibe64-publishing/src/shared/destinationCatalog.js";
import { VIBE64_DESTINATIONS } from "../../packages/vibe64-packaging/src/server/destinations/index.js";

// As the service sends them: the catalog with each destination's own packers.
const DESTINATIONS = PUBLISH_DESTINATION_CATALOG.map((entry) => ({ ...entry, packers: VIBE64_DESTINATIONS[entry.id].packers }));

let app;
afterEach(() => {
  app?.unmount();
  app = null;
});

function mount(component, props) {
  const node = () => ({});
  const renderer = createRenderer({ createComment: node, createElement: node, createText: node, setText() {}, setElementText() {},
    patchProp() {}, insert() {}, remove() {}, parentNode() {}, nextSibling() {} });
  app = renderer.createApp({ ...component, render: () => null }, props);
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount({});
  return app._instance.setupState;
}

function render(component, props) {
  const view = createSSRApp(component, props);
  view.use(createVuetify({ ssr: true }));
  return renderToString(view);
}

const PLAN = { planHash: `sha256:${"a".repeat(64)}`, planId: "aaaa", savedCommit: "c".repeat(40), tags: ["v1.2.0"],
  packages: [{ id: "sdk", version: "1.2.0" }], targets: [{ id: "sdk-npm", destination: "npm", package: "sdk", channel: null }],
  steps: [{ kind: "build", package: "sdk" }, { kind: "tag", tag: "v1.2.0" }, { kind: "publish", target: "sdk-npm" }] };

function publishingState(overrides = {}) {
  return {
    ok: true,
    baseline: { supported: true, commit: "c".repeat(40), branch: "main", saved: true, pushed: true, remote: null, message: "" },
    packaging: { status: "ready", packages: [{ id: "sdk", label: "SDK", packer: "npm", version: "1.2.0" }, { id: "app", label: "Notes", packer: "capacitor", version: "1.0.0", applicationName: "Notes" }], diagnostics: [], problem: "" },
    targets: [{ id: "sdk-npm", destination: "npm", package: "sdk", channel: null, account: "npm-local", settings: { registry: "http://127.0.0.1:4873/" }, latest: null }],
    keys: { exists: true, unlocked: false, entries: [], recoveryKit: null },
    toolchains: { java: { ready: false }, androidSdk: { ready: false }, androidLicence: null, install: null },
    checks: { status: "passed" },
    pendingConfirmation: null,
    releases: [],
    activeRelease: null,
    destinations: DESTINATIONS,
    accountKinds: Object.values(PUBLISH_ACCOUNT_KINDS),
    accounts: [{ id: "npm-local", kind: "npm", label: "Local npm", address: "http://127.0.0.1:4873/" }],
    share: { sharing: false },
    ...overrides
  };
}

it("reads the project's publishing state and asks the person to review an assistant's request", async () => {
  const calls = [];
  const state = publishingState({ pendingConfirmation: { planHash: PLAN.planHash, planId: "aaaa", targetIds: ["sdk-npm"], requestedBy: "assistant" } });
  const request = vi.fn(async (suffix, options = {}) => {
    calls.push([options.method || "GET", suffix, options.body]);
    if (suffix === "/plan") return { ok: true, plan: PLAN };
    return state;
  });
  const page = mount(PublishPage, { request, dashboardContext: { sessionId: "s1" } });
  await vi.waitFor(() => expect(page.state).toBeTruthy());
  expect(page.targets.map((target) => target.id)).toEqual(["sdk-npm"]);
  expect(page.activityByTarget["sdk-npm"]).toEqual({ running: false, version: "", failure: null });

  await page.reviewRequest();
  expect(calls.at(-1)).toEqual(["POST", "/plan", { targetIds: ["sdk-npm"] }]);
  expect(page.dialogs.confirm).toBe(true);
  expect(page.confirmation.requestedBy).toBe("assistant");
  expect(calls.some(([, suffix]) => suffix === "/confirmation" || suffix === "/releases"), "reviewing confirms nothing").toBe(false);
});

it("refuses an assistant's request whose plan no longer matches the saved work", async () => {
  const state = publishingState({ pendingConfirmation: { planHash: `sha256:${"b".repeat(64)}`, planId: "bbbb", targetIds: ["sdk-npm"] } });
  const page = mount(PublishPage, { request: async (suffix) => (suffix === "/plan" ? { ok: true, plan: PLAN } : state) });
  await vi.waitFor(() => expect(page.state).toBeTruthy());
  await page.reviewRequest();
  expect(page.dialogs.confirm).toBe(false);
  expect(page.pageError).toMatch(/saved work changed/u);
});

it("publishes only by unlocking, opening the person's confirmation and redeeming it for the shown plan", async () => {
  const sequence = [];
  const call = vi.fn(async (suffix, { body } = {}) => {
    sequence.push([suffix, body]);
    if (suffix === "/confirmation") return { ok: true, token: "t".repeat(43) };
    if (suffix === "/releases") return { ok: true, releaseId: "r-1" };
    return { ok: true };
  });
  const dialog = mount(ConfirmPublishDialog, { modelValue: true, plan: PLAN, targetIds: ["sdk-npm"], state: publishingState(), call });
  await nextTick();
  dialog.passphrase = "correct horse battery";
  await dialog.publish();
  expect(sequence.map(([suffix]) => suffix)).toEqual(["/keys/unlock", "/confirmation", "/releases"]);
  expect(sequence[1][1]).toEqual({ planHash: PLAN.planHash, targetIds: ["sdk-npm"], acknowledged: [] });
  expect(sequence[2][1]).toMatchObject({ planHash: PLAN.planHash, token: "t".repeat(43) });
  expect(dialog.passphrase).toBe("");
});

it("shows a changed plan instead of publishing it", async () => {
  const call = vi.fn(async (suffix) => {
    if (suffix === "/confirmation") throw Object.assign(new Error("The plan changed since you reviewed it."), { code: "VIBE64_PUBLISH_CONFIRMATION_PLAN_CHANGED" });
    return { ok: true };
  });
  const dialog = mount(ConfirmPublishDialog, { modelValue: true, plan: PLAN, targetIds: [], state: publishingState({ keys: { exists: true, unlocked: true, entries: [] } }), call });
  await dialog.publish();
  expect(call.mock.calls.map(([suffix]) => suffix)).toEqual(["/confirmation"]);
  expect(dialog.error).toMatch(/plan changed/u);
});

it("walks a phone target through tools, install key and recovery kit before it offers the QR", async () => {
  const target = { id: "app-android-sideload", destination: "android-sideload", package: "app", settings: {}, latest: null };
  const fresh = await render(AndroidSideloadCard, { target, toolchains: {}, keys: { entries: [] } });
  expect(fresh).toContain("Android build tools");
  expect(fresh).toContain("Install key");
  expect(fresh).toContain("Recovery kit");
  expect(fresh).not.toContain("Install on phone");

  const keyEntry = { id: "android-sideload:app", kind: "android-sideload-key", createdAt: "2026-10-23T10:00:00Z" };
  const ready = await render(AndroidSideloadCard, {
    target: { ...target, settings: { certificateSha256: "ab".repeat(32) }, latest: { version: "1.0.0", at: "2026-10-23T11:00:00Z", downloadable: true, releaseId: "r-1", proof: { sha256: `sha256:${"d".repeat(64)}`, size: 4_200_000 } } },
    toolchains: { java: { ready: true }, androidSdk: { ready: true } },
    keys: { entries: [keyEntry], recoveryKit: { createdAt: "2026-10-23T10:05:00Z" } }
  });
  expect(ready).not.toContain("One-time setup");
  expect(ready).toContain("Install on phone");
  expect(ready).toContain("1.0.0");
  expect(ready).toContain("4.0 MB");
});

it("shows where an npm target publishes and that it has not published yet", async () => {
  const html = await render(NpmCard, {
    target: publishingState().targets[0],
    destination: { ...DESTINATIONS.find((entry) => entry.id === "npm"), accountKind: "npm" },
    accounts: publishingState().accounts
  });
  expect(html).toContain(">127.0.0.1:4873<");
  expect(html).toContain("Not published yet");
  expect(html).toContain("Local npm");
});

it("offers first the destinations this project can use, and says why the others wait", async () => {
  const state = publishingState({ targets: [], packaging: { status: "ready", packages: [{ id: "py", label: "Py", packer: "python-dist", version: "1.0.0" }], diagnostics: [], problem: "" } });
  const page = mount(PublishPage, { request: async () => state });
  await vi.waitFor(() => expect(page.state).toBeTruthy());
  expect(page.startDestinations.map((entry) => [entry.id, entry.availability.reason])).toEqual([
    ["pypi", ""],
    ["android-sideload", "Needs an app package in Packaging"],
    ["github-releases", "Needs this project's repository on GitHub"],
    ["npm", "Needs a JavaScript package in Packaging"]
  ]);

  const webOnly = publishingState({ targets: [], baseline: { ...state.baseline, remote: { githubRepository: "ada/notes" } },
    packaging: { status: "ready", packages: [{ id: "web", label: "Web", packer: "web-bundle", version: null }], diagnostics: [], problem: "" } });
  const webPage = mount(PublishPage, { request: async () => webOnly });
  await vi.waitFor(() => expect(webPage.state).toBeTruthy());
  expect(webPage.startDestinations.find((entry) => entry.id === "github-releases").availability.reason, "GitHub Releases takes what its destination takes")
    .toBe("Needs a package in Packaging");
});

it("marks a target whose newest release failed, until a later release publishes it", () => {
  const target = { id: "sdk-npm", latest: { version: "1.0.0", at: "2026-10-23T09:00:00Z" } };
  const failed = { id: "r-2", kind: "release", status: "failed", createdAt: "2026-10-23T10:00:00Z", finishedAt: "2026-10-23T10:01:00Z",
    steps: [{ id: "build:sdk", status: "failed" }, { id: "publish:sdk-npm", status: "pending" }], targets: {}, error: { message: "Build failed with exit code 1." } };
  expect(lastFailure(target, [failed])).toMatchObject({ release: { id: "r-2" }, message: "Build failed with exit code 1." });
  const dryRun = { ...failed, id: "r-3", kind: "dry-run" };
  expect(lastFailure(target, [dryRun])).toBe(null);
  expect(lastFailure({ ...target, latest: { ...target.latest, at: "2026-10-23T11:00:00Z" } }, [failed])).toBe(null);
});

it("lets a saved version nobody has published go out as it is, without a session", async () => {
  const suggestion = { ok: true, notes: "- Fix", packages: [{ id: "sdk", label: "SDK", current: "1.2.0", released: false, external: false,
    suggestions: [{ kind: "patch", version: "1.2.1" }, { kind: "minor", version: "1.3.0" }, { kind: "major", version: "2.0.0" }] }] };
  const calls = [];
  const call = vi.fn(async (suffix) => {
    calls.push(suffix);
    if (suffix === "/release/suggestion") return suggestion;
    if (suffix === "/plan") return { ok: true, plan: PLAN };
    return { ok: true };
  });
  const dialog = mount(ReleaseDialog, { modelValue: false, state: publishingState(), call, dashboardContext: {} });
  app._instance.props.modelValue = true;
  await vi.waitFor(() => expect(dialog.suggestion).toBeTruthy());
  expect(dialog.choicesFor(suggestion.packages[0]).map((choice) => choice.kind)).toEqual(["as saved", "patch", "minor", "major"]);
  expect(dialog.versions).toEqual({ sdk: "1.2.0" });
  expect(dialog.needsWriting).toBe(false);
  dialog.versions.sdk = "1.2.1";
  expect(dialog.needsWriting).toBe(true);
  expect(dialog.unreleasedSaved).toBe(true);
  await dialog.releaseAsSaved();
  expect(dialog.versions).toEqual({ sdk: "1.2.0" });
  expect(calls).not.toContain("/release/prepare");
  expect(dialog.planSteps.map((entry) => entry.id)).toEqual(["build:sdk", "tag:v1.2.0", "publish:sdk-npm"]);
  // The dialog shows the plan's own steps, including the content an app is built from.
  dialog.plan = { ...PLAN, packages: [{ id: "web", version: null }, { id: "app", version: "1.0.0" }], tags: ["v1.0.0"],
    targets: [{ id: "app-phone", destination: "android-sideload", package: "app", channel: null }],
    steps: [{ kind: "build", package: "web" }, { kind: "build", package: "app" }, { kind: "tag", tag: "v1.0.0" }, { kind: "publish", target: "app-phone" }] };
  expect(dialog.planSteps.map((entry) => entry.id)).toEqual(["build:web", "build:app", "tag:v1.0.0", "publish:app-phone"]);

  const released = { ...suggestion.packages[0], released: true };
  expect(dialog.choicesFor(released).map((choice) => choice.kind)).toEqual(["patch", "minor", "major"]);
});

it("shows each file's own sha256 when the destination read back named files", async () => {
  const a = "1".repeat(64);
  const b = "2".repeat(64);
  const html = await render(TargetCard, {
    target: { id: "kit-pypi", destination: "pypi", package: "kit", latest: { version: "2.0.0", at: new Date().toISOString(), checksum: `sha256:${"9".repeat(64)}`,
      proof: { project: "kit", files: [{ name: "kit-2.0.0-py3-none-any.whl", sha256: `sha256:${a}` }, { name: "kit-2.0.0.tar.gz", sha256: `sha256:${b}` }] } } },
    destination: { label: "PyPI" }
  });
  expect(html).toContain("kit-2.0.0-py3-none-any.whl");
  expect(html).toContain(`sha256 ${a.slice(0, 12)}`);
  expect(html).toContain(`sha256 ${b.slice(0, 12)}`);
  expect(html).not.toContain("9".repeat(12));
});
