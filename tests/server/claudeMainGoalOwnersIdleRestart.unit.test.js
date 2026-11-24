import { test } from "node:test";
import { mainGoalOwnersScenario } from "./claudeMainGoalOwnersTestHelpers.js";

test("main Claude terminal service uses actual owners for an idle goal through its restarts and recovery", { timeout: 60000 }, t =>
  mainGoalOwnersScenario(t, { busyGoal: false, phases: ["send-and-raw-goal", "stopped-first-goals", "restart-refusals"] }));
