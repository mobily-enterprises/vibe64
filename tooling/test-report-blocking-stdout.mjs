// Loaded into each server test file's process by npm run test:full
// (tooling/run-server-tests.mjs). A test file's process reports its results to
// the runner through its stdout, a pipe. Node writes to a full pipe later, from
// the event loop, and --test-force-exit ends the process with process.exit()
// once its tests are done, dropping what was still waiting: a busy runner that
// had not read the pipe in time lost the end of a file's report, its last tests
// and its summary, and still counted the file as passed. Blocking writes finish
// before the process can exit. Only the test file's own process blocks: the
// servers and commands its tests start inherit this preload too.
import process from "node:process";

const handle = process.stdout._handle;
const reportsToRunner = process.env.NODE_TEST_CONTEXT === "child-v8" && /\.test\.m?js$/u.test(process.argv[1] || "");
if (reportsToRunner && typeof handle?.setBlocking === "function") handle.setBlocking(true);
