import { describe, expect, it } from "vitest";

import {
  vibe64SaveTargetRepository,
  vibe64SessionSaveTarget
} from "../../src/lib/vibe64SessionSaveTarget.js";

const githubProject = {
  repository: { defaultBranch: "main", github: { fullName: "example-owner/example-app" }, mode: "github" },
  repositoryMode: "github"
};

describe("Vibe64 session Save target", () => {
  it("says a main-branch destination plainly", () => {
    expect(vibe64SessionSaveTarget(
      { branch: "main", mode: "github", repository: "example-owner/example-app", sessionId: "session-1" },
      githubProject
    )).toEqual({
      branch: "main",
      note: "",
      offMain: false,
      repository: "example-owner/example-app",
      text: "example-owner/example-app · main"
    });
  });

  it("marks a branch other than the project's main branch, naming that branch", () => {
    expect(vibe64SessionSaveTarget(
      { branch: "example-feature", mode: "github", repository: "example-owner/example-app" },
      githubProject
    )).toMatchObject({ note: "not main", offMain: true, text: "example-owner/example-app · example-feature (not main)" });
    expect(vibe64SessionSaveTarget(
      { branch: "main", mode: "managed_git", repository: "example-app" },
      { repository: { defaultBranch: "trunk", mode: "managed_git" } }
    )).toMatchObject({ note: "not trunk", offMain: true, text: "example-app · main (not trunk)" });
  });

  it("marks a fork's branch even when it has the main branch's name", () => {
    expect(vibe64SessionSaveTarget(
      { branch: "main", mode: "github", repository: "example-contributor/example-app" },
      githubProject
    )).toMatchObject({ note: "not this project's repository", offMain: true });
  });

  it("shows a local repository as the project's own, never as a path", () => {
    for (const repository of ["/home/example/projects/example-app", "~/example-app", "./example-app", "C:\\Projects\\example-app", "file:///srv/example-app.git"]) {
      expect(vibe64SaveTargetRepository(repository)).toBe("Project repository");
    }
    expect(vibe64SessionSaveTarget(
      { branch: "main", mode: "local_source", repository: "/home/example/projects/example-app" },
      { repository: { defaultBranch: "main", mode: "local_source" } }
    )).toMatchObject({ offMain: false, repository: "Project repository", text: "Project repository · main" });
  });

  it("names a URL or SCP remote in short form without credentials or a query", () => {
    expect(vibe64SaveTargetRepository("https://x-access-token:example-secret@github.com/example-owner/example-app.git?token=example-hidden#top"))
      .toBe("example-owner/example-app");
    expect(vibe64SaveTargetRepository("ssh://git@github.com/example-owner/example-app.git")).toBe("example-owner/example-app");
    expect(vibe64SaveTargetRepository("git@github.com:example-owner/example-app.git")).toBe("example-owner/example-app");
    expect(vibe64SaveTargetRepository("https://example-user:example-secret@git.example.test/team/example-app.git"))
      .toBe("git.example.test/team/example-app");
    // Text that could carry a credential without a URL's structure is never shown.
    expect(vibe64SaveTargetRepository("example-user:example-secret@git.example.test/team/example-app")).toBe("Project repository");
    expect(vibe64SaveTargetRepository("not a remote token=example-secret")).toBe("Project repository");
  });

  it("has no target until the server resolves a branch", () => {
    expect(vibe64SessionSaveTarget(null, githubProject)).toBeNull();
    expect(vibe64SessionSaveTarget({ mode: "github", repository: "example-owner/example-app" }, githubProject)).toBeNull();
  });

  it("does not mark a branch when the project's main branch is unknown", () => {
    expect(vibe64SessionSaveTarget({ branch: "example-feature", mode: "managed_git", repository: "example-app" }))
      .toMatchObject({ note: "", offMain: false, text: "example-app · example-feature" });
  });
});
