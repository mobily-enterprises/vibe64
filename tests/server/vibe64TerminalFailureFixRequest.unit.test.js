import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_TERMINAL_FAILURE_TAIL_LINES,
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
    currentStep: "project_validated",
    sessionId: "session-1",
    stepMachine: {
      status: "waiting_for_input"
    }
  }, {
    actionId: "build",
    actionLabel: "Build app",
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
  assert.match(request.prompt, /"stepId": "project_validated"/u);
  assert.match(request.prompt, /"stepStatus": "waiting_for_input"/u);
  assert.match(request.prompt, /"kind": "waiting_for_input"/u);
  assert.match(request.prompt, /write the same question or blocker in normal Codex response text/u);
  assert.match(request.prompt, new RegExp(escapeRegExp(questionBatchLimitInstruction()), "u"));
  assert.match(request.prompt, /format each question on its own line as `\[1\] Question text`/u);
  assert.match(request.prompt, /- Session: session-1/u);
  assert.match(request.prompt, /- Subject: Build app/u);
  assert.match(request.prompt, /- Command: npm run build/u);
  assert.match(request.prompt, /This looked stuck before I stopped it\./u);
  assert.match(request.prompt, /latest failure/u);
});

function escapeRegExp(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
