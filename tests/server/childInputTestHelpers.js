/**
 * Ends a child's input. A command can exit without reading all of it (Git
 * refusing a request, a helper rejecting its arguments); on a busy machine the
 * write then fails with EPIPE. The exit status and output still say what
 * happened, so only other write failures fail the test.
 * @param {import("node:child_process").ChildProcess} child
 * @param {string | Buffer | undefined} input
 */
function endChildInput(child, input) {
  child.stdin.on("error", (error) => {
    if (error.code !== "EPIPE") throw error;
  });
  child.stdin.end(input);
}

export { endChildInput };
