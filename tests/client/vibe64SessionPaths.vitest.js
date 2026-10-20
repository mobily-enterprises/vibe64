import { describe, expect, it } from "vitest";

import {
  vibe64SessionSourcePath
} from "../../src/lib/vibe64SessionPaths.js";

describe("Vibe64 session source paths", () => {
  it("accepts a managed session checkout from its explicit source descriptor", () => {
    const sourcePath = "/home/merc/.local/state/vibe64/managed-sources/merc/projects/demo/sessions/active/session-1/source";
    const session = {
      metadata: {
        repository_mode: "github",
        source_kind: "session_clone",
        source_path: sourcePath,
        source_path_authority: "managed_session_source"
      },
      sessionId: "session-1",
      sessionRoot: "/home/merc/.local/state/vibe64/demo/session-1"
    };

    expect(vibe64SessionSourcePath(session)).toBe(sourcePath);
  });

  it("rejects a standalone authority folder presented as a session source", () => {
    const standaloneSourceRoot = "/home/merc/Development/current/demo";
    const session = {
      metadata: {
        repository_mode: "local_source",
        source_path: standaloneSourceRoot
      },
      sessionId: "session-1",
      sessionRoot: "/home/merc/.local/state/vibe64/demo/session-1",
      standaloneSourceRoot
    };

    expect(vibe64SessionSourcePath(session)).toBe("");
  });

  it("never treats a project namespace or retired targetRoot field as source", () => {
    const projectNamespace = "/home/merc/.local/state/vibe64/managed-sources/merc/projects/demo";
    const session = {
      metadata: {
        repository_mode: "github",
        source_path: projectNamespace
      },
      sessionId: "session-1",
      sessionRoot: "/home/merc/.local/state/vibe64/demo/session-1",
      standaloneSourceRoot: projectNamespace,
      targetRoot: projectNamespace
    };

    expect(vibe64SessionSourcePath(session)).toBe("");
  });
});
