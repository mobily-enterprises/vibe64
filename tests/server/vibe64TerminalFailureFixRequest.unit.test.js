import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_TERMINAL_FAILURE_TAIL_LINES,
  projectToolFailureFixPrompt,
  sessionTerminalFailureFixPrompt,
  terminalFailureFixRequestForSession,
  terminalFailureOutputTail
} from "@local/vibe64-runtime/server/terminalFailureFixRequest";
import {
  questionBatchLimitInstruction
} from "@local/vibe64-adapters/server/promptQuestionPolicy";

test("terminal failure fix requests capture the last 200 terminal lines", () => {
  const output = Array.from({ length: DEFAULT_TERMINAL_FAILURE_TAIL_LINES + 5 }, (_, index) => `line-${index + 1}`)
    .join("\n");

  const tail = terminalFailureOutputTail(output);

  const tailLines = tail.split("\n");
  assert.equal(tailLines.length, DEFAULT_TERMINAL_FAILURE_TAIL_LINES);
  assert.equal(tailLines[0], "line-6");
  assert.equal(tailLines.at(-1), `line-${DEFAULT_TERMINAL_FAILURE_TAIL_LINES + 5}`);
});

test("terminal failure fix requests are built from server session state", () => {
  const request = terminalFailureFixRequestForSession({
    currentStep: "review_and_validate",
    sessionId: "session-1",
    stepMachine: {
      status: "waiting_for_input"
    }
  }, {
    actionId: "build",
    actionLabel: "Build app",
    attemptedCommand: "bash -lc 'npm run build'",
    closeError: "Command exited with code 1",
    commandPreview: "npm run build",
    exitCode: "1",
    output: "older\nlatest failure",
    terminalKind: "command",
    terminalSessionId: "terminal-1",
    terminalStatus: "exited",
    userMessage: "This looked stuck before I stopped it."
  });

  assert.equal(request.ok, true);
  assert.equal(request.outputTail, "older\nlatest failure");
  assert.match(request.prompt, /"kind": "consider_resolved"/u);
  assert.match(request.prompt, /"stepId": "review_and_validate"/u);
  assert.match(request.prompt, /"stepStatus": "waiting_for_input"/u);
  assert.match(request.prompt, /"kind": "waiting_for_input"/u);
  assert.match(request.prompt, /write the same question or blocker in normal response text/u);
  assert.match(request.prompt, /\[ui:verification\]/u);
  assert.match(request.prompt, /npx jskit app verify-ui --command/u);
  assert.match(request.prompt, /\.jskit\/verification\/ui\.json/u);
  assert.match(request.prompt, new RegExp(escapeRegExp(questionBatchLimitInstruction()), "u"));
  assert.match(request.prompt, /format each question on its own line as `\[1\] Question text`/u);
  assert.match(request.prompt, /- Session: session-1/u);
  assert.match(request.prompt, /- Subject: Build app/u);
  assert.match(request.prompt, /- Attempted command: bash -lc 'npm run build'/u);
  assert.match(request.prompt, /- Command: npm run build/u);
  assert.match(request.prompt, /This looked stuck before I stopped it\./u);
  assert.match(request.prompt, /latest failure/u);
});

test("session Fix Codex prompts use ephemeral job reporting", () => {
  const prompt = sessionTerminalFailureFixPrompt({
    actionId: "build",
    actionLabel: "Build app",
    attemptedCommand: "bash -lc 'npm run build'",
    closeError: "Command exited with code 1",
    commandPreview: "npm run build",
    currentStep: "review_and_validate",
    exitCode: "1",
    output: "latest failure",
    sessionId: "session-1",
    stepStatus: "waiting_for_input",
    targetRoot: "/workspace/app",
    terminalKind: "command",
    terminalSessionId: "terminal-1",
    terminalStatus: "exited",
    worktreePath: "/workspace/app/.vibe64-local/sessions/active/session-1/worktree"
  });

  assert.match(prompt, /ephemeral repair job/u);
  assert.match(prompt, /Fix Codex callback helper/u);
  assert.match(prompt, /- Scope: session/u);
  assert.match(prompt, /- Worktree: \/workspace\/app\/\.vibe64-local\/sessions\/active\/session-1\/worktree/u);
  assert.match(prompt, /- Attempted command: bash -lc 'npm run build'/u);
  assert.match(prompt, /latest failure/u);
  assert.match(prompt, /Fix Codex callback helper/u);
  assert.doesNotMatch(prompt, /consider_resolved/u);
});

test("project tool Fix Codex prompts preserve attempted command ownership", () => {
  const prompt = projectToolFailureFixPrompt({
    attemptedCommand: "bash -lc 'sh -c '\\''echo \"failing intentionally\"; exit 1'\\'''",
    commandPreview: "sh -c 'echo \"failing intentionally\"; exit 1'",
    exitCode: "1",
    output: "failing intentionally",
    terminalSessionId: "terminal-1",
    terminalStatus: "exited",
    targetRoot: "/workspace/app",
    toolId: "sync_main_with_main",
    toolLabel: "Sync main with main"
  }, {
    reportInstructions: "Report through the callback."
  });

  assert.match(prompt, /main project checkout/u);
  assert.match(prompt, /exact Attempted command/u);
  assert.match(prompt, /do not guess a replacement command/u);
  assert.match(prompt, /Report `blocked`/u);
  assert.match(prompt, /- Target root: \/workspace\/app/u);
  assert.match(prompt, /- Attempted command: bash -lc/u);
  assert.match(prompt, /failing intentionally/u);
});

function escapeRegExp(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
