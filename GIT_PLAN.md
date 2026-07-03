# Vibe64 Repository Mode Conversion Plan

This document captures the audit and implementation plan for removing the current hard GitHub dependency from Vibe64 while preserving one canonical repository per project.

Implementation is now in progress across the repository contract, workflow families, command backends, online managed Git, flips, terminals, deployments, setup doctor, and accounts readiness. The remaining work is practical real-world verification, especially real GitHub repository creation/PR/merge/flip tests with explicit user confirmation before creating throwaway repos.

This is a structural plan based on inspection of:

- `/home/merc/vibe64/vibe64`
- `/home/merc/vibe64/vibe64-online`
- `/home/merc/vibe64/vibe64-online/submodules/public-vibe64-local-editor`

## Repository Relationship

`/home/merc/vibe64/vibe64` is the writable public source of truth.

`/home/merc/vibe64/vibe64-online/submodules/public-vibe64-local-editor` is a deployment-managed read-only submodule mirror of this repo. Do not edit or commit inside that submodule.

`../vibe64-online` composes the public repo via `submodules/public-vibe64-local-editor`, currently pinned through `.gitmodules` to:

```text
https://github.com/mobily-enterprises/vibe64.git
```

The online composition code in `vibe64-online/lib/onlineComposition.js` composes the public checkout into `.vibe64-online-generated/app`, with `VIBE64_PUBLIC_ROOT` as an override for local composition verification.

Deployment flow for public editor changes remains:

1. Change, commit, and push `/home/merc/vibe64/vibe64`.
2. Update, commit, and push `/home/merc/vibe64/vibe64-online`.
3. Run deployment from `/home/merc/vibe64/vibe64-online`.

## Root Cause

The current product model is effectively:

```text
project = GitHub repository
```

That assumption leaks into:

- runtime capabilities
- project metadata
- project listing and reading
- online project creation
- online access management
- auth gate prerequisites
- account status readiness
- setup doctor checks and repairs
- workflow graph
- workflow commands
- terminal ownership/tool homes
- deployment publish source
- prompts and composer commands

The correct model should be:

```text
project = one canonical Git repository
```

That canonical repository can be one of:

- `github`: a GitHub repository
- `managed_git`: a Vibe64-managed Git repository for hosted non-GitHub projects
- `local_source`: the opened local repo directory in CLI/local editor mode

The phrase "one remote" still matters, but "remote" should mean "the canonical repository for this project," not always GitHub.

## Product Use Plan

### Naming

Use "Vibe64 Git" for the non-GitHub online mode.

Internal mode name:

```text
managed_git
```

Avoid calling the online non-GitHub mode "local." It is not local to the user; it is a Vibe64-hosted managed Git repository.

### CLI / Local Editor Use

CLI mode should always work as `local_source`.

Opening a repository directory means:

- that directory is the canonical repository
- sessions clone from that directory
- accepted work is applied back to that directory
- no GitHub account is required
- no GitHub issue, PR, fork, collaborator, or merge flow is required

Session source should remain:

```text
<project_runtime_root>/sessions/active/<session_id>/source
```

The current code already uses straight clones for this path. The product should not use Git worktrees.

### Online Project Creation

Project creation should start with a repository mode choice:

- Vibe64 Git
- GitHub

Vibe64 Git:

- no GitHub account required
- owner creates project shell and canonical managed Git repository
- first seed session can create initial content
- every session reclones from the managed Git repository
- accepted work is committed back to the managed Git repository

GitHub:

- owner-only creation
- owner must have GitHub connected
- owner can create a new GitHub repo or link an existing GitHub repo
- users without GitHub cannot use GitHub-mode projects

### Project Access

Vibe64 Git projects use tenant/app membership. There is no GitHub collaborator panel.

GitHub projects keep GitHub access management:

- repository permission checks
- collaborator invites
- GitHub identity sync
- reconnect prompts

Users without GitHub are off-limits from GitHub-mode projects.

### Flip Out / Flip In

"Flip out" means Vibe64 Git -> GitHub:

- owner-only
- owner must have GitHub connected
- create or link GitHub repo
- push the canonical managed Git history to GitHub
- switch project metadata to `repository.mode = "github"`
- preserve project slug, sessions, runtime state, deployment records

"Flip in" means GitHub -> Vibe64 Git:

- owner-only
- clone/fetch current GitHub default branch into Vibe64 managed Git
- switch project metadata to `repository.mode = "managed_git"`
- remove GitHub requirement for future use
- preserve project slug, sessions, runtime state, deployment records

Active sessions must not drift underneath a flip. Either:

- block flips while active sessions have dirty/unaccepted source work, or
- allow existing active sessions to continue under their frozen workflow profile while only new sessions use the new mode

The safer first implementation is to block risky flips until active sessions are finished or abandoned.

## Current Code Findings

### Runtime Profile

Public local runtime:

- `server/lib/runtimeProfile.js`
- currently sets `githubRequired: true`
- public capabilities expose `githubRequired`

Online runtime:

- `vibe64-online/packages/private-online-core/src/server/runtimeProfile.js`
- currently sets `githubRequired: true`
- hosted mode enables project catalog and GitHub project access management

This needs to become conditional. GitHub should be required only for GitHub projects/actions, not globally.

### Project Context and Metadata

Primary public seam:

- `packages/vibe64-core/src/server/studioProjectContext.js`

Useful existing concepts:

- `targetRoot`
- `projectRuntimeRoot`
- `sourceRoot`
- `sourceConfigRoot`
- `onlineProjectRecordPath`
- `gitCacheRoot`

Hard GitHub assumptions:

- project metadata normalizes only `githubRepository`
- `workspaceProjectRecord` exposes `githubRepository`
- `projectMetadataWithGitRemote` derives GitHub repo from Git remotes
- `listWorkspaceProjects()` filters out projects without `githubRepository`
- `readWorkspaceProject()` throws `vibe64_project_not_github_backed`

This is the correct first layer to change. Project records need a repository contract that can represent GitHub, managed Git, and local source.

### Project State Paths

Primary path helper:

- `packages/vibe64-core/src/server/projectState.js`

Existing roots:

- `project.json`
- `sessions`
- `deployments`
- `git-cache`
- `runtime`
- `runtime-config`
- `projectInfoCache.json`

This is the right place to add canonical managed repository path helpers, or to formalize the existing `git-cache/repository.git` as the managed canonical repo for non-GitHub hosted projects.

### Session Source Path

Primary file:

- `packages/vibe64-core/src/server/sessionSourcePath.js`

Canonical active session source is already:

```text
<projectRuntimeRoot>/sessions/active/<session_id>/source
```

This matches the intended straight clone/copy model.

### Source Creation Command

Primary file:

- `packages/vibe64-adapters/src/server/workflowCommandTerminal/worktreeDependencies.js`

Important current behavior:

- `createSessionSourcePath(session)` returns `<sessionRoot>/source`
- `createWorktreePath()` is only an alias
- `createGitCachePath()` uses `<projectRuntimeRoot>/git-cache/repository.git`
- remote path uses `githubRepository.cloneUrl` or target `origin`
- no remote path falls back to cloning the local target root
- local fallback initializes Git and creates an initial commit if needed
- existing PR sessions require a GitHub remote URL

This file already uses straight clones, not Git worktrees. The required change is not "replace worktrees everywhere." It is to make the source backend explicit:

- GitHub clone
- managed Git clone
- local source clone

### Commit / Push Command

Primary file:

- `packages/vibe64-adapters/src/server/workflowCommandTerminal/commitPush.js`

Current behavior:

- commits in the session source
- if no `origin`, allows local-only commit only for `seed` or `description`
- applies local-only commit to `TARGET_ROOT` with fast-forward merge
- if `origin` exists, enables GitHub auth and pushes
- on push failure, attempts GitHub fork fallback

This must become repository-mode driven. Vibe64 Git should not accidentally enter GitHub/fork behavior because an `origin` happens to exist. GitHub mode should keep push/fork behavior.

### Sync / Merge Command

Primary file:

- `packages/vibe64-adapters/src/server/workflowCommandTerminal/mergeSync.js`

Current behavior:

- `syncMainCheckoutScript` refreshes Git cache for a GitHub remote
- if no remote, says no shared checkout sync is needed
- PR merge uses `gh pr merge`

This should split:

- GitHub sync/merge
- managed Git refresh/apply
- local-source apply/refresh

### Workflow Graph

Primary files:

- `packages/vibe64-runtime/src/server/workflow.js`
- `packages/vibe64-runtime/src/server/workflowRegistry.js`
- `packages/vibe64-runtime/src/server/workflowDefinitionComposers.js`
- `packages/vibe64-runtime/src/server/workflowModules/coreCoding.js`
- `packages/vibe64-runtime/src/server/workflowModules/coreLifecycle.js`
- `packages/vibe64-runtime/src/server/workflowModules/coreMaintenance.js`

Current system:

- workflows are static registry entries
- `defineWorkflow`, `workflowGroup`, and `workflowWhen` exist
- `workflowWhen` is compile-time composition only
- there is no current project-conditional workflow selection
- runtime recommendation only chooses seed-required vs default
- sessions can request a workflow definition
- sessions freeze `workflow_definition` metadata

Existing workflows:

- `seed_application`
- `big_feature`
- `non_commit_maintenance`

Current `big_feature` includes GitHub-shaped lifecycle:

```text
session_created
work_source_selected
pr_source_selected
source_created
dependencies_installed
issue_file
plan/execute
qa
finishOffWorkflowGroup
```

`coreLifecycle.js` owns GitHub-shaped steps:

- choose work source with GitHub issue options
- choose PR source
- create source
- commit changes
- create PR
- merge PR
- sync main checkout
- finish

There is no conditional workflow by repository type today. This must be added deliberately.

### Sessions Service

Primary file:

- `packages/vibe64-sessions/src/server/service.js`

Current behavior:

- `workflowCreationOptions(runtime)` asks runtime for available workflow definitions
- `selectedWorkflowDefinitionId` only allows listed definitions
- session creation calls `runtime.createSession`
- `workflowSessionInput(projectType, workflowDefinition, project)` adds session project metadata
- `sessionProjectMetadata` currently adds GitHub metadata through `sessionProjectGithubMetadata(project)`

This is the right place to pass repository mode/profile into session metadata and to restrict visible workflow definitions by repository mode.

### Accounts and Auth Gate

Primary public files:

- `packages/vibe64-accounts/src/server/service.js`
- `packages/vibe64-accounts/src/client/composables/useAccountsSetup.js`

Primary online files:

- `vibe64-online/packages/private-online-core/src/client/app/lib/vibe64AuthGatePrerequisites.js`
- `vibe64-online/packages/private-online-core/src/client/app/auth/Vibe64PrerequisiteSetup.vue`
- `vibe64-online/packages/private-online-core/src/client/app/auth/Vibe64AccountSettings.vue`

Current behavior:

- account definitions mark both Codex and GitHub as required
- `accountsStatus` always resolves GitHub context
- if GitHub context fails, account status can fail early
- readiness requires all required accounts
- online auth gate checks GitHub before Codex
- prerequisite setup copy says GitHub required before using Vibe64

This must change:

- Codex can stay required for AI work
- GitHub is required only for GitHub projects/actions
- status should support required provider sets or purpose-specific readiness
- non-GitHub users should pass the auth gate for Vibe64 Git projects

### Online Project Routes

Primary file:

- `vibe64-online/packages/private-online-core/src/server/projectRoutes.js`

Current behavior:

- creates `githubProjectService`
- creates `githubProjectAccessService`
- project routes include:
  - `/api/vibe64/projects`
  - `/api/vibe64/projects/from-repository`
  - `/api/vibe64/projects/create-repository`
  - `/api/vibe64/projects/:slug/access`
  - `/api/vibe64/projects/:slug/access/invite`
- GitHub routes include:
  - `/api/vibe64/github/repository-owners`
  - `/api/vibe64/github/repositories/search`
  - `/api/vibe64/github/repositories/resolve`
  - `/api/vibe64/github/identity/sync`

Current project creation is owner-only and GitHub-only.

The route layer should shift to a generic project repository service:

- create Vibe64 Git project
- create/link GitHub project
- flip to GitHub
- flip to Vibe64 Git
- read repository status

GitHub routes should remain GitHub adapter routes.

### Online GitHub Project Service

Primary file:

- `vibe64-online/packages/private-online-core/src/server/githubProjectService.js`

Current behavior:

- `openRepositoryProject()` resolves GitHub repo, prepares empty project dir, writes `githubRepository`
- `createRepositoryProject()` runs `gh repo create`, then writes `githubRepository`
- `prepareEmptyProjectDirectory()` creates project home under projects root

This should become a GitHub backend behind a generic project repository service.

### Online Project Access

Primary file:

- `vibe64-online/packages/private-online-core/src/server/githubProjectAccessService.js`

Current behavior:

- reads project through `projectContext.readWorkspaceProject`
- assumes `project.githubRepository`
- checks viewer permission through GitHub
- lists tenant users
- checks collaborator access
- invites GitHub collaborators

This should remain GitHub-only and be hidden/blocked for non-GitHub projects.

### Online Add Project UI

Primary files:

- `vibe64-online/packages/private-online-core/src/client/app/composables/useVibe64AddProjectWizard.js`
- `vibe64-online/packages/private-online-core/src/client/app/manage/Vibe64AddProjectWizard.vue`

Current behavior:

- step 2 is only "Use existing GitHub repository" or "Create new GitHub repository"
- loads GitHub owners as part of source-code step
- reconnect GitHub is built into the wizard

Required change:

- mode choice first: Vibe64 Git or GitHub
- only load GitHub owners/repos when GitHub mode is selected
- Vibe64 Git path creates a managed Git project without GitHub

### Online Manage UI

Primary files:

- `vibe64-online/packages/private-online-core/src/client/app/composables/useVibe64ManagementPage.js`
- `vibe64-online/packages/private-online-core/src/client/app/manage/Vibe64ManagementPage.vue`
- `vibe64-online/packages/private-online-core/src/client/app/composables/useVibe64ProjectAccessPanel.js`
- `vibe64-online/packages/private-online-core/src/client/app/manage/Vibe64ProjectAccessPanel.vue`

Current behavior:

- project list labels with GitHub icon/repository
- `projectRepositoryLabel()` returns `githubRepository` or "No GitHub repository linked"
- access panel opens only when `project.githubRepository.fullName`
- access panel is GitHub collaborator management

Required change:

- project list shows repository mode
- GitHub projects are disabled/off-limits for users without GitHub
- access panel visible only for GitHub mode
- Manage page gets repository mode/status and flip controls

### Setup Doctor

Primary files:

- `packages/project-setup-doctor/src/server/service.js`
- `packages/setup-doctor-core/src/server/setupDoctorGit.js`
- `packages/setup-doctor-core/src/server/githubRemote.js`

Current behavior:

- generic setup checks force GitHub remote readiness
- repair actions create/link GitHub repo
- checkpoint must be pushed to origin/GitHub
- project wiring checks require `githubRepository`
- Git identity checks go through GitHub provider context

Required change:

- split plain Git readiness from GitHub readiness
- local/managed modes require Git repo, baseline commit, clean state, canonical repository availability
- GitHub mode additionally requires GitHub remote/access/checkpoint push
- project wiring checks must read `repository.mode`, not `githubRepository`

### Terminals

Primary files:

- `packages/vibe64-terminals/src/server/shellTerminal.js`
- `packages/vibe64-terminals/src/server/sessionGitCommandActor.js`
- `packages/vibe64-terminals/src/server/codexTerminal.js`
- `packages/studio-terminal-core/src/server/terminalOwnership.js`
- `packages/studio-terminal-core/src/server/providerHomes.js`

Current behavior:

- shell target is named `worktree`
- shell terminal requires GitHub command actor/tool home
- missing GitHub tool home blocks shell terminal
- session Git command actor metadata is GitHub-shaped
- terminal ownership is GitHub-provider-home based

Required change:

- terminal ownership must support no-GitHub repository modes
- GitHub provider home should be required only for GitHub operations
- shell/Codex terminals in managed/local modes should not require GitHub
- keep GitHub tool home mounted for GitHub mode

### Deployments

Primary files:

- `vibe64-online/packages/private-online-deployments/src/server/service.js`
- `vibe64-online/packages/private-online-deployments/src/server/deploymentRunner.js`

Current behavior:

- publish resolves GitHub tool home before publishing
- `createPublishSource()` reads `githubRepository`
- online catalog projects error if no linked GitHub repository
- local-copy fallback exists but is unreachable for catalog projects

Required change:

- deployment publish source must use repository abstraction
- GitHub mode clones GitHub with GitHub auth
- Vibe64 Git mode clones/copies from canonical managed Git
- CLI/local mode can copy/clone from local source after clean tree check
- publishing non-GitHub online projects must not require GitHub auth

## Workflow Architecture Decision

There is no current runtime conditional workflow system by project/repository type.

There are static workflow definitions and reusable workflow groups:

- `defineWorkflow`
- `workflowGroup`
- `workflowWhen`

`workflowWhen` is only compile-time composition, not session/project conditional logic.

The correct structural change is:

```text
project.repository.mode
  -> workflowRepositoryProfile
  -> available workflow definitions
  -> frozen session workflow_definition + workflow_repository_profile
  -> repository command backend
```

Sessions must freeze:

```json
{
  "repository_mode": "github",
  "workflow_repository_profile": "github_pr",
  "workflow_definition": "github_feature"
}
```

or:

```json
{
  "repository_mode": "managed_git",
  "workflow_repository_profile": "canonical_git",
  "workflow_definition": "canonical_git_feature"
}
```

or:

```json
{
  "repository_mode": "local_source",
  "workflow_repository_profile": "local_source",
  "workflow_definition": "local_source_feature"
}
```

Do not build one huge lifecycle state machine with 983 conditions.

Use shared groups for common steps and separate repo-specific finishing/sharing groups.

Proposed workflow families:

### GitHub PR Workflow

```text
session_created
work_source_selected
pr_source_selected
source_created
dependencies_installed
issue_file
plan_execute
qa
commit_push_branch
draft_pr
create_pr
merge_pr
sync_main_checkout
finish
```

### Canonical Git Workflow

For Vibe64 Git / hosted non-GitHub.

```text
session_created
work_source_selected_non_github
source_created
dependencies_installed
work_file
plan_execute
qa
commit_to_session
save_to_canonical_git
finish
```

### Local Source Workflow

For CLI/local editor.

```text
session_created
work_source_selected_non_github
source_created
dependencies_installed
work_file
plan_execute
qa
commit_to_session
apply_to_opened_repo
finish
```

### Seed Workflow

Seed also needs repository profile awareness.

For GitHub it can still seed and push/PR depending policy.

For Vibe64 Git it should seed, commit, and save to canonical managed Git.

For local source it should seed, commit, and apply to opened repo.

## Implementation Layers

### 1. Repository Contract in Core

Add a new public core module, likely:

```text
packages/vibe64-core/src/server/projectRepository.js
```

Responsibilities:

- mode constants
- metadata normalization
- capability derivation
- compatibility from legacy `githubRepository`
- public repository view model

Suggested modes:

```text
github
managed_git
local_source
```

Suggested profile mapping:

```text
github -> github_pr
managed_git -> canonical_git
local_source -> local_source
```

Project metadata should become:

```json
{
  "repository": {
    "mode": "github",
    "defaultBranch": "main",
    "github": {
      "fullName": "owner/repo",
      "cloneUrl": "https://github.com/owner/repo.git",
      "viewerPermission": "ADMIN"
    }
  }
}
```

or:

```json
{
  "repository": {
    "mode": "managed_git",
    "defaultBranch": "main"
  }
}
```

Keep legacy compatibility:

- if `githubRepository` exists and `repository` is missing, derive `repository.mode = "github"`
- for GitHub projects, keep emitting `githubRepository` until all callers migrate

### 2. Project Context Migration

Modify `studioProjectContext.js`:

- read/write normalized repository metadata
- `listWorkspaceProjects()` no longer filters on `githubRepository`
- `readWorkspaceProject()` no longer throws `vibe64_project_not_github_backed`
- `workspaceProjectRecord()` includes:
  - `repository`
  - `repositoryMode`
  - `workflowRepositoryProfile`
  - compatibility `githubRepository` only for GitHub mode

### 3. Repository Backend Operations

Add a small service layer, not a giant abstraction.

Operations needed:

- `ensureCanonicalRepository(project)`
- `sessionCloneSpec(project, session)`
- `acceptSessionCommit(project, session)`
- `refreshRepositoryCache(project)`
- `publishSource(project)`
- `flipToGithub(project, input)`
- `flipToManagedGit(project, input)`

Backends:

- GitHub backend
- managed Git backend
- local source backend

Keep the API narrow. Do not model every Git operation.

### 4. Workflow Selection

Add repository-aware workflow creation options.

Current:

```text
recommendedWorkflowDefinitionId()
  seedRequired ? seed_application : default
```

Needed:

```text
workflowCreationProfile()
  seedRequired
  repositoryMode
  workflowRepositoryProfile
  allowedWorkflowDefinitions
  defaultWorkflowDefinition
```

Modify:

- `Vibe64SessionRuntime`
- `workflowDefinitionCreationOptions`
- `vibe64-sessions` selection logic
- session metadata generation

Session creation should freeze repository facts:

- `repository_mode`
- `workflow_repository_profile`
- `workflow_definition`
- `github_repository` only for GitHub mode

### 5. Workflow Definitions

Refactor workflow definitions into reusable groups.

Keep common groups:

- session start
- source creation
- dependency install
- work definition
- plan/execute
- QA/review/report
- finish/archive

Split repo-specific groups:

- GitHub issue/PR source group
- GitHub commit/push/PR/merge/sync group
- canonical Git commit/save group
- local source commit/apply group

Do not keep GitHub-only actions as disabled buttons in non-GitHub workflows. They should not be in the graph.

### 6. Command Backend

Refactor command terminal builders:

- `worktreeDependencies.js`
- `commitPush.js`
- `mergeSync.js`
- `issuePr.js`

Create explicit mode-aware command specs:

- create session source
- commit session changes
- save/push accepted commit
- sync/refresh canonical repo
- create/merge PR only in GitHub mode

GitHub auth script should be called only for GitHub URLs/remotes.

### 7. Online Project Services

Create generic project repository service in online core.

Routes should support:

- create Vibe64 Git project
- open existing GitHub repo
- create GitHub repo
- flip to GitHub
- flip to Vibe64 Git
- read repository status

Keep GitHub service as GitHub backend.

### 8. Online UI

Update add-project wizard:

- choose Vibe64 Git or GitHub first
- GitHub owner/repo UI only appears in GitHub mode
- Vibe64 Git path has no GitHub reconnect prompt

Update Manage:

- display repository mode
- display mode-specific status
- show flip controls
- hide GitHub access panel for Vibe64 Git
- mark GitHub projects off-limits for users without GitHub

### 9. Auth and Accounts

Change accounts service to support purpose-specific readiness.

Examples:

```text
requiredProviders = ["codex"]
requiredProviders = ["github"]
requiredProviders = ["codex", "github"]
```

GitHub should not be a global requirement.

Online auth gate should:

- require login for hosted app
- require Codex where AI setup is needed
- require GitHub only when entering/creating/operating GitHub projects

### 10. Setup Doctor

Split checks:

- Git basics
- local/managed canonical repository readiness
- GitHub readiness

For managed/local:

- Git initialized
- baseline commit exists
- source config committed
- canonical repo exists
- session source can be cloned

For GitHub:

- all generic Git checks
- GitHub remote present
- GitHub auth present
- checkpoint pushed
- repo permissions available

### 11. Terminals

Introduce terminal ownership independent of GitHub provider home.

Modes:

- app/local terminal owner without GitHub actor
- user GitHub actor for GitHub mode

Shell/Codex terminal should open in non-GitHub mode without GitHub provider home.

### 12. Deployments

Publish source must use repository mode.

GitHub:

- resolve GitHub tool home
- clone GitHub repo/default branch

Vibe64 Git:

- clone from managed canonical Git repo
- no GitHub tool home

Local source:

- clean-tree check
- copy or clone local source

## Migration and Compatibility

Existing project records:

- if `githubRepository` exists, treat as `repository.mode = "github"`
- write new `repository` metadata on next metadata update or migration

Existing sessions:

- keep existing `workflow_definition`
- do not mutate active workflow graphs
- old sessions without `workflow_repository_profile` should be treated as legacy GitHub-shaped if they have GitHub metadata, otherwise local-source compatible where possible

Project flips:

- new sessions get new repository mode/profile
- active sessions keep old profile or flips are blocked

## Testing Plan

Testing must be practical and end-to-end. Unit tests alone are insufficient.

Stop and ask the user if there is any authentication problem. Do not add fallbacks around auth failures.

### Practical Project Fixture Strategy

Do not test this migration by repeatedly running full AI seeding loops. Full seeding is too slow and too expensive to use as the main verification path.

Use fast, deterministic project fixtures:

- keep a tiny seeded JSKIT fixture with the required Vibe64/JSKIT markers
- create multiple online/local test projects by copying or cloning that fixture
- use intentionally empty or partial repositories only for seed-required cases
- use the seeded fixture for past-seed cases
- create project states that represent key workflow positions without waiting for an AI agent to build a whole app every time

The minimal seeded JSKIT fixture should include:

```text
package.json
config/public.js
src/main.js
packages/main/package.descriptor.mjs
.jskit/lock.json
.vibe64/project_type
.vibe64/config/vibe64_app_auth_mode
.vibe64/config/github_pr_merge_method
.vibe64/config/jskit_database_runtime
```

Required fixture shapes:

- empty repository / seed required
- seeded repository / no active sessions
- seeded repository / active session after source creation
- seeded repository / active session after dependencies installed
- seeded repository / session near commit/save stage
- GitHub project near PR/merge stage
- multiple online catalog projects at once

Workflow state should be advanced through supported runtime APIs and real command facts whenever possible. Direct state writes are acceptable only for deliberately testing migration, recovery, or later-stage state-machine behavior where the alternative would be wasting hours on unrelated AI generation.

Real full seeding should be reserved for sparse smoke coverage:

- one local/CLI full seed path when needed
- one online managed/GitHub full seed path only when validating the full user journey
- not for every project, every mode, or every state-machine stage

### Unit / Integration Tests

Public repo:

- repository metadata normalization
- legacy `githubRepository` compatibility
- workspace project listing includes non-GitHub projects
- `readWorkspaceProject()` accepts managed Git records
- workflow creation options by repository mode
- session metadata freezes repository mode/profile
- GitHub actions absent from non-GitHub workflow graphs
- command specs choose correct backend
- account status does not require GitHub for non-GitHub purposes
- setup doctor mode-specific checks
- deployment publish source mode selection

Online:

- create Vibe64 Git project without GitHub
- create GitHub project requires owner + GitHub
- non-GitHub user cannot open GitHub project
- access panel hidden for Vibe64 Git
- flip Vibe64 Git -> GitHub
- flip GitHub -> Vibe64 Git
- deployment source works for managed Git

### Real CLI Tests

Use real temporary seeded repos:

1. Create temp Git repo with baseline commit.
2. Run Vibe64 local editor/CLI against it.
3. Create session.
4. Verify workflow is local-source profile.
5. Prepare source.
6. Make a real change.
7. Commit/apply back to opened repo.
8. Verify opened repo HEAD advanced.
9. Verify no GitHub auth was required.

Also test empty/seed path:

1. Create empty project directory.
2. Run CLI/local.
3. Seed app.
4. Verify initial commit and applied source.

### Real GitHub Tests

Use the user's configured GitHub credentials.

Stop if auth/scopes/provider home fail.

Before creating repos, confirm:

- GitHub owner/org
- private/public setting
- cleanup policy

Suggested throwaway names:

```text
vibe64-repo-mode-smoke-YYYYMMDD-<short-id>
```

Test:

1. Create new GitHub-mode project.
2. Open existing GitHub repo project.
3. Create session.
4. Verify GitHub workflow graph.
5. Prepare source.
6. Commit/push branch.
7. Create PR.
8. Artificially or programmatically fast-forward workflow to PR/merge stage only through supported runtime APIs or real command facts.
9. Merge PR.
10. Sync/refresh cache.

Do not manually edit metadata unless explicitly testing recovery.

### Online Local Run

After public implementation:

1. Commit changes in `/home/merc/vibe64/vibe64`.
2. Compose/update `../vibe64-online` against the committed public repo.
3. Run online locally.
4. Test Vibe64 Git project without GitHub.
5. Test GitHub project with GitHub.
6. Test mode flips.
7. Test online deployment publish source for managed Git and GitHub.

## Verification Commands

Use JSKIT through `npx`.

Likely public checks:

```bash
npm test
npm run test:client
npx jskit ...
```

Likely online checks:

```bash
npm test
npm run test:composition
VIBE64_PUBLIC_ROOT=/home/merc/vibe64/vibe64 npm run test:composition
```

Exact commands should be confirmed from package scripts before running.

## Guardrails

- Do not edit the online public submodule mirror.
- Do not hard-code local absolute paths into published code.
- Do not add silent fallbacks from GitHub to managed/local.
- Do not create one huge conditional workflow machine.
- Do not require GitHub globally.
- Do not use Git worktrees for session source.
- Do not drift metadata: capability metadata must reflect code behavior.
- Do not hide auth failures; stop and ask.
- Keep implementation layered and narrow.

## Recommended Implementation Order

1. Add repository metadata contract and compatibility.
2. Update project listing/reading to support managed Git records.
3. Add workflow repository profile derivation.
4. Add repository-aware workflow creation options.
5. Split workflow definitions using existing workflow groups.
6. Add managed/local command backends for source clone and commit acceptance.
7. Make GitHub command path explicitly GitHub-only.
8. Update online project service/routes for Vibe64 Git creation.
9. Update online add-project/manage/access UI.
10. Relax auth/accounts GitHub global requirement.
11. Update setup doctor.
12. Update deployment publish source.
13. Add tests and run real CLI/GitHub/online verification.

## Practical Execution Plan

The work should land as a series of small structural commits. Each phase must leave the repo in a coherent state and should have a clear verification gate before moving on.

### Phase 0: Baseline and Test Harness

Goal:

- establish current passing/failing baseline
- identify exact test commands and local run commands
- create throwaway test fixtures only under temp/runtime paths

Actions:

- inspect package scripts in `vibe64` and `vibe64-online`
- run the smallest relevant public test suite before changes
- run online composition test with `VIBE64_PUBLIC_ROOT=/home/merc/vibe64/vibe64`
- record any pre-existing failures separately from this migration

Gate:

- known baseline documented
- no implementation changes yet

### Phase 1: Core Repository Contract

Goal:

- make repository mode durable project truth without changing behavior yet

Files likely touched:

- `packages/vibe64-core/src/server/projectRepository.js`
- `packages/vibe64-core/src/server/studioProjectContext.js`
- focused tests under the core package

Actions:

- add repository modes: `github`, `managed_git`, `local_source`
- add profile mapping: `github_pr`, `canonical_git`, `local_source`
- normalize legacy `githubRepository` into `repository.mode = "github"`
- keep emitting `githubRepository` for GitHub projects during migration
- stop filtering project lists to GitHub-only
- stop throwing merely because a project is not GitHub-backed

Gate:

- existing GitHub projects still read exactly as before
- synthetic managed/local project records read and list correctly
- no workflow or command behavior changed yet

Current status:

- Implemented `packages/vibe64-core/src/server/projectRepository.js` with repository modes, workflow profiles, GitHub metadata normalization, legacy `githubRepository` compatibility, and repository view/metadata helpers.
- `studioProjectContext` now exposes `repository`, `repositoryMode`, and `workflowRepositoryProfile` on project records.
- Catalog project listing now keys off durable repository metadata instead of `githubRepository`; directories without online project records are still not treated as catalog projects.
- New catalog project records default to `managed_git` metadata unless a GitHub repository or explicit repository mode is provided.
- Explicit external/local targets expose `local_source` as their repository mode while retaining discovered GitHub remote metadata for transitional compatibility.
- `readWorkspaceProject()` no longer rejects a project merely because it is not GitHub-backed; it now requires repository metadata.
- Project service selection records pass repository facts through instead of dropping them.
- Focused tests cover legacy GitHub normalization, managed Git read/list, default managed catalog metadata, and local-source explicit targets.

Verified:

- `node --test tests/server/studioProjectContext.unit.test.js`
- `node --test tests/server/vibe64ProjectService.unit.test.js`
- `npm run verify:packages`
- `npm test`

Commit shape:

- one public commit for repository metadata and project context only

### Phase 2: Session Profile Freezing

Goal:

- freeze repository mode/profile into each new session
- preserve legacy session behavior

Files likely touched:

- `packages/vibe64-sessions/src/server/service.js`
- `packages/vibe64-runtime/src/server/workflow.js`
- session metadata helpers/tests

Actions:

- add repository facts to session creation input
- write `repository_mode` and `workflow_repository_profile` into session metadata
- keep `github_repository` metadata only for GitHub mode
- treat old sessions with GitHub metadata as legacy GitHub sessions
- do not mutate existing active session workflow graphs

Gate:

- new GitHub sessions have `github_pr`
- new managed sessions have `canonical_git`
- new local sessions have `local_source`
- old sessions still load

Current status:

- Session creation now derives repository facts through the core repository view and writes `repository_mode` plus `workflow_repository_profile` into new session metadata.
- GitHub metadata is emitted only when the normalized project repository mode is `github`.
- Non-GitHub sessions keep the existing description/no-issue/no-PR metadata defaults until the workflow families are split.
- Focused tests cover managed Git session metadata and GitHub session metadata through the real session service creation path.

Verified:

- `node --test --test-name-pattern 'session creation freezes' tests/server/vibe64SessionsService.unit.test.js`
- `node --test tests/server/vibe64SessionsService.unit.test.js`
- `npm run verify:packages`
- `npm test` reached 1029/1030 passing tests and failed only `launch readiness is not published when the terminal exits during the stability gate` with `running` vs `exited`; the isolated test and full `tests/server/vibe64TerminalsService.unit.test.js` reruns both passed, so this is recorded as an unrelated timing flake rather than a repository-mode failure.
- `node --test --test-name-pattern 'launch readiness is not published when the terminal exits during the stability gate' tests/server/vibe64TerminalsService.unit.test.js`
- `node --test tests/server/vibe64TerminalsService.unit.test.js`

Commit shape:

- one public commit for session metadata/profile freezing

### Phase 3: Workflow Families

Goal:

- remove GitHub PR actions from non-GitHub workflows structurally

Files likely touched:

- `packages/vibe64-runtime/src/server/workflowRegistry.js`
- `packages/vibe64-runtime/src/server/workflowDefinitionComposers.js`
- `packages/vibe64-runtime/src/server/workflowModules/coreLifecycle.js`
- `packages/vibe64-runtime/src/server/workflowModules/coreCoding.js`
- workflow tests

Actions:

- keep shared groups for source creation, dependency install, planning/execution, QA, finish
- split finishing groups:
  - GitHub commit/push/PR/merge/sync
  - managed Git commit/save
  - local source commit/apply
- expose creation options by repository profile
- select default workflow by `seedRequired + repository profile`
- keep GitHub issue/PR choices out of managed/local graphs

Gate:

- workflow creation options differ by repository mode
- non-GitHub workflow graph contains no GitHub issue/PR/merge steps
- GitHub workflow graph preserves current GitHub flow

Current status:

- Added repository profile metadata to core workflow definitions.
- Kept `big_feature` and `seed_application` as the GitHub PR workflow family.
- Added `canonical_git_feature`, `canonical_git_seed_application`, `local_source_feature`, and `local_source_seed_application`.
- Added a non-GitHub work-definition step that does not expose GitHub issue creation.
- Split finish composition so GitHub workflows include PR/merge/sync and non-GitHub workflows stop after commit/report/finish.
- `workflowDefinitionCreationOptions()` now filters selectable workflows by `workflow_repository_profile` and chooses profile-specific seed/default definitions.
- `Vibe64SessionRuntime` now validates requested workflow definitions against the session/project repository profile and writes `workflow_repository_profile` into runtime-created session metadata.
- `vibe64-project` now passes the selected project's repository profile into runtime creation, including managed catalog projects and CLI/local selected folders.

Verified:

- `node --test tests/server/vibe64WorkflowMachine.unit.test.js`
- `node --test tests/server/vibe64ProjectService.unit.test.js`
- `node --test tests/server/vibe64SessionsService.unit.test.js`
- `node --test tests/server/studioProjectContext.unit.test.js`
- `npm run verify:packages`
- `npm test` reached 1033/1034 passing tests and failed only the previously observed terminal timing test, `launch readiness is not published when the terminal exits during the stability gate`, with `running` vs `exited`.
- `node --test --test-name-pattern 'launch readiness is not published when the terminal exits during the stability gate' tests/server/vibe64TerminalsService.unit.test.js`
- `node --test tests/server/vibe64TerminalsService.unit.test.js`

Commit shape:

- one public commit for workflow definitions and selection

### Phase 4: Command Backends

Goal:

- make repository operations selected by frozen session profile, not by ad hoc `origin`/GitHub discovery

Files likely touched:

- `packages/vibe64-adapters/src/server/workflowCommandTerminal/worktreeDependencies.js`
- `packages/vibe64-adapters/src/server/workflowCommandTerminal/commitPush.js`
- `packages/vibe64-adapters/src/server/workflowCommandTerminal/mergeSync.js`
- `packages/vibe64-adapters/src/server/workflowCommandTerminal/issuePr.js`
- command tests

Actions:

- introduce narrow command backend selection:
  - clone/create session source
  - commit session source
  - accept/save to canonical repository
  - refresh/sync canonical repository
  - create/merge PR only for GitHub
- GitHub backend keeps current auth/push/fork/PR behavior
- managed backend clones from and saves to managed canonical bare repo
- local backend clones from and applies back to opened source repo
- remove accidental GitHub/fork behavior from non-GitHub paths

Gate:

- local source session can clone, commit, and apply back without GitHub
- managed Git session can clone, commit, and save back without GitHub
- GitHub session still pushes/PRs through GitHub auth

Current status:

- Added a narrow command-profile helper for workflow command terminals. It derives command behavior from the frozen `workflow_repository_profile` session metadata, with legacy GitHub fallback only for old GitHub-shaped sessions.
- `createWorktreeTerminalSpec()` now routes source creation by profile:
  - GitHub PR sessions keep GitHub cache/auth behavior.
  - managed Git sessions clone from the Vibe64 canonical bare repository at `source_cache_path` / project git cache.
  - local-source sessions clone from the opened target repository.
- `commitChangesTerminalSpec()` now routes acceptance by profile:
  - GitHub PR sessions keep push/fork behavior and GitHub auth.
  - managed Git sessions save the accepted commit to the canonical bare repository branch and record `canonical_git_saved`.
  - local-source sessions apply the accepted commit back to the opened repository with a fast-forward merge from the session clone.
- Non-GitHub command paths do not include `gh auth token`, GitHub credential rewrites, or `gh repo fork`.
- GitHub-only issue, PR, merge, and Git cache refresh command specs now reject non-GitHub repository profiles instead of accidentally running GitHub commands.
- The command success metadata and lifecycle completion contract now include `canonical_git_saved`, so managed Git commits advance the `changes_committed` step instead of only emitting a shell fact.

Verified:

- `node --test tests/server/vibe64WorkflowCommandTerminal.unit.test.js`
- `node --test tests/server/vibe64WorkflowMachine.unit.test.js`

Commit shape:

- one or two public commits, split if source creation and commit/apply become large

### Phase 5: CLI / Local End-to-End

Goal:

- prove local editor/CLI works without GitHub before online UI work

Actions:

- create a temp seeded Git repo
- run Vibe64 against that repo
- create a local-source session
- prepare source
- make a real change in session source
- commit/apply back to opened repo
- verify opened repo HEAD advanced
- create an empty project directory and verify seed/apply path

Gate:

- no GitHub auth or GitHub provider home required
- failures are real bugs, not papered over by fallback behavior

Current status:

- Ran a real temp-repo local-source smoke through the public project context, project service runtime creation, source command spec, and commit command spec.
- The selected project, runtime creation options, and created session all resolved `workflow_repository_profile = local_source`.
- The source command cloned from the opened target repository into the session source path and did not include GitHub auth.
- The commit command committed inside the session clone, fast-forwarded the opened target repository to the accepted commit, recorded `local_commit_only=yes` and `main_checkout_synced=yes`, and did not include GitHub commands.
- The smoke deliberately initialized the session at the commit stage to avoid running a full AI seed/work loop while still using real Git operations.
- Started the actual CLI server entry point against a real temp Git repo with `PORT=3977 node ./bin/server.js --project <temp-repo> --no-open`; it served `http://127.0.0.1:3977/app/project/target`.

Verified:

- Real local-source temp-repo smoke using `createStudioProjectContext`, `vibe64-project`, `createWorktreeTerminalSpec`, and `commitChangesTerminalSpec`.
- `PORT=3977 node ./bin/server.js --project <temp-repo> --no-open`

Commit shape:

- test/support fixes only if the end-to-end run exposes gaps

### Phase 6: Online Managed Git Backend

Goal:

- create and use hosted non-GitHub projects with one canonical Vibe64-managed Git repository

Files likely touched in `vibe64-online`:

- `packages/private-online-core/src/server/projectRoutes.js`
- a new generic project repository service
- `packages/private-online-core/src/server/githubProjectService.js`
- project creation tests

Actions:

- add generic project repository service
- keep GitHub project service as a GitHub backend
- add Vibe64 Git project creation
- initialize canonical managed Git repository
- write `repository.mode = "managed_git"`
- keep project slug/runtime/deployment paths stable

Gate:

- online can create a Vibe64 Git project without GitHub
- a managed project can create a session and save accepted work back to its canonical repo

Current status:

- Implemented `packages/private-online-core/src/server/projectRepositoryService.js` in `vibe64-online`.
- Online `POST /api/vibe64/projects` creates Vibe64 Git projects through the repository service.
- Vibe64 Git project creation initializes a canonical bare repository at `<project>/git-cache/repository.git` and writes `repository.mode = "managed_git"`.
- Creation cleanup preserves pre-existing project directories if metadata creation fails.
- Local online UI smoke created and opened `v64-managed-smoke-20260703`; its project record is `managed_git` and the bare repository has `HEAD -> refs/heads/main`.

Verified:

- `VIBE64_PUBLIC_ROOT=/home/merc/vibe64/vibe64 node --test tests/server/projectRepositoryService.unit.test.js`
- `VIBE64_PUBLIC_ROOT=/home/merc/vibe64/vibe64 npm run test:composition`
- Local online run on `http://127.0.0.1:3980/app/manage/projects`

Commit shape:

- public repo commit first if required
- online repo commit after composition succeeds

### Phase 7: Online UI, Auth, and Access

Goal:

- expose the new model without pretending GitHub is globally required

Files likely touched in `vibe64-online`:

- add-project wizard composable/component
- manage page composable/component
- access panel composable/component
- auth gate prerequisites/setup UI
- account settings UI

Actions:

- add first-step mode choice: Vibe64 Git or GitHub
- load GitHub owners/repos only in GitHub mode
- let non-GitHub users pass into Vibe64 Git flows
- show GitHub projects as off-limits without GitHub auth
- hide GitHub collaborator access panel for Vibe64 Git
- show repository mode/status on Manage

Gate:

- non-GitHub user can create/open Vibe64 Git project
- non-GitHub user cannot open GitHub project
- GitHub user can create/link GitHub project as before

Current status:

- Add Project now offers Vibe64 Git and GitHub modes; Vibe64 Git is the default path and does not load GitHub owner/repository resources.
- Online auth gate no longer globally requires GitHub before entering protected routes; Codex setup remains the first-login setup gate.
- GitHub project access routes reject non-GitHub projects before running GitHub tooling.
- Manage shows repository labels by mode: GitHub repository full name, Vibe64 Git, or Local source.
- GitHub Access is visible only for GitHub projects.
- Local UI smoke confirmed two GitHub projects show Access plus "Move to Vibe64 Git", while the Vibe64 Git project shows "Move to GitHub" and no Access button.

Verified:

- `VIBE64_PUBLIC_ROOT=/home/merc/vibe64/vibe64 node --test tests/server/authGatePrerequisites.unit.test.js tests/server/githubAuthRecovery.unit.test.js tests/server/githubProjectAccessService.unit.test.js tests/server/projectRepositoryService.unit.test.js`
- `VIBE64_PUBLIC_ROOT=/home/merc/vibe64/vibe64 npm run build`
- Local online UI smoke logged in as the service account and inspected Manage.

Commit shape:

- one online commit for creation UI/auth
- one online commit for Manage/access UI if needed

### Phase 8: Setup Doctor, Terminals, Deployments

Goal:

- remove remaining global GitHub requirements from supporting systems

Files likely touched:

- setup doctor packages
- terminal ownership/provider home packages
- online deployment service/runner

Actions:

- split plain Git readiness from GitHub readiness
- make terminal ownership work without GitHub provider home for managed/local modes
- require GitHub provider home only for GitHub operations
- publish source by repository mode:
  - GitHub clone with GitHub auth
  - managed Git clone/copy from canonical repo
  - local source clean-tree clone/copy

Gate:

- setup doctor reports mode-specific requirements
- shell/Codex terminal opens for managed/local without GitHub
- managed Git online deployment publishes without GitHub
- GitHub deployment still uses GitHub auth

Current partial status:

- Public local runtime no longer advertises GitHub as globally required.
- Current-app capability readiness now requires GitHub for session creation only when the selected project resolves to the GitHub PR workflow profile.
- Local-source projects can have `createSession` enabled with Codex ready and GitHub disconnected; GitHub-profile projects still block session creation when GitHub is disconnected.
- Session shell/command terminals now use an app-owned terminal home for `canonical_git` and `local_source` workflow repository profiles instead of requiring a GitHub actor/tool home.
- Online deployment publish source now uses repository mode:
  - GitHub projects clone with GitHub auth.
  - Vibe64 Git projects clone from the managed canonical bare repository.
  - Publish terminals for Vibe64 Git use an app-owned deployment-publish tool home without GitHub provider home.
- Project Setup Doctor now selects checks by repository setup profile:
  - default local/source setup checks Git basics and local checkpoint readiness only
  - GitHub setup still checks GitHub remote/auth/sync/checkpoint push
  - managed project-home setup validates `repository.mode`/canonical metadata instead of requiring `githubRepository`
- Setup Doctor core has separate GitHub checkpoint and local checkpoint repair/terminal helpers. Local repair creates or verifies a local baseline commit without pushing to `origin`.
- Legacy Adapter Setup Doctor is now profile-aware as well. GitHub remote/repository/issues checks only appear for the GitHub PR setup profile, while the default/source profile stays plain Git.
- Accounts status now accepts a requested provider set. Full account settings still report Codex plus GitHub by default, but project connection readiness asks for:
  - `["codex"]` for local-source and Vibe64 Git projects
  - `["codex", "github"]` for GitHub projects
- The setup e2e fixture now represents a local-default project setup instead of a GitHub-blocked project setup.

Verified:

- `node --test tests/server/currentAppServiceConfig.unit.test.js`
- `node --test tests/server/serverCli.unit.test.js`
- `node --test tests/server/vibe64TerminalsService.unit.test.js`
- `node --test tests/server/projectSetupDoctor.unit.test.js`
- `node --test tests/server/adapterSetupDoctor.unit.test.js`
- `node --test tests/server/vibe64AccountsRuntime.unit.test.js`
- `node --test tests/server/doctorRoutesScope.unit.test.js tests/server/vibe64AccountsRoutes.unit.test.js`
- `npm run verify:packages`
- `npm test`
- `npm run test:client`
- `npm run test:e2e:shell`
- `VIBE64_PUBLIC_ROOT=/home/merc/vibe64/vibe64 node --test tests/server/deploymentRunner.unit.test.js`
- `VIBE64_PUBLIC_ROOT=/home/merc/vibe64/vibe64 node --test tests/server/deploymentService.unit.test.js`
- `VIBE64_PUBLIC_ROOT=/home/merc/vibe64/vibe64 npm test`

Still unverified:

- Real GitHub repository setup after these setup/account changes.
- Real flip-in/flip-out against a throwaway GitHub repository.

Additional local online verification after public commit `b2bc22b`:

- `VIBE64_PUBLIC_ROOT=/home/merc/vibe64/vibe64 npm test` in `vibe64-online` passed 184 tests.
- `VIBE64_PUBLIC_ROOT=/home/merc/vibe64/vibe64 npm run test:composition` in `vibe64-online` passed 4 composition tests.
- `VIBE64_PUBLIC_ROOT=/home/merc/vibe64/vibe64 npm run build` in `vibe64-online` passed; only the existing large chunk warning was reported.
- Started online locally with `PORT=3980 VIBE64_RUNTIME_NAMESPACE=tonymobily VIBE64_PUBLIC_ROOT=/home/merc/vibe64/vibe64 npm run dev`.
- Browser smoke opened Manage as `tonymobily@gmail.com`, confirmed:
  - GitHub projects show GitHub repository labels, Access, and Move to Vibe64 Git.
  - Vibe64 Git projects show Vibe64 Git, Move to GitHub, and no GitHub Access button.
  - Creating `v64-mode-smoke-20260704` through the Add Project wizard defaulted to Vibe64 Git without loading GitHub owner/repository inputs.
  - The new project wrote `repository.mode = "managed_git"` and opened with `workflowRepositoryProfile = "canonical_git"`.
  - Its canonical bare repository exists at `git-cache/repository.git` with unborn `main`, which is expected for a seed-required project.
- Pushed public commit `5c16b06` to `origin/main`.
- Updated `vibe64-online/submodules/public-vibe64-local-editor` to `5c16b06`.
- Verified online from the submodule pointer without `VIBE64_PUBLIC_ROOT`:
  - `npm test` passed 184 tests.
  - `npm run test:composition` passed 4 composition tests.
  - `npm run build` passed; only the existing large chunk warning was reported.
  - Started online locally with `PORT=3980 VIBE64_RUNTIME_NAMESPACE=tonymobily npm run dev`.
  - Browser smoke on `http://127.0.0.1:3980/app/manage/projects` confirmed the same GitHub/Vibe64 Git mode-specific actions.

Commit shape:

- separate commits for setup doctor, terminals, deployments

### Phase 9: Flip In / Flip Out

Goal:

- convert project repository mode explicitly after both modes work independently

Files likely touched:

- generic repository service
- Manage page
- project routes
- repository operation tests

Actions:

- implement Vibe64 Git -> GitHub:
  - owner-only
  - require GitHub connected
  - create/link GitHub repo
  - push managed canonical history to GitHub
  - switch metadata to `repository.mode = "github"`
- implement GitHub -> Vibe64 Git:
  - owner-only
  - fetch current GitHub default branch
  - create/update managed canonical repo
  - switch metadata to `repository.mode = "managed_git"`
- block flips when active sessions have dirty/unaccepted source work
- do not rewrite existing active sessions

Gate:

- future sessions use new mode/profile after flip
- active sessions are either blocked before flip or continue with frozen profile
- project slug, runtime state, sessions, and deployments remain intact

Current status:

- Implemented repository flip service methods in `vibe64-online`:
  - `flipToGithub`
  - `flipToManagedGit`
- Flip to GitHub:
  - owner-only route: `POST /api/vibe64/projects/:slug/repository/github`
  - supports existing GitHub repository or newly created GitHub repository
  - pushes the managed canonical default branch to GitHub through the authenticated GitHub toolchain
  - preserves project slug, runtime roots, sessions, deployments, and bootstrap config metadata
  - switches metadata to `repository.mode = "github"`
- Flip to Vibe64 Git:
  - owner-only route: `POST /api/vibe64/projects/:slug/repository/managed-git`
  - fetches the GitHub default branch into `<project>/git-cache/repository.git` through the authenticated GitHub toolchain
  - preserves project slug, runtime roots, sessions, deployments, and bootstrap config metadata
  - switches metadata to `repository.mode = "managed_git"`
- First implementation blocks flips when `<project>/sessions/active` contains active session directories.
- Manage has a repository conversion dialog:
  - Vibe64 Git -> GitHub with Existing/Create modes
  - GitHub -> Vibe64 Git confirmation

Verified:

- `VIBE64_PUBLIC_ROOT=/home/merc/vibe64/vibe64 node --test tests/server/githubProjectService.unit.test.js`
- `VIBE64_PUBLIC_ROOT=/home/merc/vibe64/vibe64 node --test tests/server/projectRepositoryService.unit.test.js`
- `VIBE64_PUBLIC_ROOT=/home/merc/vibe64/vibe64 npm test`
- `VIBE64_PUBLIC_ROOT=/home/merc/vibe64/vibe64 npm run build`
- Local UI smoke opened both conversion dialogs without executing destructive conversions.

Still unverified:

- Real GitHub flip-out with an actual throwaway repository.
- Real GitHub flip-in from an actual throwaway repository.
- Any auth, scope, provider-home, owner access, push, or deploy auth problem during these real tests must stop and ask the user what to do.

Commit shape:

- one online/public coordinated commit pair for flip APIs and UI

### Phase 10: Real GitHub and Full Online Verification

Goal:

- prove GitHub mode still works with real credentials and no fake state-machine shortcuts

Stop condition:

- any GitHub auth, scope, provider home, owner access, submodule push, composition push, or deployment auth problem stops the run and requires user input

Actions:

- ask user for GitHub owner/org, visibility, and cleanup policy before creating repos
- create throwaway repo named like `vibe64-repo-mode-smoke-YYYYMMDD-<short-id>`
- create/open GitHub-mode project
- create session and verify GitHub workflow profile
- prepare source
- push branch
- create PR
- advance to merge stage through supported runtime APIs or real command facts
- merge PR
- sync/refresh cache
- compose `vibe64-online` from committed public repo
- run online locally
- verify Vibe64 Git, GitHub, flips, and deployments

Gate:

- local-source mode works
- Vibe64 Git mode works
- GitHub mode works
- flip in/out works
- deployment source works for GitHub and managed Git

## Commit and Deployment Discipline

- Do not edit `vibe64-online/submodules/public-vibe64-local-editor` directly.
- Public implementation lands in `/home/merc/vibe64/vibe64` first.
- After a stable public commit, update/compose `../vibe64-online`.
- Online changes land in `/home/merc/vibe64/vibe64-online`.
- Only deploy after local online verification passes.

## Key Design Invariant

Project repository mode is durable project truth.

Session workflow profile is durable session truth.

Commands are selected from the frozen session profile, not from ad hoc discovery of `origin`, `githubRepository`, or current auth state.
