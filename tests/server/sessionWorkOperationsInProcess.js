// A test's command runner that runs the session work child's operation in this process: when Save or Update asks it
// to start `node sessionWorkOperationCommand.js`, it runs that operation's own code (sessionWorkOperations.js), its
// Git commands started as the child starts them, in the child's folder and environment, and answers as the runner
// answers for the child. Each operation then costs its Git work, not a Node start and its module loading. The tests
// about the child itself, and the integration tests, keep starting the real child.
import path from "node:path";
import { runCaptureCommand } from "../../packages/vibe64-execution/src/server/engines/capture.js";
import { performSessionWorkOperation } from "../../packages/vibe64-terminals/src/server/sessionWorkOperations.js";

function isSessionWorkOperation(request) {
  return request.command === "node" && path.basename(String(request.args?.[0] || "")) === "sessionWorkOperationCommand.js";
}

/**
 * @param {(request: object) => Promise<object>} runner the test's runner, which starts every other command
 * @param {Record<string, string>} childEnv what that runner adds to this process's environment for a child
 */
function withSessionWorkOperationsInProcess(runner, childEnv = {}) {
  return async (request = {}) => {
    if (!isSessionWorkOperation(request)) return runner(request);
    const env = { ...process.env, ...childEnv, ...(request.env || {}) };
    const response = await performSessionWorkOperation(JSON.parse(String(request.input || "{}")), {
      runCommand: (command = {}) => runCaptureCommand(command.command, command.args, {
        cwd: command.cwd || request.cwd,
        env: { ...env, ...(command.env || {}) },
        execution: command.execution,
        input: command.input,
        maxBuffer: command.maxBuffer,
        outputEncoding: command.outputEncoding,
        timeout: command.timeout
      })
    });
    const stdout = JSON.stringify(response);
    return { ...(response.ok ? {} : { code: "git_failed" }), ok: response.ok, output: stdout, stderr: "", stdout };
  };
}

export { withSessionWorkOperationsInProcess };
