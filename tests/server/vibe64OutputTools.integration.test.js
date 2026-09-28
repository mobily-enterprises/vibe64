import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { createServiceToolCatalog } from "@jskit-ai/assistant-core/server";
import { runWithProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { createTerminalActions } from "../../packages/vibe64-terminals/src/server/actions.js";
import { createPreviewPreparationFixture } from "../fixtures/previewPreparation.js";

test("native output tools inspect, launch, restart, stop and close a real declared preview", { timeout: 20_000 }, async (t) => {
  const fixture = await createPreviewPreparationFixture();
  let projectContext = {};
  t.after(() => runWithProjectRequestContext(projectContext, () => fixture.close()));
  const literal = "literal $(not-executed) {port}";
  const stack = (await readFile(fixture.stackPath, "utf8"))
    .replace("`{host}` `{port}`", "`{host}` `{port}` `{parameter:audience}`")
    .replace("#### Presentation", "#### Parameter `audience`: Audience\n- Default: `Everyone`\n- Required.\n\n#### Presentation");
  const extraTargets = Array.from({ length: 12 }, (_, index) => `
### Target \`extra-${index}\`: Extra ${index}
- Mode: \`interactive\`
- Runtimes: \`nodejs\`
- Run \`Print\`: \`node\` \`-e\` \`console.log('done')\`
#### Presentation
- Kind: \`terminal\`
`).join("\n");
  await writeFile(fixture.stackPath, stack + extraTargets);
  await writeFile(path.join(fixture.sourceRoot, "preview.cjs"), `
console.log("Output tool fixture started");
require("node:http").createServer((_request, response) => {
  response.end(process.argv[4]);
}).listen(Number(process.argv[3]), process.argv[2]);
`);
  const { slug } = await fixture.project.readCurrentProject();
  assert.ok(slug);
  projectContext = { slug, vibe64User: { username: "owner", role: "owner" } };
  const actions = createActionCatalogue();
  actions.register({ contributorId: "output-lifecycle", domain: "terminals", actions:
    createTerminalActions({ terminals: fixture.terminals }).map(action => ({
      channels: ["api", "automation"], surfaces: ["app"], ...action
    })) });
  const catalog = createServiceToolCatalog(actions, { maxDirectTools: 100 });
  const context = { channel: "automation", surface: "app" };
  const toolSet = catalog.resolveToolSet(context);
  async function call(operation, input = {}) {
    const tool = toolSet.tools.find(({ actionId }) => actionId === `vibe64.terminals.${operation}`);
    assert.ok(tool, operation);
    const response = await runWithProjectRequestContext(projectContext, () =>
      catalog.executeToolCall({ toolName: tool.name, toolSet, context,
        argumentsText: JSON.stringify({ projectSlug: slug, sessionId: fixture.sessionId, ...input }) }));
    assert.equal(response.ok, true, JSON.stringify(response));
    assert.equal(response.result.ok, true, JSON.stringify(response.result));
    return response.result;
  }
  async function eventually(operation) {
    let failure;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try { return await operation(); } catch (error) { failure = error; }
      await delay(30);
    }
    throw failure;
  }

  const before = await call("outputs.read");
  assert.equal(before.outputTargetCount, 13);
  assert.equal(before.outputTargets.length, 10);
  assert.equal(before.nextTargetOffset, 10);
  assert.equal(before.activeTerminal, undefined);
  const remaining = await call("outputs.read", { targetOffset: before.nextTargetOffset });
  assert.equal(remaining.outputTargets.length, 3);
  assert.equal(remaining.nextTargetOffset, null);
  assert.equal(new Set([...before.outputTargets, ...remaining.outputTargets].map(target => target.id)).size, 13);
  const target = await call("outputs.read", { outputTargetId: "app" });
  assert.equal(target.outputTargetCount, 1);
  assert.equal(target.outputTargets[0].parameters[0].default, "Everyone");
  assert.equal(await fixture.setupRuns(), 0, "inspection must not prepare or start an output");

  const started = await call("output-target.start", { outputTargetId: "app", outputParameters: { audience: literal } });
  assert.equal(started.status, "running");
  assert.equal(Object.hasOwn(started, "metadata"), false);
  await eventually(async () => {
    const actual = await runWithProjectRequestContext(projectContext, () => fixture.terminals.readOutputTargetTerminal(fixture.sessionId, started.id));
    assert.equal(actual.ok, true, JSON.stringify(actual));
    const response = await fetch(actual.metadata.targetUrl);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), literal);
  });
  await eventually(async () => {
    const state = await call("outputs.read", { outputTargetId: "app" });
    assert.equal(state.preview.state, "ready");
    assert.equal(state.preview.terminalId, started.id);
    assert.deepEqual(state.outputTargets[0].currentParameters, { audience: literal });
    assert.equal(Object.hasOwn(state.preview, "href"), false);
    assert.equal(JSON.stringify(state).includes(fixture.sourceRoot), false);
  });
  const restarted = await call("output-target.start", { outputTargetId: "app", outputParameters: { audience: literal }, forceRestart: true });
  assert.notEqual(restarted.id, started.id);
  await eventually(async () => {
    const state = await call("outputs.read", { outputTargetId: "app" });
    assert.equal(state.preview.state, "ready");
    assert.equal(state.preview.terminalId, restarted.id);
    assert.deepEqual(state.outputTargets[0].currentParameters, { audience: literal });
  });
  const superseded = await runWithProjectRequestContext(projectContext, () => fixture.terminals.readOutputTargetTerminal(fixture.sessionId, started.id));
  assert.equal(superseded.ok, false, "restart cleans up the previous terminal");
  assert.equal(await fixture.setupRuns(), 1);
  const log = await call("output-terminal.read", { terminalSessionId: restarted.id });
  assert.match(log.output, /Output tool fixture started/u);
  assert.equal(log.outputTruncated, false);

  const stopping = await call("output-target.stop", { terminalSessionId: restarted.id });
  assert.ok(["closing", "exited"].includes(stopping.status), JSON.stringify(stopping));
  await eventually(async () => {
    const stopped = await call("output-terminal.read", { terminalSessionId: restarted.id });
    assert.equal(stopped.status, "exited");
    assert.match(stopped.output, /Output tool fixture started/u);
  });
  const closed = await call("output-terminal.close", { terminalSessionId: restarted.id });
  assert.equal(closed.closed, true);
  const removed = await runWithProjectRequestContext(projectContext, () => fixture.terminals.readOutputTargetTerminal(fixture.sessionId, restarted.id));
  assert.equal(removed.ok, false);
});
