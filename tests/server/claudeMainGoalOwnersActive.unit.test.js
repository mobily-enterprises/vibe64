import { test } from "node:test";
import { mainGoalOwnersScenario } from "./claudeMainGoalOwnersTestHelpers.js";

test("main Claude terminal service uses actual owners for an active goal", { timeout: 60000 }, t =>
  mainGoalOwnersScenario(t, { busyGoal: true, phases: ["send-and-raw-goal"] }));
