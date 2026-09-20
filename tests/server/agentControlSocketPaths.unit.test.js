import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { prepareCodexGitCommand } from "../../packages/vibe64-terminals/src/server/codexGitCommand.js";
import { prepareAgentPreviewCommand } from "../../packages/vibe64-terminals/src/server/agentPreviewCommand.js";
import { prepareAgentEnvCommand } from "../../packages/vibe64-terminals/src/server/agentEnvCommand.js";
import { prepareAgentDatabaseCommand } from "../../packages/vibe64-terminals/src/server/agentDatabaseCommand.js";
import { requestUnixJsonCommand, unixCommandSocketPath } from "../../packages/vibe64-terminals/src/server/unixJsonCommand.js";

test("all assistant controls connect with long workspace paths and stay isolated", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "v64-control-paths-"));
  const sockets = new Set();
  const sessionId = "2026-09-20_11-19-52";
  const commandService = {
    async bindSession() {},
    async run(input) { return { ok: true, sessionId: input.sessionId }; }
  };
  try {
    for (const workspace of ["mercmobily", "workspace-with-a-much-longer-name"]) {
      const attachmentRoot = path.join(root, "home", `v64d_${workspace}`, ".local/state/vibe64/attachments");
      const git = await prepareCodexGitCommand({
        commandService,
        env: { ...process.env, VIBE64_CODEX_ATTACHMENTS_ROOT: attachmentRoot },
        sessionId,
        stateRoot: path.join(root, workspace, "state")
      });
      const options = { commandService, sessionId, wrapperHostDir: git.hostWrapperDir };
      assert.ok(Buffer.byteLength(path.join(git.hostWrapperDir, "preview-command.sock")) > 107);
      const preview = await prepareAgentPreviewCommand(options);
      const environment = await prepareAgentEnvCommand(options);
      const database = await prepareAgentDatabaseCommand(options);
      for (const [prepared, prefix, route] of [
        [git, "VIBE64_CODEX_GIT_COMMAND", "/codex-git-command/run"],
        [preview, "VIBE64_AGENT_PREVIEW_COMMAND", "/agent-preview-command/run"],
        [environment, "VIBE64_AGENT_ENV_COMMAND", "/agent-env-command/run"],
        [database, "VIBE64_AGENT_DATABASE_COMMAND", "/agent-database-command/run"]
      ]) {
        assert.equal(prepared.ok, true);
        assert.equal(sockets.has(prepared.hostSocketPath), false);
        sockets.add(prepared.hostSocketPath);
        assert.equal((await stat(prepared.hostSocketPath)).isSocket(), true);
        assert.ok(Buffer.byteLength(prepared.hostSocketPath) <= 103);
        const body = {
          args: ["status"],
          generationId: prepared.env[`${prefix}_GENERATION`],
          sessionId,
          token: prepared.env[`${prefix}_TOKEN`]
        };
        const response = await requestUnixJsonCommand({ body, path: route, socketPath: prepared.hostSocketPath });
        assert.equal(response.statusCode, 200);
        assert.equal(response.payload.ok, true);
        assert.equal(response.payload.sessionId, sessionId);
        const denied = await requestUnixJsonCommand({
          body: { ...body, sessionId: "another-session" }, path: route, socketPath: prepared.hostSocketPath
        });
        assert.equal(denied.payload.ok, false);
      }
      assert.equal(sockets.has(preview.hostBrowserSocketPath), false);
      sockets.add(preview.hostBrowserSocketPath);
      const browser = http.createServer((_request, response) => response.end("browser control"));
      try {
        await new Promise((resolve, reject) => {
          browser.once("error", reject);
          browser.listen(preview.hostBrowserSocketPath, resolve);
        });
        const response = await requestUnixJsonCommand({ socketPath: preview.hostBrowserSocketPath });
        assert.equal(response.text, "browser control");
      } finally {
        await new Promise((resolve) => browser.close(resolve));
      }
    }
    assert.equal(sockets.size, 10);
  } finally {
    for (const socket of sockets) await rm(socket, { force: true });
    await rm(root, { force: true, recursive: true });
  }
});

test("control socket paths reject oversized temporary roots by bytes with an actionable error", () => {
  const identity = "workspace/session/control";
  const maxBytes = process.platform === "darwin" ? 103 : 107;
  const overhead = Buffer.byteLength(unixCommandSocketPath(identity, { env: { TMPDIR: "/" } }));
  const root = `/${"a".repeat(maxBytes - overhead - 1)}`;
  assert.equal(Buffer.byteLength(unixCommandSocketPath(identity, { env: { TMPDIR: root } })), maxBytes);
  for (const oversized of [`${root}x`, `/${"é".repeat(60)}`]) {
    assert.throws(() => unixCommandSocketPath(identity, { env: { TMPDIR: oversized } }), (error) => {
      assert.equal(error.code, "vibe64_agent_control_path_too_long");
      assert.match(error.message, /shorten TMPDIR, then retry/u);
      return true;
    });
  }
});
