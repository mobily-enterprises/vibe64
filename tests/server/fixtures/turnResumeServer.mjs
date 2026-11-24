// The first server of turnResumeAfterKill.integration.test.js: it serves the goal harness at the folder it is
// given (claudeGoalTestHelpers.js, whose Claude is synthetic), sends Main chat a routed request whose turn keeps
// working, tells its test so, and runs until the test kills it.
import process from "node:process";
import { goalHarness } from "../claudeGoalTestHelpers.js";

const [root] = process.argv.slice(2);
const h = await goalHarness({ after() {} }, { root });
await h.inProject(async () => {
  await h.routeAsSenior();
  const sent = await h.service.sendAgentMessage("test", { message: "Keep working on the report", messageId: "keep-working" }, h.options);
  if (sent?.ok === false) throw new Error(`The request was refused: ${JSON.stringify(sent)}`);
  await h.waitFor(() => h.turnActive(), () => `The turn did not start: ${JSON.stringify(h.warnings)}`, 30_000);
});
process.send({ working: true });
// The test kills this process mid-turn; nothing here ends it.
setInterval(() => {}, 60_000);
