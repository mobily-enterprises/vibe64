// What an assistant can do with publishing and exactly what it sees: no token,
// key, passphrase or local path ever reaches it, and its publish request only
// opens the person's confirmation.
import assert from "node:assert/strict";
import test from "node:test";

import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";

import { PUBLISHING_ACTIONS, createPublishingActions } from "../../packages/vibe64-publishing/src/server/actions.js";
import { PUBLISHING_ASSISTANT_OPERATIONS, publishingTool } from "../../packages/vibe64-publishing/src/server/assistantContracts.js";

// The assistant runtime validates every tool output against its schema.
function shown(operation, value) {
  const tool = publishingTool(operation);
  return validateSchemaPayload(tool.output, tool.transformResult(value), { phase: "output", context: operation });
}

const SECRET_PATTERN = /npm_SECRET|BEGIN PRIVATE|\/home\/|keystore|passphrase-value|token-value/u;

test("assistant tools are exactly the reading, preparing and asking operations", () => {
  assert.deepEqual(PUBLISHING_ASSISTANT_OPERATIONS, ["state.read", "release.prepare", "plan.read", "dryrun.run", "publish.run", "history.list", "logs.read"]);
  const actions = createPublishingActions({ publishing: new Proxy({}, { get: () => () => ({ ok: true }) }) });
  const tools = actions.filter((action) => action.extensions.assistant).map((action) => action.id).sort();
  assert.deepEqual(tools, [
    PUBLISHING_ACTIONS.DRYRUN_RUN, PUBLISHING_ACTIONS.HISTORY_LIST, PUBLISHING_ACTIONS.LOGS_READ, PUBLISHING_ACTIONS.PLAN_READ,
    PUBLISHING_ACTIONS.PUBLISH_RUN, PUBLISHING_ACTIONS.RELEASE_PREPARE, PUBLISHING_ACTIONS.STATE_READ
  ].sort());
  assert.match(publishingTool("publish.run").description, /only opens Vibe64's own confirmation/u);
  assert.match(publishingTool("publish.run").description, /never a confirmation/u);
  assert.throws(() => publishingTool("release.confirm"));
});

test("state.read shows targets, versions and key status, never key contents or paths", () => {
  const state = {
    ok: true,
    baseline: { commit: "c".repeat(40), branch: "main", pushed: true, remote: { name: "origin", githubRepository: "ada/notes", url: "https://github.com/ada/notes.git" } },
    packaging: { status: "ready", packages: [{ id: "sdk", label: "SDK", packer: "npm", version: "1.2.0", versionFrom: "package.json" }] },
    targets: [{ id: "sdk-npm", destination: "npm", package: "sdk", channel: "latest", account: "npm-main", settings: { registry: "http://127.0.0.1:4873/" }, latest: { version: "1.2.0", at: "2026-10-23T10:00:00Z", proof: { integrity: "sha512-x" } } }],
    keys: { exists: true, unlocked: false, entries: [{ id: "account:npm-main", label: "npm", token: "npm_SECRET" }], recoveryKit: { createdAt: "2026-10-23T09:00:00Z", entryIds: ["account:npm-main"] } },
    toolchains: { java: { javaHome: "/home/ada/.cache/vibe64/jdk" } },
    checks: { status: "passed" },
    pendingConfirmation: null,
    releases: [{ id: "r-20261023-100000-abcdef", kind: "release", status: "succeeded", planId: "c41d", versions: { sdk: "1.2.0" }, createdAt: "2026-10-23T10:00:00Z" }],
    activeRelease: null
  };
  const output = shown("state.read", state);
  assert.equal(output.ok, true);
  assert.equal(output.keysExist, true);
  assert.equal(output.keysUnlocked, false);
  assert.equal(output.targets[0].latestVersion, "1.2.0");
  assert.equal(output.remote, "ada/notes");
  assert.equal(output.releases[0].versions, "sdk 1.2.0");
  assert.doesNotMatch(JSON.stringify(output), SECRET_PATTERN);
});

test("plan.read and history expose the plan and proof, not where keys or files live", () => {
  const plan = {
    ok: true,
    plan: {
      planId: "c41d", planHash: `sha256:${"c".repeat(64)}`, savedCommit: "c".repeat(40), tags: ["v1.2.0"],
      packages: [{ id: "app", version: "1.2.0", buildNumber: 3 }],
      targets: [{ id: "phone", destination: "android-sideload", package: "app", channel: null, settings: { certificateSha256: "ab".repeat(32) } }],
      toolchain: { node: "26.5.0" },
      preflight: { ready: true, blocked: false, checks: [{ id: "credentials-valid", severity: "block", ok: true, message: "Every sign-in works." }] }
    }
  };
  const planOutput = shown("plan.read", plan);
  assert.deepEqual(planOutput.targets, [{ id: "phone", destination: "android-sideload", package: "app", channel: "", where: "this computer" }]);
  assert.equal(planOutput.packages[0].buildNumber, 3);

  const history = shown("history.list", { ok: true, releases: [{
    id: "r-20261023-100000-abcdef", kind: "release", status: "partial", planId: "c41d", savedCommit: "c".repeat(40), tags: ["v1.2.0"], versions: { app: "1.2.0" },
    createdAt: "2026-10-23T10:00:00Z", finishedAt: "2026-10-23T10:03:00Z",
    targets: {
      phone: { status: "proven", version: "1.2.0", proof: { sha256: "sha256:abc", fileName: "app.apk" }, localFile: "/home/ada/.local/state/vibe64/app.apk" },
      npm: { status: "failed", error: { message: "npm said 403" } }
    }
  }] });
  assert.match(history.releases[0].outcomes, /phone: proven 1.2.0 \(sha256:abc\)/u);
  assert.match(history.releases[0].outcomes, /npm: failed — npm said 403/u);
  assert.doesNotMatch(JSON.stringify(history), SECRET_PATTERN);
});

test("failures reach the assistant as a code and a plain message", () => {
  const output = shown("publish.run", { ok: false, code: "VIBE64_PUBLISH_CONFIRMATION_PLAN_CHANGED", error: "The plan changed since you reviewed it." });
  assert.deepEqual(output, { ok: false, code: "VIBE64_PUBLISH_CONFIRMATION_PLAN_CHANGED", error: "The plan changed since you reviewed it." });
  const prepared = shown("release.prepare", { ok: true, packages: [{ id: "sdk", previousVersion: "1.1.0", version: "1.2.0", files: ["package.json", "CHANGELOG.md"] }], next: "Review and Save." });
  assert.equal(prepared.packages[0].files, "package.json, CHANGELOG.md");
});
