import { describe, expect, it } from "vitest";
import {
  plannedRestartAfterText,
  plannedRestartCountdown,
  plannedRestartHeadline,
  plannedRestartPausedLabel
} from "../../src/lib/vibe64PlannedRestartPresentation.js";

// Times in the viewer's own zone, whatever zone the test runs in.
const at = (hours, minutes, seconds = 0) => new Date(2026, 10, 26, hours, minutes, seconds);
const restartAt = at(7, 40).toISOString();

describe("planned restart words", () => {
  it("counts down to the restart in whole minutes, then under a minute", () => {
    expect(plannedRestartCountdown(restartAt, at(7, 35).getTime())).toBe("in 5 minutes");
    expect(plannedRestartCountdown(restartAt, at(7, 38, 30).getTime())).toBe("in 2 minutes");
    expect(plannedRestartCountdown(restartAt, at(7, 39).getTime())).toBe("in 1 minute");
    expect(plannedRestartCountdown(restartAt, at(7, 39, 30).getTime())).toBe("in under a minute");
    expect(plannedRestartCountdown(restartAt, at(7, 40).getTime())).toBe("now");
  });

  it("names the time, the countdown and the reason, and what is paused", () => {
    expect(plannedRestartHeadline({ restartAt, reason: "Platform update." }, at(7, 36).getTime())).toBe(
      "This workspace restarts at 07:40 (in 4 minutes): Platform update. Save, Update, Preview starts and deploys are " +
      "paused until then; everything running then stops, and the AI picks up where it left off afterwards."
    );
    expect(plannedRestartPausedLabel({ restartAt })).toBe("Paused until 07:40: this workspace restarts then");
  });

  it("after the restart says calmly that nothing was lost, which AI picked up, and what stopped", () => {
    expect(plannedRestartAfterText({ restartedAt: restartAt, sessions: 2, stopped: [
      { label: "the command npm test", sessionName: "Checkout form" },
      { label: "Save", sessionName: "" }
    ] })).toBe("Restarted for an update at 07:40. Nothing was lost. The AI in the 2 sessions that were working picked up " +
      "where it left off. Stopped then: the command npm test (Checkout form); Save.");
    expect(plannedRestartAfterText({ restartedAt: restartAt, sessions: 0, stopped: [] }))
      .toBe("Restarted for an update at 07:40. Nothing was lost.");
  });

  it("ends with the reload when the update changed the page's code", () => {
    expect(plannedRestartAfterText({ restartedAt: restartAt, sessions: 1, stopped: [] }, { updated: true }))
      .toBe("Restarted for an update at 07:40. Nothing was lost. The AI that was working picked up where it left off. " +
        "Reload to get the latest version.");
  });
});
