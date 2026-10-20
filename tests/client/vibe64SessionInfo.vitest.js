import { describe, expect, it } from "vitest";

import {
  safeRepositoryRemote,
  vibe64SessionInfoFacts,
  vibe64SessionInfoText
} from "../../src/lib/vibe64SessionInfo.js";

describe("Vibe64 session info", () => {
  it("projects safe, copyable operational context from the current session", () => {
    const facts = vibe64SessionInfoFacts({
      agentSession: {
        thread: { id: "thread-123" },
        turn: { id: "turn-456" }
      },
      manifest: { createdAt: "2026-08-17T01:02:03.000Z" },
      metadata: {
        base_branch: "main",
        base_commit: "1234567890abcdef",
        branch: "vibe64/2026-08-17_01-02-03",
        source_remote_url: "https://secret@example.test/company/dogandgroom.git?token=hidden"
      },
      sessionId: "2026-08-17_01-02-03",
      sessionRoot: "/home/sas/.local/state/vibe64/projects/dogandgroom/sessions/active/2026-08-17_01-02-03",
      sourcePath: "/home/merc/.local/state/vibe64/managed-sources/sas/projects/dogandgroom/sessions/active/2026-08-17_01-02-03/source",
      sourceReady: true,
      status: "active"
    }, {
      githubRepository: { fullName: "company/dogandgroom" }
    });

    expect(Object.fromEntries(facts.map((fact) => [fact.label, fact.copyValue]))).toMatchObject({
      "Agent thread": "thread-123",
      "Agent turn": "turn-456",
      "Base branch": "main",
      "Base commit": "1234567890abcdef",
      Branch: "vibe64/2026-08-17_01-02-03",
      Repository: "https://example.test/company/dogandgroom.git",
      Session: "2026-08-17_01-02-03",
      Source: "/home/merc/.local/state/vibe64/managed-sources/sas/projects/dogandgroom/sessions/active/2026-08-17_01-02-03/source"
    });
    const context = vibe64SessionInfoText(facts, { status: "active" });
    expect(context).toContain("Status: active");
    expect(context).toContain("Source: /home/merc/.local/state/vibe64/managed-sources/sas/projects/dogandgroom/sessions/active/2026-08-17_01-02-03/source");
    expect(context).not.toContain("secret");
    expect(context).not.toContain("token=hidden");
  });

  it("accepts safe Git SCP remotes and rejects ambiguous credential-bearing text", () => {
    expect(safeRepositoryRemote("git@example.test:company/project.git"))
      .toBe("git@example.test:company/project.git");
    expect(safeRepositoryRemote("not a remote token=secret")).toBe("");
  });

  it("has no facts without a selected session", () => {
    expect(vibe64SessionInfoFacts(null, { projectRoot: "/project" })).toEqual([]);
  });
});
