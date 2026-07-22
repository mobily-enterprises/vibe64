import assert from "node:assert/strict";
import test from "node:test";

import {
  parseProjectManifestText,
  sourceContractVibe64EntryIsAllowed
} from "../../packages/vibe64-core/src/server/projectManifest.js";

function manifest(previewIdentity) {
  return JSON.stringify({
    capabilities: {
      previewIdentity
    },
    config: {},
    projectType: "unit",
    schema: "vibe64.project",
    schemaVersion: 1
  });
}

test("Vibe64 project contract owns the app preview identity capability", () => {
  const parsed = parseProjectManifestText(manifest({
    command: [".vibe64/bin/preview-identity"],
    environment: {
      enabled: "APP_PREVIEW_IDENTITY_ENABLED",
      secret: "APP_PREVIEW_IDENTITY_SECRET"
    },
    identityTypes: ["email", "user-id", "email"],
    protocol: "vibe64.preview-identity.command.v1",
    runtimes: ["node26", "node26"],
    viewerIdentityTypes: ["email"]
  }));

  assert.deepEqual(parsed.capabilities.previewIdentity, {
    command: [".vibe64/bin/preview-identity"],
    environment: {
      enabled: "APP_PREVIEW_IDENTITY_ENABLED",
      secret: "APP_PREVIEW_IDENTITY_SECRET"
    },
    identityTypes: ["email", "user-id"],
    protocol: "vibe64.preview-identity.command.v1",
    runtimes: ["node26"],
    timeoutMs: 10000,
    viewerIdentityTypes: ["email"]
  });
  assert.equal(sourceContractVibe64EntryIsAllowed("bin"), true);
});

test("Vibe64 project contract rejects preview identity commands outside the app-owned contract directory", () => {
  assert.throws(() => parseProjectManifestText(manifest({
    command: ["node", "./scripts/preview-identity.mjs"],
    identityTypes: ["email"],
    protocol: "vibe64.preview-identity.command.v1"
  })), /app-owned file under \.vibe64\/bin/u);
});
