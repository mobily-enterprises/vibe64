import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import getPort from "get-port";

import { createStudioProjectContext } from "../../packages/vibe64-core/src/server/studioProjectContext.js";
import { SESSION_SOURCE_PATH_AUTHORITY_MANAGED } from "../../packages/vibe64-core/src/server/sessionSourcePath.js";
import { initializeGenesisProject } from "../../packages/vibe64-genesis/src/server/index.js";
import { createService as createProjectService } from "../../packages/vibe64-project/src/server/service.js";
import { createService as createTerminalService } from "../../packages/vibe64-terminals/src/server/service.js";
import { terminalsServiceCollaborators } from "./terminalsServiceCollaborators.js";
import { projectServiceCollaborators } from "../server/vibe64TestHelpers.js";

const execFileAsync = promisify(execFile);

export async function createPreviewPreparationFixture({
  // The project's logger, which also reports the session store's lock events.
  logger = console,
  // The terminals service's logger, which logs each Preview run a start replaces.
  terminalsLogger = silentLogger,
  // A Prepare step `Migrate` before the Preview's Run step, as a migration is: it logs `begun` and, once it
  // finished, `done` to migrate-log.txt, waits while hold-migrate exists and fails while fail-migrate does.
  outputPrepare = false,
  // How long a restart waits at most for the Preview's Prepare steps.
  previewPrepareWaitMs,
  publishSessionChanged = {}
} = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-preview-preparation-"));
  const sessionId = path.basename(root);
  const sourceRoot = path.join(root, "sessions", "active", sessionId, "source");
  await mkdir(sourceRoot, { recursive: true });
  await execFileAsync("git", ["init", "--initial-branch=main", sourceRoot]);
  await initializeGenesisProject({ projectRoot: sourceRoot });
  const stackPath = path.join(sourceRoot, "genesis", "stack.md");
  // Its own free port, not the default 4100: test files run at the same time,
  // and a port another file's Preview chose between its check and its start is lost.
  const previewPort = await getPort();
  await writeFile(stackPath, `# Stack

## Stack packages
- \`genesis-stack\`

## Components
- \`nodejs\`

## Environment defaults
- Default \`PREVIEW_VALUE\`: \`initial\`

## Environment files
- Dotenv \`.env\`

## Workspace setup
- Prepare \`Prepare fixture\` with \`nodejs\`: \`node\` \`setup.cjs\`

## Connected development
- Default package type: \`npm\`

## Outputs

### Target \`app\`: Preview fixture
- Default.
- Mode: \`interactive\`
- Runtimes: \`nodejs\`
${outputPrepare ? "- Prepare `Migrate`: `node` `migrate.cjs`\n" : ""}- Run \`Serve\`: \`node\` \`preview.cjs\` \`{host}\` \`{port}\`

#### Presentation
- Kind: \`web\`
- Preferred port: \`${previewPort}\`
- URL path: \`/\`
- Ready when: \`GET\` \`/\` returns \`200\`
`);
  await writeFile(path.join(sourceRoot, "setup.cjs"), `
const fs = require("node:fs");
fs.appendFileSync("setup-runs.txt", "prepared\\n");
fs.writeFileSync("setup-entered.txt", "yes");
const check = () => {
  if (fs.existsSync("hold-setup")) return setTimeout(check, 20);
  if (fs.existsSync("fail-setup")) process.exit(1);
  const runs = fs.readFileSync("setup-runs.txt", "utf8").split("\\n").filter(Boolean).length;
  fs.writeFileSync("installed.txt", "install " + runs);
};
check();
`);
  if (outputPrepare) await writeFile(path.join(sourceRoot, "migrate.cjs"), `
const fs = require("node:fs");
fs.appendFileSync("migrate-log.txt", "begun\\n");
const check = () => {
  if (fs.existsSync("hold-migrate")) return setTimeout(check, 20);
  if (fs.existsSync("fail-migrate")) process.exit(1);
  fs.appendFileSync("migrate-log.txt", "done\\n");
};
check();
`);
  // The server reads what setup installed once, as it starts, as a dev server resolves its dependencies.
  await writeFile(path.join(sourceRoot, "preview.cjs"), `
const fs = require("node:fs");
const installed = fs.existsSync("installed.txt") ? fs.readFileSync("installed.txt", "utf8") : "nothing";
const server = require("node:http").createServer((request, response) => {
  response.setHeader("content-type", "text/html");
  response.end(request.url === "/installed" ? installed : "<h1>Preview works: " + process.env.PREVIEW_VALUE + "</h1>");
});
// While hold-preview exists the server is still starting, as a slow dev server is.
const listen = () => fs.existsSync("hold-preview") ? setTimeout(listen, 20) : server.listen(Number(process.argv[3]), process.argv[2]);
listen();
`);
  const project = createProjectService({ ...projectServiceCollaborators(), logger,
    env: {},
    projectContext: createStudioProjectContext({
      env: process.env,
      explicitManagedSourceRoot: path.join(root, "managed"),
      explicitSystemRoot: path.join(root, "system"),
      explicitTargetRoot: sourceRoot
    })
  });
  const runtime = await project.createRuntimeWithoutSource();
  await runtime.store.createSession({
    metadata: {
      repository_mode: "local_source",
      source_kind: "session_clone",
      source_path: sourceRoot,
      source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED
    },
    runtimeKind: "genesis",
    sessionId
  });
  const terminals = createTerminalService(terminalsServiceCollaborators({
    codexTerminalController: { codexToolHomeRequired: false },
    // The server composes its features with the process env and its own settings.
    env: { ...process.env, VIBE64_RUNTIME_NAMESPACE: "preview-preparation-test" },
    logger: terminalsLogger,
    previewPrepareWaitMs,
    project,
    publishSessionChanged
  }));
  await terminals.openProjectRuntime();
  return {
    project, root, runtime, sessionId, sourceRoot, stackPath, terminals,
    async prepare() {
      const setup = await terminals.prepareWorkspaceSetup(sessionId);
      if (setup.ok === false) {
        throw new Error(JSON.stringify(setup));
      }
      await setup.completion;
      const session = await runtime.getSessionWithoutSource(sessionId);
      if (session.workspaceSetup.status !== "succeeded") {
        throw new Error(JSON.stringify(session.workspaceSetup));
      }
    },
    /** What the Preview's Prepare step logged, one `begun` per start and one `done` per finish. */
    async migrateLog() {
      return readFile(path.join(sourceRoot, "migrate-log.txt"), "utf8").catch(() => "");
    },
    async setupRuns() {
      const source = await readFile(path.join(sourceRoot, "setup-runs.txt"), "utf8").catch(() => "");
      return source.split("\n").filter(Boolean).length;
    },
    async holdAssistantLock() {
      const entered = Promise.withResolvers();
      const release = Promise.withResolvers();
      const holding = runtime.store.runSessionExclusive(sessionId, "agent-write-mode", async () => {
        entered.resolve();
        await release.promise;
      });
      await entered.promise;
      return async () => {
        release.resolve();
        await holding;
      };
    },
    async close() {
      await rm(path.join(sourceRoot, "hold-setup"), { force: true });
      await rm(path.join(sourceRoot, "hold-migrate"), { force: true });
      await terminals.closeSessionNonAgentTerminals(sessionId);
      await terminals.close();
      await rm(root, { force: true, recursive: true });
    }
  };
}
