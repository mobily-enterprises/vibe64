import { test } from "node:test";
import { mainGoalOwnersScenario } from "./claudeMainGoalOwnersTestHelpers.js";

test("main Claude terminal service uses actual owners for an idle goal Claude pauses, resumes and blocks itself", { timeout: 60000 }, t =>
  mainGoalOwnersScenario(t, { busyGoal: false, phases: ["self-controls"] }));
