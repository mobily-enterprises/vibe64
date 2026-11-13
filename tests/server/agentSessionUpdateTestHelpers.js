// `vibe64-helper session update` as the session's AI runs it: the generated vibe64-session script over the real
// session command socket of a session command service.
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { prepareAgentSessionCommand } from "../../packages/vibe64-terminals/src/server/agentSessionCommand.js";

const execFileAsync = promisify(execFile);

/**
 * The bound project the session command runs in, and the session store it reads: the session's source
 * descriptor and its stored values.
 * @param {{ sessionId: string, sourcePath: string, metadata: object }} session
 * @param {{ readMetadataValue: Function }} store
 */
function sessionCommandProject(session, store) {
  return {
    async createSessionStore() {
      return { readMetadataValue: store.readMetadataValue, readSessionSourceDescriptor: async () => session };
    },
    readCurrentProject: async () => ({ slug: "project" }),
    runInProjectContext: (_slug, operation) => operation()
  };
}

/**
 * Binds the session's command socket and answers a function that runs `vibe64-helper session <args>` in the
 * session's source, resolving to its exit code, stdout and stderr.
 * @param {import("node:test").TestContext} t
 * @param {object} commandService a session command service over sessionCommandProject(session, ...)
 * @param {{ sessionId: string, sourcePath: string }} session
 */
async function sessionHelper(t, commandService, session) {
  const wrapperHostDir = await mkdtemp(path.join(os.tmpdir(), "vibe64-session-update-"));
  const prepared = await prepareAgentSessionCommand({ commandService, sessionId: session.sessionId, wrapperHostDir });
  t.after(async () => {
    await commandService.closeAllForSession(session.sessionId);
    await rm(wrapperHostDir, { force: true, recursive: true });
  });
  return (args) => execFileAsync(path.join(wrapperHostDir, "vibe64-session"), args, {
    cwd: session.sourcePath,
    env: { ...process.env, ...prepared.env }
  }).then(
    ({ stderr, stdout }) => ({ code: 0, stderr, stdout }),
    (error) => ({ code: error.code, stderr: error.stderr, stdout: error.stdout })
  );
}

export { sessionCommandProject, sessionHelper };
