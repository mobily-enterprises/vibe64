import assert from "node:assert/strict";
import test from "node:test";
import { vibe64Driver } from "../../packages/vibe64-genesis/src/server/promptContext.js";
import { createCodexSessionEnvironment } from "../../packages/vibe64-terminals/src/server/codexSessionEnvironment.js";
import { createOpenCodeHostPreparation } from "../../packages/vibe64-terminals/src/server/openCodeHostPreparation.js";
import { assertPagesGuidance, PAGES_GUIDANCE_RULES } from "../fixtures/pagesGuidanceRules.js";

const sharedRuntime = () => ({ processes: new Map(), temporaryConversations: new Map() });

test("Codex and OpenCode guidance tells main and temporary chats about pages and when to offer one", () => {
  const codex = createCodexSessionEnvironment({ agentPagesCommand: {}, env: {} });
  const opencode = createOpenCodeHostPreparation({ agentPagesCommand: {}, env: {}, sharedRuntime: sharedRuntime() });
  for (const kind of ["main", "temporary"]) {
    const codexInput = codex.vibe64SessionContextInput(kind);
    const opencodeInput = opencode.promptContext(kind);
    assert.equal(codexInput.session.managedPages, true);
    assert.deepEqual(opencodeInput, codexInput, "both engines register the same engine-neutral input");
    assertPagesGuidance(assert, vibe64Driver(codexInput), `Codex ${kind}`);
    assertPagesGuidance(assert, vibe64Driver(opencodeInput), `OpenCode ${kind}`);
  }
});

test("without the pages command no engine is told about pages, and guidance registered before pages stays valid", () => {
  const codexInput = createCodexSessionEnvironment({ env: {} }).vibe64SessionContextInput();
  assert.equal(Object.hasOwn(codexInput.session, "managedPages"), false);
  const guidance = vibe64Driver(codexInput);
  for (const [rule, pattern] of PAGES_GUIDANCE_RULES) assert.doesNotMatch(guidance, pattern, rule);
  assert.doesNotMatch(guidance, /vibe64-helper pages/u);
  const earlier = { conversationKind: "main", scope: "session",
    session: { managedDatabaseRefresh: true, managedEnvironment: true, managedGit: true, managedPreview: true } };
  assert.equal(vibe64Driver(earlier), vibe64Driver({ ...earlier, session: { ...earlier.session, managedPages: false } }));
  assert.throws(() => vibe64Driver({ ...earlier, session: { ...earlier.session, managedPages: "yes" } }), /managedPages must be boolean/u);
});
