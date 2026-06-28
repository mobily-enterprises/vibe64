# Vibe64 Source/Home Reorg Plan

## Goal

Make Vibe64 source ownership explicit in both local and Online modes.

The project root concept must stop meaning both "Vibe64 project state" and
"the app source checkout". Session source directories are normal clones, not
Git worktrees, so new code must use source terminology. V1 has no worktree
compatibility layer; existing projects are migrated in place.

## Target Model

### Shared Concepts

- `projectHome`: Vibe64-owned state for one project.
- `baseSource`: source-of-record for the project.
- `sessionSource`: editable source checkout for one Vibe64 session.
- `publishSource`: fresh checkout/copy used for one publish attempt.
- `releaseWorkspace`: immutable workspace used by the running release.
- `repoConfig`: repo-owned portable facts in `REPO/.vibe64`.

### Repo-Owned `.vibe64`

Keep this small and portable:

```txt
REPO/.vibe64/
  project_type
  config/
    jskit_database_runtime
```

Adapter equivalents are allowed when they describe durable repo shape, such as
database runtime or data-layer convention. Do not store Online binding,
GitHub permissions, deployments, sessions, public URLs, secrets, generated
indexes, or runtime helper files in repo-owned `.vibe64`.

### Local Mode

The user-provided repo remains the base source:

```txt
/tmp/ppp/                                    # baseSource
  .git/
  src/
  package.json
  .vibe64/                                  # repo-owned portable facts
```

Vibe64-owned state should be separable from the source checkout:

```txt
projectHome/
  state/
  local/
    git-cache/repository.git
    sessions/active/<session-id>/source     # sessionSource
    deployments/sources/<release-id>        # publishSource
    deployments/releases/<release-id>/artifact/workspace
```

### Online Mode

The tenant project directory is project home only, not a source checkout:

```txt
/srv/vibe64/tenants/<tenant>/projects/<slug>/  # projectHome
  state/
    project.json                               # Online binding
  local/
    git-cache/repository.git
    sessions/active/<session-id>/source
    deployments/sources/<release-id>
    deployments/releases/<release-id>/artifact/workspace
```

Online base source is the configured remote repository. Online sessions and
publishes must come from the remote/cache, not from a local `main` checkout in
project home.

## Migration Phases

### Phase 1: Source-Only Contract

- Add source-root helpers that prefer `source_path` and `session/source`.
- Remove `worktree_path`, `session/worktree`, and `VIBE64_WORKTREE_PATH`
  aliases instead of keeping compatibility shims.
- Write only `source_*` metadata.
- Update user-visible labels toward "source" or "session source".

### Phase 2: Publish From Explicit Source

- Add a publish source checkout under deployments for each release.
- Resolve the publish source from remote/cache when a remote exists.
- Use the publish source for prepare/build/migrate/artifact snapshot.
- Keep runtime network/container identity tied to project home.
- Never build from stale project-home `main`.

### Phase 3: Online Project Home Without Checkout

- Stop cloning GitHub repositories into Online project home.
- Store Online binding state outside repo-owned `.vibe64`.
- Inspect project type/config through remote/cache or explicit publish/session
  source checkouts.
- Migrate existing project homes explicitly instead of resolving legacy source
  layouts in runtime code.

### Phase 4: Finish Source Terminology

- Rename remaining internal variables and shell-target vocabulary where doing so
  does not change terminal semantics.
- Keep Git worktree language only where the code is genuinely invoking
  `git worktree`.

## Non-Goals For The First Slice

- Do not do a blind global rename of all `worktree` text.
- Do not move all Online project metadata in one step.
- Do not keep compatibility shims for existing active sessions; migrate them.
- Do not change local-mode user expectations around existing project roots.

## Executed Slice

- New session clones are created under `session/source`.
- Server and client source-path helpers prefer `source_path` and `session/source`.
- Clone commands write `source_*` metadata and do not create new
  `worktree_*` facts.
- Adapter prepare scripts read `VIBE64_SOURCE_ROOT` only.
- Online publish creates a per-release publish source under
  `deployments/sources/<release-id>`.
- Online prepare/build/migrate phases and release artifacts use that publish
  source instead of building from project home.
- Runtime command specs receive the shared project metadata root so session
  source creation can read Online repository binding without depending on a
  compatibility checkout in project home.
- Online GitHub project create/open records repository metadata in project
  state without cloning source into project home.
- The create-session-clone workflow now treats canonical `source_path` as the
  completion signal.
- Catalog project homes now use `state/` for Vibe64-owned project state and
  `local/` for Vibe64-owned runtime/session/deployment state.
- Explicit source roots keep repo-owned portable facts in `REPO/.vibe64`, while
  private runtime/session state is rooted under the Vibe64 system root.
- Existing catalog homes with legacy `.vibe64/project.json` must be migrated
  explicitly; runtime code does not read it as a fallback.
- Runtime config sync scans active `session/source` directories only.
- `@local/vibe64-core/server/sessionSourcePath` is the canonical package
  export. No `sessionWorktreePath` package export remains.

Remaining phase work:

- Rename remaining internal `worktree` terminology that is not actually tied to
  Git worktree commands or the existing shell target enum.
- Complete explicit migration for existing Online project homes.
