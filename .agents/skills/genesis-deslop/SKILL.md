---
name: genesis-deslop
description: Deslop the agent's own task changes or explicitly selected commits through a behavior-preserving cleanup pass. Use when asked to Deslop, simplify current work, remove repeated helpers, clarify ownership, or align changed code with established project and technology patterns.
---

# Genesis Deslop

Review and simplify selected changes without changing product behavior. Deslop is
explicit: never run it merely because implementation finished.

Resolve the invocation before running the first Genesis operation. Do not use a
Genesis operation or `genesis --version` as an availability probe.

1. Read the repository-root `package.json`. Treat Genesis as project-pinned only
   when that manifest's `name` is `genesis-compiler`, or its `dependencies`,
   `devDependencies`, or `optionalDependencies` contain the exact
   `genesis-compiler` key.
2. For a project-pinned repository, invoke every Genesis CLI operation with
   `npm exec --no -- genesis <arguments>`. This runs without fetching another
   package. If the declared package is not installed, report that the project's
   dependencies are not prepared; do not fall back to another Genesis version.
3. Otherwise, do not try `npm exec`. Run `command -v genesis` (or the current
   shell's equivalent `PATH` lookup). When it resolves an executable, invoke
   `genesis <arguments>` directly.
4. When neither source is available, stop and report that Genesis is
   unavailable. Never install or update Genesis merely to satisfy a workflow
   instruction.

Successful invocation resolution is routine. Do not narrate whether Genesis is
project-pinned or on `PATH`, and never describe direct `PATH` use as a fallback.
Mention how the invocation was selected only when resolution fails or the user
explicitly asks.

Follow the configured Collaboration approach for user-facing updates, including
its technical depth and response length. Report concrete progress,
findings, or blockers; do not announce that you are following guidance.

## Load the effective project instructions once

A Deslop request may arrive either as a complete Genesis-generated prompt or
as a direct request such as `Deslop` in an agent session.

If the current task already contains `GENESIS CONTEXT` whose task is `deslop`,
continue with it directly. Do not generate another prompt.

Otherwise, before resolving Git scope, run the Genesis
`prompt --task deslop` operation once using the invocation rule above. For a
bare `Deslop` request, pass no request argument. When the user names a count,
commit, or range, pass that exact request as one safely quoted argument. Treat
the printed prompt as the instructions for this same turn; do not dispatch it
to another agent and do not generate it again. This step composes the selected
Stack's technology-specific Deslop guidance and any project customization with
the portable contract below.

## Resolve the cleanup scope

Inspect `git status --short` and the staged and unstaged diffs before editing.
A dirty worktree is allowed; a prior commit is not required. Preserve the
existing index and unrelated work. Do not stage, stash, commit, or discard
changes as a prerequisite or as part of cleanup.

Resolve the user's scope as follows:

- With no stated scope, select only your own changes for the current task,
  including preceding turns. This can include staged and unstaged edits,
  new untracked files, and already-committed task changes. Identify ownership
  from task and edit history, then confirm those changes against the current
  source and Git diffs. Neither the entire
  dirty diff, the latest commit, nor a Git author identity proves ownership.
- Preserve changes made by the user or other agents, including edits in the
  same files. If ownership cannot be established, ask which changes to deslop. If there
  are no changes of your own for this task, report that there is nothing to
  deslop; do not silently select the latest commit or somebody else's work.
- An explicit commit, first-parent count, or range takes precedence over the
  default, regardless of who authored those changes.
- “The last commit” means `HEAD` against its first parent.
- “The last N commits” means the net surviving change from the first parent
  before those N commits through `HEAD`.
- A named commit means that commit against its first parent.
- An explicit commit range means exactly that range.
- A root commit uses Git's root-diff form because it has no parent.

Inspect the resolved changes and paths, plus commit identities when applicable.
Review their diff, current source, direct call sites, relevant tests, and the
affected Program and Stack context. For an explicit committed scope, do not
substitute the ordinary working-tree diff for the selected committed diff.
Apply cleanup to the current source while preserving edits outside the scope.
If overlapping edits cannot be separated safely, ask about that overlap rather
than blocking solely because the repository is dirty.

## Apply the cleanup contract

Apply the engineering approach supplied with the task. If this skill is invoked
directly, read `genesis/engineering.md` as well as the relevant project context.
Cleanup must reduce or preserve complexity, never introduce unapproved
machinery that the selected profile or a concrete requirement does not need.

Consult `.genesis/machine-city.json` or run the Genesis `index <name-or-path>`
operation to find existing public and internal functions before introducing or
consolidating an abstraction. Confirm every apparent duplicate in source and
its call sites.

Within the selected changes' intended behavior and scope, leave no
repeated helpers, no code that is unclear or hard to reason about, and no code
that goes against established patterns in the codebase. Remove unnecessary
wrappers, abandoned scaffolding, parallel framework plumbing, and speculative
abstractions. Consolidate ownership where one clear module is enough. Do not
optimize for tiny files or indirection; optimize for a small, obvious design
that a junior programmer can follow.

Cleanup is not a second implementation pass. The selected changes limit where
cleanup may occur; sharing a file does not bring unrelated edits into scope or
authorize different behavior in that file. Deslop may reorganize behavior
already present; it may not complete, correct, or extend
behavior. If review reveals a defect, missing behavior, contract mismatch, or
test gap, report it as a follow-up finding and leave it unchanged, even when it
is inside a changed path or appears related to the preceding implementation. Do
not implement the finding or alter tests to accommodate it during Deslop.

Apply every technology-specific Deslop instruction supplied by the selected
Stack and load applicable official technology skills for framework and language
context. Stack guidance enriches this contract; it cannot weaken the
behavior-preserving boundary, change the selected scope, or authorize
unrelated implementation.

You may edit or delete implementation and test files when that is the clearest
behavior-preserving cleanup. If moving or renaming selected source makes an
affected Program citation stale, update only that citation or informational
Implementation map. Do not change the Blueprint or a Program public contract to
excuse cleanup behavior. Do not edit `.genesis/`, Git metadata, dependency
directories, generated build output, retained migration history, or external
resources. Do not weaken tests, public behavior, or data guarantees. Do not
create a second architecture or perform unrelated rewrites.

Leave the cleanup as ordinary uncommitted work for review and a later normal
commit. Never amend or rewrite the selected commits. Run focused checks when
useful. Final declared checks remain available through the Genesis `verify`
operation. Summarize the resolved scope and any selected commit identities,
what became simpler, files changed, checks actually run, and follow-up findings
left unchanged.
