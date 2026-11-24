import { describe, expect, it } from "vitest";
import {
  followLaunchStart,
  launchStartAnswerHeld,
  launchStartWaitingLabel,
  newLaunchStartId
} from "../../src/lib/vibe64LaunchStart.js";

// A Preview start answers at once while it waits (for the workspace preparation, after a restart for minutes) and goes
// on at the server; the page follows it through the outputs read in words, never showing an edge's status code.
const NO_DELAYS = Object.freeze([0]);

function readsOf(...answers) {
  const reads = [...answers];
  return async () => {
    const next = reads.length > 1 ? reads.shift() : reads[0];
    if (next instanceof Error) throw next;
    return next;
  };
}

describe("a Preview start the server holds", () => {
  it("names a start once, recognizes a held answer and says what it waits for in words", () => {
    const id = newLaunchStartId();
    expect(id).toMatch(/^start_[A-Za-z0-9_-]{8,94}$/u);
    expect(newLaunchStartId()).not.toBe(id);
    expect(launchStartAnswerHeld({ ok: true, starting: true, startId: id })).toBe(true);
    expect(launchStartAnswerHeld({ ok: true, id: "terminal-1" })).toBe(false);
    expect(launchStartWaitingLabel("workspace-preparation")).toBe("Waiting for the workspace preparation to finish");
    expect(launchStartWaitingLabel("launch-queue")).toBe("Waiting for another Preview change to finish");
    expect(launchStartWaitingLabel("starting")).toBe("Starting Preview");
    expect(launchStartWaitingLabel("unconfirmed")).toBe("Checking whether Preview is starting");
  });

  it("follows the start in words until it runs, through a read that fails on the way", async () => {
    const labels = [];
    const outcome = await followLaunchStart({ startId: "start_tab_1", waitingFor: "workspace-preparation" }, {
      delays: NO_DELAYS,
      read: readsOf(
        [{ startId: "start_tab_1", status: "starting", waitingFor: "workspace-preparation" }],
        Object.assign(new Error("Request failed with status 504."), { status: 504 }),
        [{ startId: "start_other", status: "starting", waitingFor: "starting" },
          { startId: "start_tab_1", status: "starting", waitingFor: "starting" }],
        [{ startId: "start_tab_1", status: "started", terminalSessionId: "terminal-7" }]
      ),
      waiting: label => labels.push(label)
    });
    expect(outcome).toEqual({ ok: true, terminalSessionId: "terminal-7" });
    expect(labels).toContain("Waiting for the workspace preparation to finish");
    expect(labels).toContain("Starting Preview");
    expect(labels.join(" ")).not.toMatch(/status|504/u);
  });

  it("ends a refused start with its words, its code and the admission it was refused by", async () => {
    const outcome = await followLaunchStart({ startId: "start_tab_2", waitingFor: "starting" }, {
      delays: NO_DELAYS,
      read: readsOf([{
        startId: "start_tab_2",
        status: "failed",
        code: "vibe64_capacity_rejected",
        error: "This workspace has no room for another Preview now.",
        admissionId: "6f1c2a9e-0b7d-4c3e-9a1f-2d4e5f6a7b8c"
      }]),
      waiting() {}
    });
    expect(outcome).toEqual({
      ok: false,
      code: "vibe64_capacity_rejected",
      error: "This workspace has no room for another Preview now.",
      admissionId: "6f1c2a9e-0b7d-4c3e-9a1f-2d4e5f6a7b8c"
    });
  });

  it("says in words when the editor no longer knows the start, or never received it, or cannot be reached", async () => {
    const forgotten = await followLaunchStart({ startId: "start_tab_3", waitingFor: "workspace-preparation" }, {
      delays: NO_DELAYS,
      read: readsOf([{ startId: "start_tab_3", status: "starting", waitingFor: "workspace-preparation" }], []),
      waiting() {}
    });
    expect(forgotten).toEqual({ ok: false, error: "Vibe64 restarted while Preview was starting. Start it again." });

    const unreceived = await followLaunchStart({ startId: "start_tab_4", waitingFor: "unconfirmed" }, {
      delays: NO_DELAYS,
      read: readsOf([]),
      waiting() {}
    });
    expect(unreceived).toEqual({ ok: false, error: "Vibe64 did not receive this Preview start. Start it again." });

    const unreachable = await followLaunchStart({ startId: "start_tab_5", waitingFor: "starting" }, {
      delays: NO_DELAYS,
      read: readsOf(Object.assign(new Error("Network request failed."), { status: 0 })),
      waiting() {}
    });
    expect(unreachable.ok).toBe(false);
    expect(unreachable.error).toBe("Vibe64 could not be reached to follow this Preview start. Check Preview, and " +
      "start it again if it is not running.");
  });

  it("stops following, with nothing to say, once the page moves on", async () => {
    const moved = new AbortController();
    const following = followLaunchStart({ startId: "start_tab_6", waitingFor: "starting" }, {
      delays: Object.freeze([20]),
      read: readsOf([{ startId: "start_tab_6", status: "starting", waitingFor: "starting" }]),
      signal: moved.signal,
      waiting() {}
    });
    moved.abort();
    expect(await following).toBe(null);
  });
});
