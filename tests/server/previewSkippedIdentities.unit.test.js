import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { createService } from "../../packages/vibe64-project/src/server/service.js";
import { createStudioProjectContext } from "../../packages/vibe64-core/src/server/studioProjectContext.js";
import { readLaunchContext } from "../../packages/vibe64-terminals/src/server/outputTargetLaunchContext.js";
import { outputStatusResponseFromPreviewStatus } from "../../packages/vibe64-terminals/src/server/launchPreviewStatus.js";
import { previewIdentitySelection } from "../../packages/vibe64-terminals/src/server/launchPreviewAuth.js";
import {
  previewStatusSummary,
  previewSummaryLines
} from "../../packages/vibe64-terminals/src/server/agentPreviewStatusText.js";
import { projectServiceCollaborators, withTemporaryRoot } from "./vibe64TestHelpers.js";

const admin = { name: "admin", type: "email", value: "admin@example.test" };
const you = { name: "you", type: "login", value: "merc" };
const reservedReason = "The name \"you\" is reserved by Vibe64 (default, guest and you are). Choose another, such as admin or user.";

function project(targetRoot) {
  return createService({
    ...projectServiceCollaborators(),
    env: {},
    logger: console,
    projectContext: createStudioProjectContext({
      env: process.env,
      explicitManagedSourceRoot: path.join(path.dirname(targetRoot), "managed-source"),
      explicitSystemRoot: path.join(path.dirname(targetRoot), "system"),
      explicitTargetRoot: targetRoot,
      home: path.dirname(targetRoot)
    })
  });
}

async function writeStoredIdentities(sourceRoot, content) {
  const storedPath = path.join(sourceRoot, ".vibe64", "preview-identities.json");
  await mkdir(path.dirname(storedPath), { recursive: true });
  await writeFile(storedPath, typeof content === "string" ? content : `${JSON.stringify(content)}\n`, "utf8");
}

/**
 * What a Preview's status reports about its identities, from the project's
 * stored file through the launch's own reading of it.
 */
async function previewIdentityFromStoredFile(targetRoot, content) {
  const service = project(targetRoot);
  await writeStoredIdentities(targetRoot, content);
  const session = { metadata: {}, sessionId: "identity-session" };
  const context = await readLaunchContext({
    async createRuntime() {
      return { async getSession() { return session; }, store: {} };
    },
    currentProjectSlug: () => "books",
    currentServiceDataRoot: () => "",
    currentTargetRoot: () => targetRoot,
    readPreviewApplicationIdentities: () => service.readPreviewApplicationIdentities(),
    selectedProject: {}
  }, session.sessionId);
  return outputStatusResponseFromPreviewStatus({
    previewApplicationIdentities: context.previewApplicationIdentities,
    previewApplicationIdentityProblems: context.previewApplicationIdentityProblems,
    previewStatus: {
      activeTerminal: { id: "terminal-identity", metadata: { previewAuth: "application-command" }, status: "running" }
    }
  }).previewIdentity;
}

test("Preview starts with the valid managed app identities and names each one it skips, with the reason", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const identity = await previewIdentityFromStoredFile(targetRoot, { identities: [you, admin], version: 1 });

    assert.deepEqual(identity.identities, [admin]);
    assert.equal(identity.defaultIdentityName, "admin");
    assert.deepEqual(identity.skippedIdentities, [{ name: "you", position: 1, reason: reservedReason }]);
    assert.equal(identity.fileProblem, "");
  });
});

test("Preview starts without managed app identities when their file is not an identity list, and says why", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const identity = await previewIdentityFromStoredFile(targetRoot, "{\"identities\": [");

    assert.deepEqual(identity.identities, []);
    assert.equal(identity.defaultMode, "guest");
    assert.deepEqual(identity.skippedIdentities, []);
    assert.match(identity.fileProblem, /^\.vibe64\/preview-identities\.json is not valid JSON/u);
  });
});

test("choosing a skipped identity in Preview says why it is skipped and where to fix it", () => {
  const skippedIdentities = [{ name: "you", position: 1, reason: reservedReason }];
  assert.throws(() => previewIdentitySelection({ identityName: "YOU" }, { identities: [admin], skippedIdentities }), {
    code: "vibe64_preview_identity_name_skipped",
    message: `Managed app identity 1 ("you") is skipped. ${reservedReason} Rename or remove it in Dashboard > App access.`
  });
  assert.equal(previewIdentitySelection({ identityName: "admin" }, { identities: [admin], skippedIdentities })
    .requestedIdentity.name, "admin");
});

test("the agent's Preview status names each skipped identity and the file's problem", () => {
  const summary = previewStatusSummary({
    previewIdentity: {
      defaultIdentityName: "admin",
      fileProblem: "",
      identities: [admin],
      identityTypes: ["email", "login"],
      skippedIdentities: [{ name: "you", position: 1, reason: reservedReason }]
    }
  });

  assert.deepEqual(summary.skippedIdentities, [{ name: "you", position: 1, reason: reservedReason }]);
  const lines = previewSummaryLines(summary);
  assert.ok(lines.includes("Managed app identities: admin"));
  assert.ok(lines.includes(`Skipped managed app identity 1 ("you"): ${reservedReason}`), lines.join("\n"));
  assert.ok(lines.some((line) => /Rename or remove skipped identities only as the person asks/u.test(line)), lines.join("\n"));

  const unreadable = previewSummaryLines(previewStatusSummary({
    previewIdentity: { fileProblem: ".vibe64/preview-identities.json is not valid JSON (Unexpected end).", identities: [] }
  }));
  assert.ok(unreadable.includes("Managed app identities: none usable"), unreadable.join("\n"));
  assert.ok(unreadable.includes("Managed app identities file: .vibe64/preview-identities.json is not valid JSON (Unexpected end)."),
    unreadable.join("\n"));
});
