import { describe, expect, it } from "vitest";
import { aiTaskFit } from "../../packages/vibe64-ai-tasks/src/client/aiTaskFit.js";
import {
  AI_TASK_ACTIONS as ACTIONS,
  aiTaskFooterActions,
  aiTaskOffersRename,
  projectAiTask
} from "../../packages/vibe64-ai-tasks/src/client/aiTaskProjection.js";

const CHECK = {
  by: "vibe64",
  label: "Vibe64 is running Update again…",
  retryLimit: 3,
  output: "Update output",
  unstoppable: "Update can't be interrupted. The fix ends as soon as this run finishes."
};

function task(fields = {}) {
  return {
    id: "task-1", kind: "update", title: "Fix Update", noun: "fix", tray: "Fixing Update…",
    steps: ["The AI repairs the conflicts", "Vibe64 runs Update again"], check: CHECK, revision: 1,
    phase: "working", active: true, reason: "", message: "", waiting: false, checkRunning: false,
    problem: { key: "update:review-1", summary: "Update found conflicts.", details: "" }, conflictReview: "review-1",
    conflictPaths: [], startedBy: null, endedBy: null, attempt: 1, report: "", log: [], diagnostic: "",
    ...fields
  };
}

const projected = (fields, viewerId = "ana") => projectAiTask(task(fields), { viewerId });
const actionIds = fields => projected(fields).actions.map(({ id }) => id);

describe("what the window says for each state", () => {
  it.each([
    ["starting", { phase: "starting" }, "Starting…", "Fixing Update…"],
    ["working", {}, "The AI is working on this", "Fixing Update…"],
    ["a later attempt", { attempt: 2 }, "The AI is trying again (attempt 2 of 3)", "Fixing Update…"],
    ["checking", { phase: "checking" }, CHECK.label, "Fixing Update…"],
    ["checking while waiting", { phase: "checking", waiting: true, message: "Waiting for another operation." },
      "Waiting for another operation.", "Fixing Update…"],
    ["cancelling", { phase: "cancelling" }, "Cancelling…", "Cancelling…"],
    ["done", { phase: "done", active: false, message: "Session updated." }, "Done", "Done"],
    ["not done", { phase: "not_done", active: false, message: "Cancelled." }, "Not done", "Not done"]
  ])("%s", (_name, fields, status, tray) => {
    expect(projected(fields)).toMatchObject({ status, tray });
  });

  it.each([
    ["question", "The AI needs your answer", "chat", [ACTIONS.ANSWER]],
    ["ai_stuck", "The AI could not finish this", "chat", [ACTIONS.END, ACTIONS.OPEN_CHAT]],
    ["no_result", "The AI stopped without saying it finished", "progress", [ACTIONS.OPEN_CHAT, ACTIONS.CHECK]],
    ["stopped", "Stopped. Tell the AI what to do next.", "progress", [ACTIONS.OPEN_CHAT, ACTIONS.CONTINUE]],
    ["ai_unavailable", "The AI account can't run this right now", "progress", [ACTIONS.AI_SETUP, ACTIONS.CONTINUE]],
    ["turn_failed", "The AI ran into an error", "progress", [ACTIONS.OPEN_CHAT, ACTIONS.CONTINUE]],
    ["interrupted", "Vibe64 restarted while the AI was working", "progress", [ACTIONS.CONTINUE]],
    ["unconfirmed", "Vibe64 couldn't confirm the result", "progress", [ACTIONS.CHECK]],
    ["draft_waiting", "The check failed. Your unsent message is waiting.", "chat", [ACTIONS.OPEN_CHAT]]
  ])("needs you because of %s", (reason, status, opensOn, actions) => {
    const fields = { phase: "needs_you", reason };
    expect(projected(fields)).toMatchObject({ status, opensOn, composerOpen: true, tray: "Needs you", glyph: "attention" });
    expect(actionIds(fields)).toEqual(actions);
  });

  it("a stuck check says what Update said and offers the review of resolved conflicts", () => {
    const fields = { phase: "needs_you", reason: "check_stuck", message: "Update stopped at src/pricing.js." };
    expect(projected(fields).status).toBe("Update stopped at src/pricing.js.");
    expect(actionIds(fields)).toEqual([ACTIONS.REVIEW, ACTIONS.OPEN_CHAT, ACTIONS.CHECK]);
    expect(actionIds({ ...fields, conflictReview: "" })).toEqual([ACTIONS.OPEN_CHAT, ACTIONS.CHECK]);
  });

  it("a stuck check adds Update's own words under the steps, once", () => {
    const stuck = { phase: "needs_you", reason: "check_stuck", message: "Update still has conflicts in 1 file." };
    expect(projected({ ...stuck, diagnostic: "Update stopped at src/pricing.js." }).note).toBe("Update stopped at src/pricing.js.");
    expect(projected({ ...stuck, message: "Update still needs attention: disk full", diagnostic: "disk full" }).note).toBe("");
  });

  it("only a question from the AI lights the Chat dot", () => {
    expect(projected({ phase: "needs_you", reason: "question" }).chatDot).toBe(true);
    expect(projected({ phase: "needs_you", reason: "stopped" }).chatDot).toBe(false);
    expect(projected({}).chatDot).toBe(false);
  });

  it("the person can write while the AI works and while it waits, and at no other time", () => {
    expect(projected({}).composerOpen).toBe(true);
    expect(projected({ phase: "needs_you", reason: "question" }).composerOpen).toBe(true);
    for (const phase of ["starting", "checking", "cancelling"]) expect(projected({ phase }).composerOpen).toBe(false);
    expect(projected({ phase: "done", active: false }).composerOpen).toBe(false);
  });

  it("the footer exists only when the person is needed", () => {
    expect(projected({}).actions).toEqual([]);
    expect(projected({ phase: "checking" }).actions).toEqual([]);
    expect(projected({ phase: "done", active: false }).actions).toEqual([]);
  });

  it("a Cancel during a check that cannot stop says so, and any other Cancel says nothing more", () => {
    expect(projected({ phase: "cancelling", checkRunning: true }).note).toBe(CHECK.unstoppable);
    expect(projected({ phase: "cancelling" }).note).toBe("");
  });
});

describe("the footer", () => {
  it.each([
    ["question", [ACTIONS.ANSWER], []],
    ["ai_stuck", [ACTIONS.END, ACTIONS.OPEN_CHAT], [ACTIONS.END]],
    ["stopped", [ACTIONS.OPEN_CHAT, ACTIONS.CONTINUE], [ACTIONS.CONTINUE]],
    ["draft_waiting", [ACTIONS.OPEN_CHAT], []]
  ])("drops what only leads to Chat once the person is there: %s", (reason, onProgress, onChat) => {
    const { actions } = projected({ phase: "needs_you", reason });
    expect(aiTaskFooterActions(actions, "progress").map(({ id }) => id)).toEqual(onProgress);
    expect(aiTaskFooterActions(actions, "chat").map(({ id }) => id)).toEqual(onChat);
  });
});

describe("Rename", () => {
  const free = { kind: "free", title: "AI task", noun: "task", renamable: true };

  it.each([
    ["working", {}],
    ["your turn", { phase: "needs_you", reason: "your_turn" }],
    ["cancelling", { phase: "cancelling" }],
    ["done", { phase: "done", active: false }],
    ["not done", { phase: "not_done", active: false }]
  ])("a task the server lets a person rename offers it while %s", (_name, fields) => {
    expect(projected({ ...free, ...fields }).renamable).toBe(true);
  });

  it("any other task, or one that does not say, offers no Rename", () => {
    expect(projected({ renamable: false }).renamable).toBe(false);
    expect(projected({}).renamable).toBe(false);
  });

  it("a window offers Rename only when its source can save a name", () => {
    const rename = async () => {};
    expect(aiTaskOffersRename(projected(free), { rename })).toBe(true);
    expect(aiTaskOffersRename(projected(free), {})).toBe(false);
    expect(aiTaskOffersRename(projected({}), { rename })).toBe(false);
  });
});

describe("the steps", () => {
  const states = fields => projected(fields).steps.map(({ state }) => state);

  it.each([
    ["working", {}, ["active", "pending"]],
    ["checking", { phase: "checking" }, ["done", "active"]],
    ["done", { phase: "done", active: false }, ["done", "done"]],
    ["a failed check", { phase: "needs_you", reason: "check_stuck" }, ["done", "failed"]],
    ["a stopped turn", { phase: "needs_you", reason: "stopped" }, ["active", "pending"]],
    ["cancelled while working", { phase: "not_done", active: false }, ["failed", "pending"]]
  ])("%s", (_name, fields, expected) => {
    expect(states(fields)).toEqual(expected);
  });

  it("the counted step shows its attempt", () => {
    expect(projected({ attempt: 2 }).steps[0].attempt).toBe("Attempt 2 of 3");
    expect(projected({ phase: "checking", attempt: 2 }).steps.map(({ attempt }) => attempt)).toEqual(["", "Attempt 2 of 3"]);
  });
});

describe("the outcome", () => {
  it("Done carries what happened and what the AI did", () => {
    const { outcome } = projected({ phase: "done", active: false, message: "Session updated.", report: "Merged both sides." });
    expect(outcome).toEqual({ heading: "Done", happened: "Session updated.", report: "Merged both sides.", next: "" });
  });

  it("Not done names who cancelled, and says You to that person", () => {
    const ended = { phase: "not_done", active: false, endedBy: { id: "bo", name: "Bo" } };
    expect(projected(ended, "ana").outcome.happened).toBe("Bo cancelled this fix.");
    expect(projected(ended, "bo").outcome.happened).toBe("You cancelled this fix.");
    expect(projected({ phase: "not_done", active: false }).outcome.happened).toBe("You cancelled this fix.");
  });

  it("Not done always says what to do next", () => {
    expect(projected({ phase: "not_done", active: false, message: "Archived." }).outcome).toMatchObject({
      happened: "Archived.",
      next: expect.stringContaining("To try again, close this and choose Fix it with AI.")
    });
  });
});

describe("how a window fits a screen", () => {
  it.each([
    [320, 568, true, true],
    [390, 844, true, true],
    [390, 500, true, true],
    [599, 900, true, true],
    [600, 844, false, false],
    [844, 390, true, false],
    [900, 559, true, false],
    [959, 800, false, false],
    [960, 560, false, false],
    [1280, 800, false, false],
    [1600, 1000, false, false]
  ])("%d by %d", (width, height, fullscreen, phone) => {
    expect(aiTaskFit(width, height)).toMatchObject({ fullscreen, phone });
  });

  it("a dialog has a fixed height, so the window never jumps", () => {
    expect(aiTaskFit(800, 900)).toMatchObject({ width: "min(92vw, 46rem)", height: "88dvh" });
    expect(aiTaskFit(1280, 800)).toMatchObject({ width: "46rem", height: "min(80dvh, 46rem)" });
  });
});
