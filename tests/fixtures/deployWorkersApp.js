// A two-service application for the deploy engine's container tests: a public `web` (pages and the API) and internal
// `workers` on bigger machines, each running its jobs in a gVisor sandbox and reached instance by instance, with a
// PostgreSQL database and a bucket. The lines are a Deployment section as Genesis hands it to Vibe64.
import { vibe64DeploymentInspection } from "../../packages/vibe64-genesis/src/server/applicationDeployment.js";
import { preferredAlternative, resourceKindIsDatabase } from "../../packages/vibe64-project/src/server/resourceEnvironment.js";
import { needsOfStack } from "../../packages/vibe64-deploy/src/needsOfStack.js";

const WORKERS_DEPLOYMENT_LINES = Object.freeze([
  "",
  "- Runtimes: `nodejs`",
  "- Generated secrets: `SESSION_SECRET`",
  "- Setup code: `SETUP_CODE`",
  "- Packages: `git` `ripgrep`",
  "- Prepare `Install dependencies`: `npm` `ci`",
  "- Build `Build`: `npm` `run` `build`",
  "- Migrate `Migrate database`: `npm` `run` `db:migrate`",
  "",
  "### Service `web`: pages and the API",
  "",
  "- Exposure: `public`",
  "- Serve `Start`: `node` `server.js`",
  "- Ready when: `GET` `/api/health` returns `200`",
  "- Instances: `1` to `6`",
  "- Needs at least: `1` vCPU, `2` GiB memory",
  "- Production: `2` instances",
  "- Reaches: `workers` as `WORKERS_URL`",
  "",
  "### Service `workers`: jobs, each in its own gVisor sandbox",
  "",
  "- Exposure: `internal`",
  "- Reached: `each instance`",
  "- Serve `Start the workers`: `node` `worker.js`",
  "- Ready when: `GET` `/api/health` returns `200`",
  "- Instances: `1` to `20`",
  "- Needs at least: `4` vCPU, `16` GiB memory",
  "- Production: `2` instances",
  "- Setting `WORKER_MODE`: `jobs`",
  "- Packages: `xvfb`",
  "- Sandbox allows: `gvisor` `fuse`"
]);

const WORKERS_RESOURCES = Object.freeze([
  {
    component: "jskit-postgresql",
    resource: {
      id: "database",
      kind: "postgresql",
      environmentAlternatives: [{ preferred: true, bindings: { host: "DB_HOST", port: "DB_PORT", database: "DB_NAME", username: "DB_USER", password: "DB_PASSWORD" } }]
    }
  },
  {
    component: "jskit-storage",
    resource: {
      id: "files",
      kind: "bucket",
      environmentAlternatives: [{
        preferred: true,
        bindings: { bucket: "FILES_BUCKET", region: "FILES_REGION", endpoint: "FILES_ENDPOINT", accessKeyId: "FILES_KEY_ID", secretAccessKey: "FILES_SECRET" }
      }]
    }
  }
]);

/**
 * The app's Deployment inspection and needs, its lines changed by `edit`, with these resources.
 * @param {(lines: string[]) => string[]} [edit] @param {ReadonlyArray<object>} [resources]
 */
function workersStack(edit = (lines) => lines, resources = WORKERS_RESOURCES) {
  const deployment = vibe64DeploymentInspection({
    environment: { stackHash: "sha256:stack", resources },
    section: { status: "ready", stackHash: "sha256:stack", lines: edit([...WORKERS_DEPLOYMENT_LINES]), components: [], source: "project" }
  });
  const { needs, problem } = needsOfStack(deployment, { preferredAlternative, resourceKindIsDatabase });
  if (problem) throw new Error(problem.message);
  return { deployment, needs };
}

export { WORKERS_DEPLOYMENT_LINES, WORKERS_RESOURCES, workersStack };
