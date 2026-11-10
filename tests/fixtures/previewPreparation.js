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
- Run \`Serve\`: \`node\` \`preview.cjs\` \`{host}\` \`{port}\`

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
  // The server reads what setup installed once, as it starts, as a dev server resolves its dependencies.
  await writeFile(path.join(sourceRoot, "preview.cjs"), `
const fs = require("node:fs");
const installed = fs.existsSync("installed.txt") ? fs.readFileSync("installed.txt", "utf8") : "nothing";
require("node:http").createServer((request, response) => {
  response.setHeader("content-type", "text/html");
  response.end(request.url === "/installed" ? installed : "<h1>Preview works: " + process.env.PREVIEW_VALUE + "</h1>");
}).listen(Number(process.argv[3]), process.argv[2]);
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
    logger: silentLogger,
    project,
    publishSessionChanged
  }));
  await terminals.openProjectRuntime();
  return {
    project, root, runtime, sessionId, sourceRoot, stackPath, terminals,
    async prepare() {
      const setup = await terminals.prepareWorkspaceSetup(sessionId, { waitForCompletion: true });
      if (setup.ok === false) {
        throw new Error(JSON.stringify(setup));
      }
      const session = await runtime.getSessionWithoutSource(sessionId);
      if (session.workspaceSetup.status !== "succeeded") {
        throw new Error(JSON.stringify(session.workspaceSetup));
      }
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
      await terminals.closeSessionNonAgentTerminals(sessionId);
      await terminals.close();
      await rm(root, { force: true, recursive: true });
    }
  };
}
