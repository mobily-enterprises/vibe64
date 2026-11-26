import assert from "node:assert/strict";
import test from "node:test";
import { vibe64Driver } from "../../packages/vibe64-genesis/src/server/promptContext.js";
import { createCodexSessionEnvironment } from "../../packages/vibe64-terminals/src/server/codexSessionEnvironment.js";
import { createOpenCodeHostPreparation } from "../../packages/vibe64-terminals/src/server/openCodeHostPreparation.js";
import { assertPlanCommandGuidance } from "../fixtures/planCommandGuidanceRules.js";

const sharedRuntime = () => ({ processes: new Map(), temporaryConversations: new Map() });

// 2026-11-26: after the release, a session's engine resumed its conversation with freshly built guidance that said
// nothing about the plan commands, and its next turn, a plan's UI pass, carried only its pass instructions. The agent's
// only plan-command knowledge was the plan guidance of earlier turns, from an older release. Codex reads this guidance
// as developer instructions on each thread start and resume, OpenCode as its session context: every session
// conversation has the plan command, with or without the other managed commands.
test("Codex and OpenCode session guidance, rebuilt as each conversation starts or resumes, gives the plan commands' current inputs", () => {
  for (const commands of [{}, { agentPagesCommand: {}, agentPreviewCommand: {}, agentDatabaseCommand: {}, agentEnvCommand: {}, codexGitCommand: {} }]) {
    const codex = createCodexSessionEnvironment({ ...commands, env: {} });
    const opencode = createOpenCodeHostPreparation({ ...commands, env: {}, sharedRuntime: sharedRuntime() });
    for (const kind of ["main", "temporary"]) {
      const label = `${kind} with ${Object.keys(commands).length} other managed commands`;
      assertPlanCommandGuidance(assert, vibe64Driver(codex.vibe64SessionContextInput(kind)), `Codex ${label}`);
      assertPlanCommandGuidance(assert, vibe64Driver(opencode.promptContext(kind)), `OpenCode ${label}`);
    }
  }
});
