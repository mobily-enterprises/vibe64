import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { sendProjectMessage } from "../../packages/vibe64-terminals/src/server/projectMessage.js";
import { createAgentSessionCommandService, prepareAgentSessionCommand } from "../../packages/vibe64-terminals/src/server/agentSessionCommand.js";
import { prepareAgentHelperCommand } from "../../packages/vibe64-terminals/src/server/agentHelperCommand.js";

test("project messages use only the current selected Main session with fresh access and normal delivery", async () => {
  const actor = { username: "owner" };
  const input = { sourceProject: "online", sourceSession: "source", projectSlug: "jskit-ai", message: "Review and ping me.", messageId: "receipt", actor };
  let open = true, selection = "selected-1", closing = false, denied = false;
  const sent = [];
  const dependencies = {
    authorize: async (identity, slug) => {
      assert.equal(identity, actor); assert.equal(slug, "jskit-ai");
      if (denied) throw new Error("Access revoked");
      return actor;
    },
    projectService: {
      runInProjectContext: async (slug, operation, options) => {
        assert.equal(slug, "jskit-ai"); assert.equal(options.vibe64User, actor); return operation();
      },
      readCurrentProject: async () => ({ runtime: { open } }),
      createRuntime: async () => ({ store: { readCurrentSession: async () => selection ? { sessionId: selection } : null } })
    },
    assertOpen: () => { if (closing) throw new Error("Project is closing"); },
    send: async (...args) => { sent.push(args); return { ok: true, delivered: true }; }
  };
  const result = await sendProjectMessage(input, dependencies);
  assert.equal(result.sessionId, "selected-1");
  assert.equal(result.messageId, "receipt");
  assert.match(sent[0][1].message, /^From project online \(session source\)/);
  assert.match(sent[0][1].message, /not new human authorization/);
  assert.equal(sent[0][1].submissionKind, undefined); // Existing owner chooses send or steering.
  selection = "selected-2";
  await sendProjectMessage({ ...input, messageId: "new-receipt" }, dependencies);
  assert.equal(sent[1][0], "selected-2");
  open = false;
  await assert.rejects(sendProjectMessage(input, dependencies), /project is closed/);
  open = true; selection = null;
  await assert.rejects(sendProjectMessage(input, dependencies), /no selected session/);
  selection = "selected-3"; closing = true;
  await assert.rejects(sendProjectMessage(input, dependencies), /closing/);
  closing = false; denied = true;
  await assert.rejects(sendProjectMessage(input, dependencies), /Access revoked/);
  assert.equal(sent.length, 2);
  denied = false;
  dependencies.send = async () => { throw new Error("Assistant unavailable"); };
  await assert.rejects(sendProjectMessage(input, dependencies), /Assistant unavailable/);
});

test("the installed helper sends through its bound socket and supplies server-owned origin", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "project-message-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const calls = [];
  const service = createAgentSessionCommandService({
    projectService: {
      readCurrentProject: async () => ({ slug: "online", projectRoot: root }),
      runInProjectContext: async (slug, operation) => { assert.equal(slug, "online"); return operation(); },
      createSessionStore: async () => ({
        readSessionSourceDescriptor: async () => ({ metadata: { source_path: path.join(root, "sessions/active/source/source"), source_kind: "session_clone", source_path_authority: "managed_session_source" } }),
        readMetadataValue: async () => JSON.stringify({ submittedBy: { username: "owner" } })
      })
    },
    sendProjectMessage: async input => { calls.push(input); return { ok: true, sessionId: "selected", messageId: input.messageId }; },
    stopOwnedExecutions: async () => ({ supported: true, ok: true })
  });
  t.after(() => service.closeAllForSession("source"));
  const prepared = await prepareAgentSessionCommand({ commandService: service, sessionId: "source", wrapperHostDir: root });
  await prepareAgentHelperCommand({ wrapperHostDir: root });
  const result = await promisify(execFile)(path.join(root, "vibe64-helper"),
    ["session", "message-project", "jskit-ai", "Publish then ping online with the version.", "stable-id"],
    { env: { PATH: process.env.PATH, VIBE64_SESSION_RENAME_CONTROL: prepared.env.VIBE64_SESSION_RENAME_CONTROL } });
  assert.equal(JSON.parse(result.stdout).sessionId, "selected");
  assert.deepEqual(calls, [{ projectSlug: "jskit-ai", message: "Publish then ping online with the version.",
    messageId: "stable-id", sourceProject: "online", sourceSession: "source", actor: { username: "owner" } }]);
});
