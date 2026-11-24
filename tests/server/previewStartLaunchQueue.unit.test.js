import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { VIBE64_RUNTIME_NAMESPACE_ENV } from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import { createOutputTargetTerminalController } from "../../packages/vibe64-terminals/src/server/outputTargetTerminal.js";

process.env[VIBE64_RUNTIME_NAMESPACE_ENV] = "unit-owner";

// After a VPS restart a session's workspace preparation runs for minutes. A Preview start used to wait for it while
// holding the session's launch lock, so every other Preview request queued behind it: the outputs read, Open, the
// identity switch, Stop and the session's close, each past the hosted edge's minute ("Request failed with status
// 504."). They must answer at once, and a Stop or a close meanwhile must win over the waiting start.
const ANSWER_MS = 1_000;

function within(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    })
  ]).finally(() => clearTimeout(timer));
}

/** A controller over one in-memory session whose workspace preparation runs until the test ends it. */
function preparingWorld(t) {
  const sessionId = `launch-queue-${crypto.randomUUID()}`;
  const metadata = {};
  const preparation = Promise.withResolvers();
  const preparing = Promise.withResolvers();
  const state = { frozen: null, launched: 0, preparations: 0 };
  const store = {
    async mutateSession(_id, update) { return update(); },
    async readMetadataValue(_id, key) { return metadata[key] || ""; },
    async writeMetadataValue(_id, key, value) { metadata[key] = value; }
  };
  const controller = createOutputTargetTerminalController({
    env: process.env,
    ensureProjectServices: async () => {},
    async ensureWorkspacePrepared() {
      state.preparations += 1;
      preparing.resolve();
      return { completion: preparation.promise };
    },
    project: {
      currentProjectSlug: () => "",
      async createRuntime() {
        return {
          store,
          async getSession() { return { sessionId, metadata }; },
          getSessionWithoutSource(id) { return this.getSession(id); }
        };
      },
      createRuntimeWithoutSource(options) { return this.createRuntime(options); }
    },
    publishSessionChanged: async () => null,
    async runCommand() {
      state.launched += 1;
      return { ok: false, error: "This test never launches a Preview." };
    },
    sessionAdmissionFailure: () => state.frozen,
    stopPreviewBrowsers: async () => ({ ok: true })
  });
  t.after(async () => {
    preparation.resolve({ status: "succeeded" });
    await controller.close();
  });
  return {
    controller,
    finishPreparation: () => preparation.resolve({ status: "succeeded" }),
    preparing: preparing.promise,
    sessionId,
    state
  };
}

test("while a Preview start waits for the workspace preparation, Stop answers at once and the start then stops unstarted",
  async (t) => {
    const world = preparingWorld(t);
    const starting = world.controller.startTerminal(world.sessionId, { outputTargetId: "app" });
    await world.preparing;
    const stopped = await within(world.controller.stopTerminal(world.sessionId, ""), ANSWER_MS,
      "Stop waited for the workspace preparation behind a Preview start");
    assert.equal(stopped.ok, true, JSON.stringify(stopped));
    world.finishPreparation();
    const started = await starting;
    assert.equal(started.ok, false, JSON.stringify(started));
    assert.equal(started.code, "vibe64_preview_stopped");
    assert.equal(world.state.launched, 0);
    assert.equal(world.state.preparations, 1);
  });

test("while a Preview start waits for the workspace preparation, the outputs read, Open and the identity switch answer at once",
  async (t) => {
    const world = preparingWorld(t);
    const starting = world.controller.startTerminal(world.sessionId, { outputTargetId: "app" });
    await world.preparing;
    // A renewal freezes the session meanwhile: each read must reach its admission at once and say so, never queue
    // behind the start.
    world.state.frozen = {
      ok: false,
      code: "vibe64_session_renewal_quiesced",
      error: "Session renewal has frozen preview access."
    };
    for (const [name, read] of [
      ["the outputs read", () => world.controller.launchStatus(world.sessionId)],
      ["Open", () => world.controller.openOutputTarget(world.sessionId)],
      ["the identity switch", () => world.controller.selectPreviewIdentity(world.sessionId, { identityName: "admin" })]
    ]) {
      const answer = await within(read(), ANSWER_MS, `${name} waited for the workspace preparation behind a Preview start`);
      assert.equal(answer.ok, false, `${name}: ${JSON.stringify(answer)}`);
      assert.match(`${answer.code} ${answer.error}`, /renewal/u, name);
    }
    world.finishPreparation();
    const started = await starting;
    assert.equal(started.ok, false, JSON.stringify(started));
    assert.equal(started.code, "vibe64_session_renewal_quiesced");
    assert.equal(world.state.launched, 0);
  });

test("while a Preview start waits for the workspace preparation, the session's close answers at once and the start then refuses",
  async (t) => {
    const world = preparingWorld(t);
    const starting = world.controller.startTerminal(world.sessionId, { outputTargetId: "app" });
    await world.preparing;
    await within(world.controller.closeAllForSession(world.sessionId), ANSWER_MS,
      "the session's close waited for the workspace preparation behind a Preview start");
    world.finishPreparation();
    const started = await starting;
    assert.equal(started.ok, false, JSON.stringify(started));
    assert.equal(started.code, "vibe64_session_closing");
    assert.equal(world.state.launched, 0);
  });
