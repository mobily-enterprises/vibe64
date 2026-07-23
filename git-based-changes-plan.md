# ProgSync Git-backed synchronization state

Status: implemented and superseded in detail by ProgSync v2. This document
remains the rationale for Git-backed accepted state; where its early prototype
examples conflict with the update below, the update and
`software_development_revolution.md` control.

## V2 implementation update

- `progsync sync --changed` is implemented. It discovers changed pairs and
  schedules transitive Program consumers one module at a time; it does not
  create a worktree per file.
- Accepted state schema version 3 checkpoints the Program file, primary target,
  every regular file below the module's deterministic auxiliary root, modes,
  hashes, context, branch, and pinned runner profile in the single
  `refs/worktree/progsync/state` history.
- A target `src/name.js` owns private implementation below `src/name/`. Those
  files participate in comparison, guarded installation, rollback, and
  checkpointing but never become Program Provides or Uses.
- An explicit project root may be a nested subtree of a larger Git worktree;
  alternate-index checkpoint paths retain the repository prefix correctly.
- The public library exposes `synchronizeFile()`, `syncChanged()`,
  `statusFile()`, `checkProgram()`, `parseProgram()`,
  `buildProgramProjection()`, and `readProgramAuthorPrompt()`. Import and
  compile are operation choices, not duplicate public wrappers.
- Deterministic Program projections use schema version 2. The state receipt and
  projection schemas are unrelated and version independently.
- No auto-commit is made on the checked-out branch. The private ref remains the
  accepted baseline, and temporary candidate repositories are removed after
  each invocation.

This document records the implemented Git-backed state model behind both
single-pair synchronization and the changed-file scheduler. It remains
intentionally detailed so later maintenance and the deferred whole-tree import
workflow retain the original safety constraints.

## 1. Objective

ProgSync keeps two related artifacts synchronized:

- A readable Program module, such as `program/src/alerts.js.md`.
- Its managed implementation, such as `src/alerts.js`.

The Program and implementation are both precious and authoritative, but over
different kinds of knowledge:

- Program owns intended behavior, exported interfaces, data flow, exact calls
  across file boundaries, external effects, meaningful failures, and the
  reasons for important behavior.
- Managed implementation owns algorithms, optimizations, private helpers,
  framework mechanics, markup and CSS details, and accumulated realization
  refinements that the Program intentionally does not spell out.

ProgSync must identify which side changed since the pair was last accepted,
then make the smallest correct reconciliation. It must not repeatedly ask an AI
to reconcile a pair that has already been accepted merely because both files
remain dirty relative to the project's current `HEAD`.

The public single-file command should become:

```text
progsync <program-or-implementation-path>
```

The path identifies a pair; it does not select a direction. ProgSync discovers
the counterpart, supported target, accepted baseline, changes on each side, and
the required mode.

## 2. Why `HEAD` alone is insufficient

Suppose both files match `HEAD`, then the developer changes Program and runs
ProgSync:

```text
HEAD Program --------> edited Program
HEAD implementation --> minimally patched implementation
```

After the successful run, both working files differ from `HEAD`. A second run
that compares only with `HEAD` sees both sides changed and selects
`RECONCILE_BOTH`, even though the two current files are exactly the accepted
result of the previous run.

Auto-committing would hide this problem by moving `HEAD`, but it would pollute
project history, seize control of the developer's commits, and mix unrelated
work into machine-created commits. ProgSync must not auto-commit ordinary
project history.

The missing concept is a private accepted checkpoint for the pair.

## 3. Scope of this implementation

This implementation includes:

1. One private Git-backed ProgSync state ref per existing Git worktree.
2. Exact accepted Program and implementation contents for every synchronized
   pair in that worktree.
3. Per-pair metadata recording where and when the accepted state was created.
4. State-first synchronization classification, with a conservative Git
   fallback when no applicable checkpoint exists.
5. A self-directing `progsync <path>` CLI.
6. Discovery logs explaining every material decision.
7. A read-only `progsync status <path>` command that never calls AI and never
   advances state.
8. Checkpoint advancement after successful applied synchronization, including
   implementation-only refinements that an atomic translator accepts without
   changing Program.
9. No checkpoint advancement during dry runs or blocked/failed translation.
10. Tests proving that state does not touch the branch, project index, working
    tree, or ordinary project history.

This implementation includes `sync --changed`, but not a complete first-time
whole-tree import, resumable import run, or final private-history compaction.
The state design is deliberately suitable for hundreds of sequential files,
and that deferred import workflow is specified in section 17.

It also does not infer deletion or rename. Missing files that existed at the
accepted baseline remain explicit diagnostics.

## 4. File pairing and target selection

The caller may pass either side:

```text
src/server/alerts.js
program/src/server/alerts.js.md
```

The mapping remains mechanical:

```text
src/server/alerts.js
<-> program/src/server/alerts.js.md
```

For a Program path, remove the leading `program/` and final `.md` to obtain the
implementation path. For an implementation path, prepend `program/` and append
`.md`.

The implementation extension selects the built-in translator. The prototype
supports `.js`, `.mjs`, `.html`, and `.vue`. There is no user-maintained list of
managed extensions and no per-project translator profile. Unsupported
extensions fail before any AI invocation.

JSON remains retained structured source/data and has no `.json.md` counterpart.
Standalone CSS normally remains an owned implementation artifact rather than a
separate Program module.

## 5. Synchronization cases

After resolving the accepted baseline (`P0`, `I0`) and current files (`P1`,
`I1`), classification is:

| Current Program | Current implementation | Change since accepted pair | Mode |
| --- | --- | --- | --- |
| Missing | Exists | Program never existed | `CREATE_PROGRAM` |
| Exists | Missing | Implementation never existed | `CREATE_IMPLEMENTATION` |
| Exists | Exists | Program only | `PROGRAM_TO_IMPLEMENTATION` |
| Exists | Exists | Implementation only | `IMPLEMENTATION_TO_PROGRAM` |
| Exists | Exists | Both | `RECONCILE_BOTH` |
| Exists | Exists | Neither | `NO_CHANGE` |

If a side is currently missing but existed at the accepted baseline, ProgSync
must stop with an explicit-deletion diagnostic. A missing side is not silently
interpreted as a request to delete or recreate it.

An implementation-only change can be accepted without a Program edit when it
is purely a realization refinement. That successful `unchanged` translation
still advances the accepted checkpoint, because the refined implementation is
now the accepted implementation for the unchanged Program.

## 6. Separate Git status from ProgSync status

The CLI must report two independent facts:

- Git status: whether each current file differs from `HEAD` or is untracked.
- ProgSync status: whether each current file differs from the last accepted
  pair.

A file can be dirty in Git and synchronized in ProgSync. This is the normal
state immediately after ProgSync applies a change and before the developer
commits it.

The CLI must never use phrases such as "clean" without identifying whether it
means Git-clean or ProgSync-reconciled.

## 7. Private Git state namespace

The accepted state is stored at exactly one ref in each existing worktree:

```text
refs/worktree/progsync/state
```

This does **not** create another Git worktree. `refs/worktree/` is Git's
worktree-local ref namespace, so two linked worktrees can have independent
ProgSync states while sharing the repository object database.

The ref points to a private chain of ordinary Git commit and tree objects. The
chain is not connected to the checked-out branch.

Consequences:

- `git status` is unchanged.
- The project index is unchanged.
- The checked-out branch and `HEAD` are unchanged.
- Normal `git log` is unchanged.
- Normal pushes do not include the private ref.
- Exact accepted file contents are retained and deduplicated by Git.
- `git log --all`, `git show-ref`, an explicit refspec, or a mirror operation
  can reveal/include the private ref. It is private operational state, not
  magical invisible storage.
- A fresh clone has no accepted ProgSync state and safely bootstraps from its
  current Git/project state.

No Git notes, stash entries, hidden branch, automatic project commits, SQLite
database, or hundreds of sidecar receipt files are used.

## 8. Private checkpoint tree

Each private checkpoint tree contains:

1. The exact accepted Program and implementation files at their normal
   project-relative paths.
2. One small receipt per accepted pair below a reserved internal directory.

Example:

```text
<private checkpoint tree>/
|-- program/src/server/alerts.js.md
|-- src/server/alerts.js
`-- .progsync/pairs/3a/3a...f2.json
```

Using the normal project-relative paths means Git can reuse unchanged tree and
blob objects naturally. It also makes prior content directly readable with:

```text
git show refs/worktree/progsync/state:program/src/server/alerts.js.md
git show refs/worktree/progsync/state:src/server/alerts.js
```

The receipt filename is derived deterministically from a SHA-256 hash of the
canonical pair identity. The pair identity includes both canonical relative
paths separated unambiguously; it is not based only on a basename.

Reserved receipt paths exist only inside the private checkpoint tree. ProgSync
does not write `.progsync/pairs` into the project working tree.

## 9. Per-pair receipt

The receipt is versioned JSON and contains no source meaning that is absent
from the two accepted files. Its initial shape is:

```json
{
  "schemaVersion": 3,
  "pairId": "sha256:...",
  "programPath": "program/src/server/alerts.js.md",
  "implementationPath": "src/server/alerts.js",
  "targetKind": "javascript",
  "programHash": "sha256:...",
  "implementationHash": "sha256:...",
  "programMode": 420,
  "implementationMode": 420,
  "auxiliaryFiles": [
    { "path": "src/server/alerts/private.js", "hash": "sha256:...", "mode": 420 }
  ],
  "branch": "main",
  "head": "<project HEAD when accepted>",
  "mode": "PROGRAM_TO_IMPLEMENTATION",
  "contextHash": "sha256:... or null",
  "acceptedAt": "<ISO timestamp>"
}
```

The exact Program and implementation contents are the source of truth for the
baseline. Hashes are integrity and diagnostic conveniences. The receipt is
metadata, not a replacement for retaining the blobs in the checkpoint tree.

`contextHash` records the deterministic bounded context used to accept the
pair when available. Initially it covers resolved Program references,
resolution diagnostics, target identity, and retained package context. It must
exclude volatile values, the synchronization mode, and the current/previous
pair contents already represented separately. If context invalidation cannot
be made reliable in this pass, the field may be `null`; the code must not claim
that dependencies were checked when they were not.

## 10. Baseline selection

For ordinary `progsync <path>` calls with no explicit `--base`, baseline
selection is:

1. Resolve the worktree-local private state ref.
2. Find the pair's receipt and exact files in its checkpoint tree.
3. Verify receipt paths, target kind, and content hashes.
4. Read current branch and `HEAD` without changing them.
5. Decide whether the checkpoint is applicable.
6. If applicable, use its exact Program and implementation as `P0` and `I0`.
7. Otherwise, fall back conservatively to the selected Git base, normally
   `HEAD`, and start a fresh accepted epoch for that pair after successful
   reconciliation.

An explicit `--base <revision>` is an advanced escape hatch and deliberately
bypasses private checkpoint selection for that invocation. This keeps explicit
historical comparisons predictable.

The snapshot returned to orchestration must identify:

- `baselineKind`: `checkpoint` or `git`.
- Private checkpoint commit when used or inspected.
- Why a checkpoint was used or rejected.
- Current branch and `HEAD`.
- Git change state for each side.
- ProgSync change state for each side.

## 11. Branch and worktree behavior

ProgSync does not maintain a separate complete state history for every branch.
The normal workflow is:

1. Check out a branch.
2. Make changes.
3. Synchronize affected files.

A pair checkpoint is applicable when either:

- The current pair exactly equals the accepted pair. In this case the pair is
  already reconciled regardless of a harmless branch label change; or
- The receipt branch equals the current branch and the receipt's recorded
  `HEAD` is equal to or an ancestor of the current `HEAD`.

If the branch changed and the pair does not exactly match, or same-branch
history was rewound/replaced so the recorded `HEAD` is no longer an ancestor,
ProgSync does not use the old pair as a semantic merge base. It falls back to
current Git state, audits/reconciles the pair, and writes a new pair receipt.

This intentionally handles the common branch workflow and safely degrades on
the rare case where compatible dirty changes are carried across branches. It
does not attempt an opaque three-branch semantic merge.

Because the ref is below `refs/worktree/`, another linked worktree cannot see or
accidentally reuse this worktree's accepted state.

## 12. Creating a checkpoint without touching the project index

Checkpoint creation uses Git plumbing and a temporary alternate index:

1. Read the current private state commit, if any.
2. Create a temporary directory and temporary index outside the project tree.
3. Read the prior private tree into that alternate index, or initialize an
   empty alternate index.
4. Write the current Program, implementation, and receipt as Git blobs with
   `git hash-object -w --stdin`.
5. Update only the alternate index with `git update-index --cacheinfo`.
6. Produce the new full state tree with `git write-tree`.
7. Create a private commit with `git commit-tree`, using the previous private
   commit as its parent.
8. Atomically compare-and-swap the worktree-local ref with `git update-ref`.
9. Remove the alternate index directory in `finally`.

The project's real index is never read as a mutable workspace and is never
written. Git object storage may gain unreachable objects after a failed race;
normal Git garbage collection can reclaim them.

The state update uses compare-and-swap against the observed previous ref. If
another ProgSync process advanced the ref, the writer reloads and retries a
small bounded number of times so an update to another pair is not lost.

The private commit has a concise message identifying the accepted pair and
mode. During Vibe64 incubation, the execution gateway supplies its normal Git
author/committer environment even though `commit-tree` also receives local
ProgSync config. This identity is operational metadata on an unpushed private
ref; checkpointing does not read, alter, or require the project's configured
Git identity. A standalone process adapter may use a fixed ProgSync identity.

## 13. Synchronization transaction

For a writable single-file synchronization:

1. Resolve and validate the pair.
2. Read the current files.
3. Read Git `HEAD`, branch, and per-side Git status.
4. Resolve the applicable accepted baseline.
5. Classify the mode.
6. Emit discovery events and show the selected mode.
7. If `NO_CHANGE`:
   - Do not invoke AI.
   - If no private checkpoint exists and this is an applying `sync`, create an
     initial accepted checkpoint from the current pair.
   - Otherwise do not create redundant private commits.
8. For another mode, construct the complete bounded capsule and run the fresh
   atomic translator in its disposable candidate repository.
9. If blocked or invalid, leave the project and private state unchanged.
10. If dry-run, return the proposed diff and leave private state unchanged.
11. If applying, stage validated candidate files and the deterministic Program
    projection, recheck the pair, and apply them with rollback on an ordinary
    write failure.
12. Re-read both current pair files from disk.
13. Confirm that the final pair is structurally valid and still equals the
    result being accepted.
14. Advance the private checkpoint to the exact resulting pair, even when the
    translator accepted an implementation-only refinement without changing
    Program.
15. Emit the new checkpoint identity.

If candidate files were applied but private state advancement fails, report a
clear recoverable state-write error. Do not roll back a correct implementation
merely because private metadata could not be recorded. The next invocation can
compare against the previous checkpoint or Git and reconcile/audit again.

## 14. Dry run and status semantics

`progsync <path> --dry-run`:

- Performs discovery and classification.
- May invoke the atomic translator to produce a candidate diff.
- Does not write Program, implementation, projection, or private checkpoint.
- Repeated dry runs may repeat AI work because no result was accepted.

`progsync status <path>`:

- Resolves the pair and supported target.
- Reads current files, private checkpoint, branch, `HEAD`, and Git state.
- Reports the selected synchronization mode and reasoning.
- Never invokes AI.
- Never writes project files, projections, Git objects, refs, or receipts.
- Exits nonzero only for an invalid/blocked state, not merely because a sync is
  required.

`progsync check` remains the deterministic Program graph/projection check and
is distinct from pair synchronization status.

## 15. CLI discovery output

Human-readable execution should produce concise, ordered lines similar to:

```text
ProgSync: input src/server/alerts.js is a managed implementation.
ProgSync: counterpart program/src/server/alerts.js.md found.
ProgSync: .js is supported by the JavaScript translator.
ProgSync: accepted pair found at private checkpoint 4f2c....
ProgSync: Git — Program changed, implementation changed relative to HEAD.
ProgSync: accepted pair — Program changed, implementation unchanged.
ProgSync: selected PROGRAM_TO_IMPLEMENTATION.
ProgSync: Codex synchronization started.
ProgSync: Codex synchronization completed.
ProgSync: accepted resulting pair at checkpoint 76ab....
```

For `--json`, the same decisions must be returned as structured discovery
records rather than discarded. Diagnostic messages are explanatory output;
mode selection remains deterministic data.

Discovery event codes should be stable enough for a future UI, while their
English messages may improve over time.

## 16. Temporary candidate repositories are not Git worktrees

Each atomic translator invocation currently creates a tiny standalone Git
repository below the operating system temporary directory. It contains only
the selected pair, bounded context, root package context when relevant, and
allowed owned artifacts. It is deleted in `finally`.

This is not `git worktree add`, does not register anything in the project's
`.git/worktrees`, and leaves no normal repository metadata. A process crash can
leave a temporary directory, so later operational hardening may remove stale
`progsync-*` temporary directories by age.

The persistent private checkpoint and the disposable candidate repository have
different purposes:

- Private checkpoint: remembers the last accepted pair across invocations.
- Disposable candidate repository: constrains and validates one AI patch.

## 17. Deferred whole-tree import and 700-file behavior

The deferred whole-tree import workflow must reuse the same single
worktree-local state ref; it must not create one worktree or one permanent ref
per file. The implemented `sync --changed` scheduler already follows this
single-ref, one-module-at-a-time model.

Expected flow:

1. Enumerate supported implementation and Program paths deterministically.
2. Pair and classify them without AI (`--plan`).
3. Process required pairs sequentially initially, one fresh atomic AI call per
   file.
4. Advance the private state after every successfully accepted file so a crash
   can resume without repeating completed AI work.
5. Preserve the starting state commit `S0` and intermediate commits
   `S1...S700` during the run.
6. On complete success, optionally compact the durable history by creating one
   final private commit whose tree equals `S700` but whose parent is `S0`, then
   move the single state ref to it.
7. Intermediate commits become unreachable and normal Git garbage collection
   can reclaim them.
8. On interruption, retain the latest exact checkpoint for safe resume.

Git content-addressing means implementation blobs already present in the
project object database are reused, unchanged state trees are shared, and only
new Program/source/receipt/tree objects consume space. For hundreds of files,
the AI calls dominate cost; private Git breadcrumbs are comparatively cheap.

A whole-tree dry run must not advance the accepted private ref. Therefore it is
not resumable by default. A future explicitly requested disposable run cache
could change that without conflating proposals with accepted state.

Potential later maintenance commands:

```text
progsync state compact
progsync state inspect
progsync state reset <path>
```

`reset` must be explicit because deleting accepted history changes how the next
sync is classified.

## 18. Library API changes

The implemented package exposes:

- `synchronizeFile(options)` as the automatic single-pair operation, with
  optional `sync`, `import`, or `compile` operation selection;
- `statusFile(options)` as read-only deterministic inspection;
- `syncChanged(options)` as the sequential changed-tree orchestrator; and
- no low-level checkpoint API, duplicate directed wrapper, or private Git
  layout through the package root.

The default library operation still requires `projectRoot`. The CLI defaults it
to the current directory.

`base` remains optional. Omitting it selects applicable private state first;
supplying it explicitly selects that Git base.

## 19. Failure, recovery, and concurrency rules

- Failure before candidate application changes nothing durable.
- A blocked translator never advances accepted state.
- A rejected deterministic candidate gets the existing single repair retry;
  neither rejected candidate is accepted.
- Dry run never advances accepted state.
- State corruption, missing receipt blobs, receipt/path mismatches, and hash
  mismatches fail closed with a diagnostic; they must not be silently trusted
  or silently replaced by a Git fallback.
- A missing private ref is normal bootstrap state.
- A stale private ref after a branch rewrite causes Git fallback, not an
  invented semantic merge.
- Compare-and-swap prevents two writers from silently discarding each other's
  private tree updates.
- The retry path reloads the latest state tree before writing.
- A worktree-local same-pair lock serializes ProgSync writers from snapshot
  through checkpoint. A second process receives `PAIR_BUSY`; dead same-host
  locks are recoverable.
- ProgSync compares the real pair with its snapshot immediately before apply,
  re-reads it after apply, and refuses to checkpoint a differing result. This
  detects ordinary manual edits made while AI is running. No advisory lock can
  prevent an unrelated editor from writing during the final rename window.
- Staged multi-file application has rollback for ordinary errors but is not a
  crash-atomic filesystem transaction. The private ref never accepts a partial
  result; a process or machine crash during apply may require another sync.
- Private state failure after correct project writes is recoverable and must be
  reported distinctly from translation failure.

## 20. Required tests

### Pure classification

- No prior pair and implementation exists -> `CREATE_PROGRAM`.
- No prior pair and Program exists -> `CREATE_IMPLEMENTATION`.
- Only Program differs from checkpoint -> `PROGRAM_TO_IMPLEMENTATION`.
- Only implementation differs -> `IMPLEMENTATION_TO_PROGRAM`.
- Both differ -> `RECONCILE_BOTH`.
- Neither differs -> `NO_CHANGE`.
- A side missing after previously existing -> explicit-deletion diagnostic.

### Checkpoint plumbing

- First checkpoint creates `refs/worktree/progsync/state`.
- Accepted Program and implementation can be read exactly from the private
  commit tree.
- Updating one pair retains all other pair entries.
- The new private commit has the prior private commit as parent.
- The project `HEAD`, current branch, real index checksum, working tree
  contents, and ordinary `git status --porcelain` are unchanged by checkpoint
  creation.
- A linked Git worktree does not resolve another worktree's private state ref.
- Compare-and-swap conflict cannot silently drop state.
- Temporary alternate indexes are removed after success and failure.

### Synchronization behavior

- After Program -> implementation synchronization, both files may remain dirty
  against `HEAD`, but an immediate second invocation selects `NO_CHANGE` and
  does not call the runner.
- An accepted implementation-only realization refinement advances the
  checkpoint even when Program is unchanged.
- A dry run does not create or advance private state.
- A blocked result does not create or advance private state.
- No-checkpoint files matching `HEAD` can establish an initial checkpoint on an
  applying sync without an AI call.
- Explicit `--base` bypasses private state.
- Same-branch descendant `HEAD` accepts the checkpoint.
- Different branch with exact pair reports reconciled.
- Different branch with changed pair falls back to Git.
- Rewritten same branch with changed pair falls back to Git.
- A manual pair edit made while the runner is active is preserved and rejects
  the stale candidate.
- Two simultaneous synchronizations of one pair do not both invoke writers.
- Executable target mode survives candidate application and private
  checkpointing.
- A non-Git project fails before candidate generation or project writes.
- A changed Program provider invalidates accepted consumer context and
  `sync --changed` schedules its transitive consumers.

### CLI behavior

- `progsync src/file.js` automatically invokes sync.
- `progsync program/src/file.js.md` automatically invokes sync.
- Unsupported target fails before runner invocation.
- Discovery output includes input side, counterpart presence, translator,
  baseline source, Git changes, accepted-pair changes, and selected mode.
- `--json` includes structured discovery.
- `progsync status <path>` invokes no runner and performs no writes.
- Legacy explicit commands continue to parse during incubation.
- Missing option values, incompatible flags, and `--changed` plus a path are
  rejected deterministically.

### Regression verification

- Package unit tests pass.
- Package lint passes.
- Vibe64 package-contract verification passes.
- Full Vibe64 server tests, client tests, build, and doctor pass.
- `git diff --check` passes.

## 21. Implementation sequence

1. Add constants and a dedicated private-checkpoint module.
2. Extend the command adapter only as needed for alternate-index environment
   and allowed temporary roots, keeping that adapter as the package extraction
   seam.
3. Add low-level Git branch, ancestry, ref, blob, tree, commit, and atomic-ref
   helpers.
4. Add deterministic pair IDs and receipts.
5. Replace HEAD-only pair snapshot selection with state-first selection and Git
   fallback.
6. Add structured discovery records.
7. Advance checkpoints after successful synchronization and bootstrap
   `NO_CHANGE` pairs when applying.
8. Add `statusFile()`.
9. Make a bare path the primary CLI form while retaining compatibility verbs.
10. Add focused tests, including a real linked-worktree isolation test.
11. Update the package README and the main
    `software_development_revolution.md` specification to reflect the shipped
    behavior, without duplicating all Git-plumbing detail there.
12. Run full verification.

## 22. Acceptance criteria

This work is complete when all of the following are true:

1. A successful sync followed immediately by the same command is a no-op even
   when both files remain dirty relative to `HEAD`.
2. The second invocation does not call Codex.
3. The CLI can infer everything from either member of the pair.
4. The CLI explains how it reached its decision.
5. `status` can report the same decision without AI or writes.
6. Dry-run and blocked runs never become accepted history.
7. Accepted state survives process exit but does not alter normal project Git
   history or status.
8. Linked worktrees keep independent accepted states.
9. Hundreds of pairs share one ref and one content-addressed state tree rather
   than creating hundreds of worktrees or refs.
10. Existing Program format, deterministic `.md.json` projections, atomic
    candidate validation, and precious implementation preservation continue to
    work.

## 23. Implementation record

This section records the completed implementation and verification evidence so
the document remains a reliable handoff rather than a speculative plan.

- [x] Design agreed and recorded.
- [x] Private checkpoint module implemented.
- [x] State-first classification implemented.
- [x] Automatic path CLI and discovery logs implemented.
- [x] Read-only pair status implemented.
- [x] Tests implemented and passing.
- [x] Main specification and README updated.
- [x] Full Vibe64 verification rerun after the safety/parser remediation.

Implemented in `packages/progsync`:

- `src/index/checkpoint.js` owns pair IDs, receipts, checkpoint reads, conservative
  applicability, alternate-index tree construction, private commits, and
  compare-and-swap ref updates.
- `src/index/service.js` uses private state before Git fallback, returns structured
  discovery, invalidates changed dependency context, schedules declared
  consumers, advances accepted state only after successful writable results,
  and exposes read-only `statusFile()`.
- `src/index/lock.js` serializes same-pair work without creating one ref or worktree
  per file.
- `src/index/structural.js` uses Babel and Vue compiler parsers for JavaScript,
  Vue, and HTML facts; `src/index/conformance.js` rejects structural surface drift.
- `src/index/candidate.js` validates in a disposable repository, rejects stale real
  pairs, preserves executable modes, and stages writes with rollback.
- `src/cli.js` treats a bare path as automatic synchronization, prints
  discovery decisions, and provides `status`.
- `src/index/command.js` starts subprocesses directly through Node without a
  Vibe64 runtime dependency and terminates their complete process group on
  timeout or output overflow.
- The independent public oracle covers state isolation, owned auxiliaries,
  Git/index/worktree non-mutation, dirty-but-reconciled idempotence,
  realization-only acceptance, dry-run and boundary safety, nested project
  roots, process cleanup, pinned runner isolation, and the public CLI.

Current focused verification on 2026-07-23:

- 55 independent public-oracle tests pass without invoking a real LLM; injected
  runners simulate candidate edits and the Codex runner protocol. The added
  coverage includes external cancellation without orphaned Codex descendants,
  deterministic omission of absent projection fields, default-export value
  classification, subprocess-listener scoping under a wide status run, and
  recovery from an incompatible private state object without invoking a runner,
  provider-owned forwarding exports, and explicit Git baselines that completely
  bypass stale accepted dependency context.
  The oracle is implementation-neutral: it rejects observable contract failures
  but does not require the mature implementation's private helper graph, state
  encoding, lock layout, evidence-field spelling, or diagnostic prose.
- ProgSync ESLint passed.
- All 19 workspace package contracts passed.
- Full Vibe64 verification passed: 1,433 server tests, 633 client tests,
  production build, and project doctor.
- `git diff --check` passed.

Self-hosting evidence on 2026-07-23:

- A clean package was generated from four production Program modules,
  `types.md`, and retained non-Program inputs with the pinned Sol/xhigh runner.
  No generated implementation file was hand-patched.
- The initial clean generation passed the then-current semantic public oracle,
  29/29. Later Program changes were applied to that generated package through
  incremental synchronization rather than full regeneration; the evolved
  package passed the then-current 30/30 oracle milestone. Those counts are
  historical experiment checkpoints; the current mature oracle contains 55
  tests as recorded above. The independently generated package also passes all
  55 after incremental evolution.
- Incremental synchronization preserved the generated package's unrelated
  implementation and changed only the owned files needed by the Program delta.
- The generated compiler contained an observable explicit-baseline bug even
  though Program already stated the correct precedence. The independent oracle
  found it, and one Program-driven reconciliation changed two conditions in one
  private file. This establishes that managed implementation is durable,
  verified realization source rather than disposable AI output.
- The mature compiler and the independently generated compiler used different
  encodings for their private accepted checkpoints. That representation is
  intentionally not a public interchange format. At compiler handoff, the
  generated package established a new accepted epoch from an explicit committed
  Git base; Program, managed implementation, public synchronization behavior,
  and ordinary project history remain the compatibility contract.
- A final handoff regression proved that an incompatible private ref is
  replaced atomically without invoking the runner. With Codex absent, every
  generated production module accepted that explicit base and then returned
  `NO_CHANGE` under ordinary default invocation, changed zero files, and
  preserved byte-identical implementation and projection hashes.

Deliberately deferred:

- Whole-tree import/resume orchestration and final history compaction beyond
  the current changed-file scheduler, as described in section 17. One Program
  module may already own its primary target and regular private files below its
  deterministic auxiliary root.
- City Explorer consumption of the deterministic projections.
- An externally enforced filesystem sandbox for the Codex process.
