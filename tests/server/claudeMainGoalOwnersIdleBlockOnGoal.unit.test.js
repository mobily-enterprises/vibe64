import { test } from "node:test";
import { mainGoalOwnersScenario } from "./claudeMainGoalOwnersTestHelpers.js";

test("main Claude terminal service uses actual owners for an idle goal that blocks in its own turn and ends when the main AI changes", { timeout: 60000 }, t =>
  mainGoalOwnersScenario(t, { busyGoal: false, phases: ["block-on-goal"] }));
