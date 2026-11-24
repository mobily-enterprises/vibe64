import { describe, expect, it } from "vitest";
import { crashBannerHeadline, crashMemberLine, crashTimeText } from "../../src/lib/vibe64CrashPresentation.js";

// The crash banner's words (vibe64CrashPresentation.js): the time in the viewer's zone, the count, and a member's line
// without the error.

const local = (...parts) => new Date(...parts).toISOString();
const now = new Date(2026, 10, 24, 9, 30);
const fatal = {
  id: "20261124T041805123Z-4242-0a1b",
  at: local(2026, 10, 24, 4, 18, 5),
  kind: "fatal-error",
  error: { name: "Error", message: "read ECONNRESET", code: "ECONNRESET" },
  activeTurns: 2,
  resumed: 2
};

describe("crash banner words", () => {
  it("gives the time as HH:MM today, with the day before, and the year in another year", () => {
    expect(crashTimeText(local(2026, 10, 24, 4, 18), now)).toBe("04:18");
    expect(crashTimeText(local(2026, 10, 23, 23, 5), now)).toBe("23 Nov 23:05");
    expect(crashTimeText(local(2025, 11, 31, 8, 0), now)).toBe("31 Dec 2025 08:00");
    expect(crashTimeText("not a time", now)).toBe("an unknown time");
  });

  it("says what crashed for the owner, with the count when several wait", () => {
    expect(crashBannerHeadline(fatal, 1, now)).toBe("Vibe64 crashed at 04:18: read ECONNRESET.");
    expect(crashBannerHeadline(fatal, 3, now)).toBe("Vibe64 crashed 3 times; the last at 04:18: read ECONNRESET.");
    expect(crashBannerHeadline({ ...fatal, error: { name: "TypeError", message: "x is not a function" } }, 1, now))
      .toBe("Vibe64 crashed at 04:18: TypeError: x is not a function.");
    const untraced = { ...fatal, kind: "stopped-without-trace", error: null, lastHeartbeatAt: local(2026, 10, 24, 4, 17, 40), exit: { result: "oom-kill" } };
    expect(crashBannerHeadline(untraced, 1, now)).toBe("Vibe64 crashed at about 04:17: it stopped without a trace (oom-kill).");
  });

  it("tells a member when and what became of the AI work, never the error", () => {
    const line = crashMemberLine(fatal, 1, now);
    expect(line).toBe("Vibe64 crashed at 04:18 and restarted. The 2 AI turns that were running were resumed. The workspace owner can see what happened.");
    expect(crashMemberLine({ ...fatal, activeTurns: null }, 2, now))
      .toBe("Vibe64 crashed 2 times, the last at 04:18, and restarted. The workspace owner can see what happened.");
  });
});
