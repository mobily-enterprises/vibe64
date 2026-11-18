import { gzipSync } from "node:zlib";

import { createAwsClient } from "../../packages/vibe64-deploy/src/adapters/aws/client.js";
import { createAwsAdapter } from "../../packages/vibe64-deploy/src/adapters/aws/index.js";
import { createAwsStandIn } from "../../packages/vibe64-deploy/src/adapters/aws/standIn.js";
import { imagePackages } from "../../packages/vibe64-deploy/src/image.js";
import { settingsPerService, withRootFile } from "../../packages/vibe64-deploy/src/package.js";
import { planOf } from "../../packages/vibe64-deploy/src/plan.js";
import { newRecord } from "../../packages/vibe64-deploy/src/record.js";
import { deploy } from "../../packages/vibe64-deploy/src/steps.js";
import { workersStack } from "../fixtures/deployWorkersApp.js";

// What the deploy engine's AWS tests share: the two-service app (tests/fixtures/deployWorkersApp.js) released as
// images, AWS's stand-in with the client and the adapter over it, and a Deploy that reads the Plan first. The stand-in
// is moved on between steps, as time would move AWS on; the domain's records are in place unless `issued` is false.

const NIXPKGS = "0123456789abcdef0123456789abcdef01234567";
const DOMAIN = "shop.example.com";
const ENV_RECORDS = Object.freeze([{ key: "MAIL_PASSWORD", secret: true }, { key: "MAX_JOBS", secret: false, services: ["workers"] }]);
const ENV = Object.freeze({ SESSION_SECRET: "session-1", SETUP_CODE: "setup-1", MAIL_PASSWORD: "mail-1", MAX_JOBS: "8" });

/** A release of a commit: the archive (one file naming the commit) and each service's declaration and settings. */
function releaseOf(commit, stack, env = ENV, records = ENV_RECORDS) {
  const settings = settingsPerService(stack.needs, records);
  const { declarations } = imagePackages({ app: "shop", deployment: stack.deployment, needs: stack.needs, settings });
  return { id: commit, archive: withRootFile(gzipSync(Buffer.alloc(1024)), "commit.txt", commit).bytes, declarations, settings, env: { ...env }, domain: DOMAIN };
}

/**
 * The stand-in, the client over it (signed with the stand-in's keys, or through its gateway with a token) and the
 * adapter for a new record's deployment, with a Deploy helper that plans first and moves the stand-in on between steps.
 * @param {{ gateway?: boolean, issued?: boolean, record?: any }} [options]
 */
function awsWorld({ gateway = false, issued = true, record: given = null } = {}) {
  const standIn = createAwsStandIn(gateway ? { gateway: { url: "https://gateway.example/aws", token: "token-1" } } : {});
  const client = createAwsClient({
    region: standIn.region,
    credential: gateway ? { gateway: "https://gateway.example/aws", token: () => "token-1" } : standIn.credentials,
    fetch: standIn.fetch,
    now: standIn.now
  });
  const record = given ?? newRecord({ app: "shop", environment: "production", provider: { id: "aws", project: `${standIn.account}/${standIn.region}` } });
  const adapter = createAwsAdapter({ client, deployment: { id: record.deploymentId, app: record.app, environment: record.environment }, nixpkgs: NIXPKGS, now: () => standIn.now().getTime() });
  // The owner put the domain's records in place before deploying.
  if (issued) standIn.issue(DOMAIN);
  const pause = () => standIn.advance();
  const run = async ({ stack = workersStack(), record: current, commit, env, records, choices = {}, decisions = {}, maxSteps = 400 }) => {
    const plan = planOf({ needs: stack.needs, record: current, observed: await adapter.inventory(), offer: await adapter.offer(), choices, decisions });
    const result = await deploy({
      adapter, needs: stack.needs, record: current, choices, decisions, planHash: plan.hash, release: releaseOf(commit, stack, env, records), holder: "Vibe64 on laptop", pause, maxSteps
    });
    return { ...result, plan };
  };
  return { standIn, client, adapter, record, run, pause };
}

export { DOMAIN, ENV, ENV_RECORDS, NIXPKGS, awsWorld, releaseOf };
