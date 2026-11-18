import { gzipSync } from "node:zlib";

import { createGoogleClient } from "../../packages/vibe64-deploy/src/adapters/google/client.js";
import { createGoogleAdapter } from "../../packages/vibe64-deploy/src/adapters/google/index.js";
import { createGoogleStandIn } from "../../packages/vibe64-deploy/src/adapters/google/standIn.js";
import { imagePackages } from "../../packages/vibe64-deploy/src/image.js";
import { settingsPerService, withRootFile } from "../../packages/vibe64-deploy/src/package.js";
import { planOf } from "../../packages/vibe64-deploy/src/plan.js";
import { newRecord } from "../../packages/vibe64-deploy/src/record.js";
import { deploy } from "../../packages/vibe64-deploy/src/steps.js";
import { workersStack } from "../fixtures/deployWorkersApp.js";

// What the deploy engine's Google Cloud tests share: the two-service app (tests/fixtures/deployWorkersApp.js) released
// as images, the stand-in with the client and the adapter over it, and a Deploy that reads the Plan first.

const NIXPKGS = "0123456789abcdef0123456789abcdef01234567";
const DOMAIN = "shop.example.com";
const ENV_RECORDS = Object.freeze([{ key: "MAIL_PASSWORD", secret: true }, { key: "MAX_JOBS", secret: false, services: ["workers"] }]);
const ENV = Object.freeze({ SESSION_SECRET: "session-1", SETUP_CODE: "setup-1", MAIL_PASSWORD: "mail-1", MAX_JOBS: "8" });

/** A release of a commit: the archive (one file naming the commit) and each service's declaration and settings. */
function releaseOf(commit, stack, env = ENV) {
  const settings = settingsPerService(stack.needs, ENV_RECORDS);
  const { declarations } = imagePackages({ app: "shop", deployment: stack.deployment, needs: stack.needs, settings });
  return { id: commit, archive: withRootFile(gzipSync(Buffer.alloc(1024)), "commit.txt", commit).bytes, declarations, settings, env: { ...env }, domain: DOMAIN };
}

/**
 * The stand-in, the client over it (directly, or through the stand-in's gateway) and the adapter, with a new record and
 * a Deploy helper that plans first and moves the stand-in on between steps.
 * @param {{ gateway?: boolean }} [options]
 */
function googleWorld({ gateway = false } = {}) {
  const standIn = createGoogleStandIn();
  const client = createGoogleClient({ ...(gateway ? { baseUrl: standIn.gateway } : {}), credential: standIn.token(), fetch: standIn.fetch });
  const adapter = createGoogleAdapter({ client, project: standIn.project, region: standIn.region, nixpkgs: NIXPKGS, pause: async () => standIn.advance() });
  const record = newRecord({ app: "shop", environment: "production", provider: { id: "google", project: standIn.project } });
  const run = async ({ stack = workersStack(), record: given, commit, env, choices = {}, decisions = {}, maxSteps = 300 }) => {
    const plan = planOf({ needs: stack.needs, record: given, observed: await adapter.inventory(), offer: await adapter.offer(), choices, decisions });
    const result = await deploy({
      adapter, needs: stack.needs, record: given, choices, decisions, planHash: plan.hash, release: releaseOf(commit, stack, env), holder: "Vibe64 on laptop",
      pause: () => standIn.advance(), maxSteps
    });
    return { ...result, plan };
  };
  return { standIn, client, adapter, record, run };
}

export { DOMAIN, ENV, NIXPKGS, googleWorld, releaseOf };
