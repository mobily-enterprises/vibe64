import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { VIBE64_RUNTIME_NAMESPACE_ENV } from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import { createOutputTargetTerminalController } from "../../packages/vibe64-terminals/src/server/outputTargetTerminal.js";

process.env[VIBE64_RUNTIME_NAMESPACE_ENV] = "unit-owner";

// Each outputs read takes its session's launch lock, so the reads that arrived while one ran each queued a whole read
// of their own: pages polling a busy session waited 75 s for an answer. Reads waiting for the lock share the read that
// runs next, which still starts after they asked.

/**
 * How many times the session is read when `waiting` outputs reads arrive while one read is under way, and the
 * answers they get. `options` gives each waiting read its request.
 */
async function sessionReadsDuring(t, waiting, options = () => ({})) {
  const sessionId = `outputs-read-${crypto.randomUUID()}`;
  const metadata = {};
  const firstRead = Promise.withResolvers();
  const reading = Promise.withResolvers();
  let reads = 0;
  const controller = createOutputTargetTerminalController({
    env: process.env,
    ensureProjectServices: async () => {},
    ensureWorkspacePrepared: async () => ({ completion: null }),
    project: {
      currentProjectSlug: () => "",
      async createRuntime() {
        return {
          store: {
            async mutateSession(_id, update) { return update(); },
            async readMetadataValue(_id, key) { return metadata[key] || ""; },
            async writeMetadataValue(_id, key, value) { metadata[key] = value; }
          },
          async getSession() {
            reads += 1;
            if (reads === 1) {
              reading.resolve();
              await firstRead.promise;
            }
            return { sessionId, metadata };
          },
          async getSessionWithoutSource() { return { sessionId, metadata }; }
        };
      },
      createRuntimeWithoutSource(runtimeOptions) { return this.createRuntime(runtimeOptions); }
    },
    publishSessionChanged: async () => {},
    runCommand: async () => ({ ok: false, error: "This test never launches a Preview." }),
    sessionAdmissionFailure: () => null,
    stopPreviewBrowsers: async () => ({ ok: true })
  });
  t.after(() => controller.close());
  const first = controller.launchStatus(sessionId);
  await reading.promise;
  const later = Array.from({ length: waiting }, (_value, index) => controller.launchStatus(sessionId, options(index)));
  firstRead.resolve();
  const answers = await Promise.all([first, ...later]);
  return { answers, reads };
}

test("outputs reads that arrive while one runs share the next read, however many arrive", async (t) => {
  const few = await sessionReadsDuring(t, 2);
  const many = await sessionReadsDuring(t, 20);
  assert.equal(many.reads, few.reads, `session reads: ${few.reads} for 2 waiting reads, ${many.reads} for 20`);
  // The one under way, then one for all that waited: none is answered by the read that began before it asked.
  assert.equal(few.reads, 2);
  for (const { answers } of [few, many]) {
    assert.ok(answers.every((answer) => typeof answer?.ok === "boolean"), JSON.stringify(answers[0]));
    assert.deepEqual(new Set(answers.slice(1).map((answer) => JSON.stringify(answer))).size, 1);
  }
});

test("outputs reads for different requests do not share an answer", async (t) => {
  const hosts = await sessionReadsDuring(t, 4, (index) => ({ publicHost: index % 2 ? "a.example.test" : "b.example.test" }));
  assert.equal(hosts.reads, 3);
});
