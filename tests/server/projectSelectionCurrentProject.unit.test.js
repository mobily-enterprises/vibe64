import assert from "node:assert/strict";
import { test } from "node:test";

import { runWithProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";

import { createProjectDevelopmentDatabase } from "../../packages/vibe64-project/src/server/projectDevelopmentDatabase.js";
import { createProjectSelection } from "../../packages/vibe64-project/src/server/projectSelection.js";

// Reading the current project in a catalogue project's request reads that
// project's record alone: never the catalogue, with every project's metadata,
// open state and waiting approvals.
const NOTES = Object.freeze({
  allowSharedDatabaseSessions: true,
  developmentDatabaseScope: "project",
  developmentDatabaseName: "notes_dev",
  githubRepository: { fullName: "owner/notes" },
  projectRoot: "/projects/notes",
  repository: { mode: "managed_git" },
  slug: "notes"
});
const REQUEST = Object.freeze({
  projectRecordPath: "/system/projects/notes/project.json",
  projectRuntimeRoot: "/system/projects/notes",
  projectSessionSourceRoot: "/projects/notes",
  projectsRoot: "/projects",
  slug: "notes",
  sourceConfigRoot: "",
  sourceRoot: "",
  targetRoot: "/projects/notes"
});

function catalogue({ readProject = async ({ slug }) => ({ ok: true, project: { ...NOTES, slug } }) } = {}) {
  const reads = [];
  const projectContext = {
    requestContextMatchesSelectedProject: () => false,
    async listProjects() { throw new Error("The current project must not list the catalogue."); },
    async listWorkspaceProjects() { throw new Error("The current project must not list the catalogue."); },
    async readWorkspaceProject(input) {
      reads.push(input);
      return readProject(input);
    }
  };
  return { projectContext, reads };
}

test("the current project of a catalogue request is read alone", async () => {
  const { projectContext, reads } = catalogue();
  const selection = createProjectSelection({ logger: console, projectContext });
  const current = await runWithProjectRequestContext(REQUEST, () => selection.currentProjectState());
  assert.deepEqual(reads, [{ allowDeleting: true, slug: "notes" }]);
  assert.equal(current.slug, "notes");
  assert.equal(current.selected, true);
  assert.equal(current.projectRoot, REQUEST.targetRoot);
  assert.equal(current.projectRecordPath, REQUEST.projectRecordPath);
  assert.equal(current.allowSharedDatabaseSessions, true);
  assert.equal(current.developmentDatabaseScope, "project");
  assert.equal(current.developmentDatabaseName, "notes_dev");
  assert.deepEqual(current.githubRepository, { fullName: "owner/notes" });
  assert.deepEqual(await runWithProjectRequestContext(REQUEST, () => selection.currentDevelopmentDatabaseConfiguration()),
    { developmentDatabaseName: "notes_dev", developmentDatabaseScope: "project" });
});

test("a project the catalogue would not list answers from the request, and other failures still fail", async () => {
  const missing = Object.assign(new Error("Vibe64 projects must have repository metadata."), { code: "vibe64_project_repository_missing" });
  const unlisted = catalogue({ readProject: async () => { throw missing; } });
  const current = await runWithProjectRequestContext(REQUEST, () =>
    createProjectSelection({ logger: console, projectContext: unlisted.projectContext }).currentProjectState());
  assert.equal(current.slug, "notes");
  assert.equal(current.projectRoot, REQUEST.targetRoot);
  assert.equal(current.repository, undefined);
  assert.equal(current.allowSharedDatabaseSessions, false);

  const corrupt = catalogue({ readProject: async () => { throw Object.assign(new Error("Unreadable record."), { code: "EACCES" }); } });
  await assert.rejects(runWithProjectRequestContext(REQUEST, () =>
    createProjectSelection({ logger: console, projectContext: corrupt.projectContext }).currentProjectState()), { code: "EACCES" });
});

test("the development database policy reads the current project once", async () => {
  let reads = 0;
  const developmentDatabase = createProjectDevelopmentDatabase({
    projectContext: {},
    resourceEnvironmentProvider: { managedDevelopmentDatabase: true },
    selection: {
      async currentProjectState() {
        reads += 1;
        return { allowSharedDatabaseSessions: true, developmentDatabaseScope: "project" };
      }
    },
    sessionWork: { async createRuntimeWithoutSource() { return { listSessionSummaries: async () => [] }; } }
  });
  const state = await developmentDatabase.developmentDatabaseState();
  assert.equal(reads, 1);
  assert.equal(state.scope, "project");
});
