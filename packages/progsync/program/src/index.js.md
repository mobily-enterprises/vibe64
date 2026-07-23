# ProgSync library

Synchronizes readable Program modules with persistent managed implementation
while keeping private realization out of the public Program graph.

## Uses

- [`spawn()`](package:npm/node:child_process#spawn) runs Git, Codex, and target checks without a shell.
- [`Program authoring prompt`](asset:prompts/program-author.txt)
- [`Atomic synchronizer prompt`](asset:prompts/atomic-base.txt)
- [`JavaScript target instructions`](asset:prompts/javascript.txt)
- [`HTML target instructions`](asset:prompts/html.txt)
- [`Vue target instructions`](asset:prompts/vue.txt)
- [`Synchronizer result schema`](asset:schemas/synchronizer-result.schema.json)

## Provides

### `parseProgram()`

#### Parameters

* `programSource`: complete Program Markdown as text
* an optional [Parse options] object containing the following field and defaulting to an empty object:
  * `programPath`: the canonical Program path, defaulting to `program/unknown.js.md`

#### What it does

1. It normalizes line endings and recognizes Markdown headings only outside
   CommonMark fenced code. An opening run of at least three backticks or tildes
   may be followed immediately by an information string such as `markdown`; a
   closing fence uses the same marker and at least the opening length. Neither
   headings nor type syntax inside the complete fence are parsed. Every section
   scan ends at the next heading of equal or higher level, or at the finite end
   of the source when there is no such heading; no scan reads beyond the final
   source line. It requires exactly one H1 title, one `## Uses`, and one
   `## Provides`.
2. It parses Uses as either the sole sentence `- Nothing outside this file.` or
   unique Markdown links with backticked symbols. An exact link may occur only
   once, and one visible symbol may name only one provider; repeating the same
   symbol with another provider is ambiguous and invalid. Project providers must be
   `@/<file>.md#<anchor>` without traversal; package and platform providers must
   have an anchor; asset identities must be relative and traversal-free. Types
   are rejected from Uses because `[Type name]` resolves implicitly.
3. It parses top-level provided symbols from exact backticked H3 headings under
   Provides. An exported class is declared by the canonical linked-list form
   defined in `Program authoring prompt`, receives exactly one matching
   level-two class section, and owns exactly one constructor plus its public
   level-three instance and explicitly prefixed static methods. Constructors,
   instance methods, and static methods remain distinct public member kinds.
   Kind is derived in this order: `program/types.md` provides types; `.vue.md`
   provides a component; `.html.md` provides a document; a path below
   `program/bin/` ending in `.js.md` or `.mjs.md` provides a command when its
   symbol is the target filename without the JavaScript extension; a symbol
   ending in `()` is a function; and remaining symbols are values or root
   Program-library definitions. A remaining symbol is a `library` only when
   its file has no implementation target and is itself a root Program library;
   a remaining symbol in any targeted file is a `value`. Command recognition
   occurs before generic
   JavaScript classification: `program/bin/example.js.md` providing `example`
   is a command, not an exported JavaScript value.
4. Every function, method, and command must contain exactly one
   `#### Parameters`, `#### What it does`, and `#### Returns` section in that
   order. Parameters is either `No parameters.` or one bullet per argument;
   nested bullets are allowed only beneath an argument described as an object
   containing those exact fields. Positional and nested field names must be
   backticked. Each present valid section is retained even when another section
   is missing. A missing or repeated required section produces
   `INVALID_PARAMETERS_COUNT`, `INVALID_WHAT_IT_DOES_COUNT`, or
   `INVALID_RETURNS_COUNT`; any other level-four operation section produces
   `UNEXPECTED_OPERATION_SECTION`; and incorrect ordering produces
   `INVALID_OPERATION_SECTION_ORDER`.
5. It discovers each distinct `[Type name]` reference outside Markdown links,
   inline code spans, and fenced code, retains source lines, rejects empty or
   duplicate public identities, and emits diagnostics in source order without
   interpreting behavior prose. The following source contains only the type
   reference `Result`:

   ```markdown
   A [Result]; the literal syntax `[Not a type]` and [`link`](@/other.md#link).
   ```

#### Returns

A [Parsed Program]. Invalid Program returns `valid` as false with complete
diagnostics; malformed authored input is not thrown as a parser exception.

### `buildProgramProjection()`

#### Parameters

* a [Projection request] object containing:
  * `parsedProgram`: an optional already parsed [Parsed Program], defaulting to absent
  * `programPath`: the canonical project-relative Program path
  * `programSource`: the complete Program Markdown, required when `parsedProgram` is absent

#### What it does

It uses the supplied parsed Program or calls the module's own Program parser on
the supplied source. It deterministically creates the schema-version-2 City
record, infers the target by removing the final `.md`, derives the private
auxiliary root by removing the target's final extension, assigns stable
`@/file.md#anchor` identities, separates runtime Uses from implicit type
references, preserves function parameters, behavior, and returns as distinct
fields, omits optional fields rather than emitting them as `null` or empty text,
includes local diagnostics and source locations, and hashes the exact
normalized Program source with SHA-256. Object keys and arrays have stable
ordering for identical Program input. A symbol anchor removes a trailing `()`,
normalizes Unicode with NFKD, lowercases it, replaces each run outside ASCII
letters and digits with one `-`, and trims leading or trailing `-`; the special
symbol `*` has anchor `all-exports`.

#### Returns

The [Program projection] for the requested module. It does not read or write a
projection file.

### `readProgramAuthorPrompt()`

#### Parameters

No parameters.

#### What it does

It reads `Program authoring prompt` as UTF-8 text so another AI can be
instructed to apply the same module, data-flow, type, and golden-rule
constraints. A read failure passes to the caller.

#### Returns

The complete Program-authoring prompt text without modification.

### `synchronizeFile()`

#### Parameters

* a [Synchronization request] object containing:
  * `base`: an optional explicit Git revision, defaulting to private accepted state and then HEAD
  * `dependencyChanged`: whether a reachable dependency changed, defaulting to false
  * `inputPath`: the selected Program or implementation path
  * `onEvent`: an optional operation receiving ordered progress records
  * `operation`: `sync`, `import`, or `compile`, defaulting to `sync`
  * `projectRoot`: the explicit project root inside a Git worktree
  * `runner`: an optional [Atomic runner], defaulting to the isolated Codex runner
  * `write`: whether accepted writes are installed, defaulting to true

#### What it does

1. It resolves the input to one Program/implementation pair, infers the
   JavaScript, Vue, or HTML target from the final implementation extension, and
   requires an explicit project root inside a Git worktree. A missing side is
   created from the existing side; a side that existed at the accepted baseline
   and disappeared requires an explicit deletion or rename instead of being
   inferred. A root outside Git fails with `GIT_REPOSITORY_REQUIRED`; any
   symlink in the selected module path fails with `SYMLINKED_PROJECT_PATH`
   before the linked target is read or changed. `projectRoot` may be the
   worktree root or a nested subtree; every Git-tree and checkpoint path is
   prefixed by that subtree's repository-relative path while every reported
   module path remains relative to `projectRoot`.
2. It serializes the pair for the duration of discovery, candidate generation,
   installation, verification, and checkpointing. A concurrent live owner
   fails with `PAIR_BUSY`; claims abandoned by a crashed process are recovered
   after a bounded stale interval instead of permanently blocking the pair. It
   compares the current
   Program, primary target, and every regular file below the deterministic
   auxiliary root with the last applicable private checkpoint. An exact
   checkpoint remains applicable across a branch switch; otherwise it is used
   only when its branch history continues. An explicit `base` uses that Git
   revision instead; when it is present, no private-checkpoint fact, including
   a recorded dependency or context hash, affects the selected baseline or
   mode. File comparison uses Git-tracked modes: every regular file with no
   executable bit is normalized to `0644`, and every regular file with any
   executable bit is normalized to `0755`. Differences such as filesystem mode
   `0664` versus Git mode `0644` are not changes. Content, existence, and this
   normalized tracked mode are compared independently.
3. It selects exactly one mode: `CREATE_PROGRAM` when only implementation
   exists; `CREATE_IMPLEMENTATION` when only Program exists;
   `PROGRAM_TO_IMPLEMENTATION` when only Program differs from the accepted
   baseline; `IMPLEMENTATION_TO_PROGRAM` when only the primary implementation
   or any owned auxiliary differs; `RECONCILE_BOTH` when both Program and
   implementation differ; and `NO_CHANGE` when neither differs. A dependency
   is changed only when its current existence, content, or normalized tracked
   mode differs from its corresponding accepted or Git-baseline state; merely
   discovering a dependency does not make it changed. A changed
   reachable Program dependency or retained package interface forces
   `PROGRAM_TO_IMPLEMENTATION` when implementation is otherwise unchanged and
   `RECONCILE_BOTH` when implementation also changed. An auxiliary-only
   realization refinement therefore selects `IMPLEMENTATION_TO_PROGRAM`, not
   `RECONCILE_BOTH`.
4. It reads `Atomic synchronizer prompt`, all target instructions, and
   `Synchronizer result schema` relative to the installed ProgSync package that
   provides this function. These compiler-owned assets never resolve relative
   to the request's `projectRoot`; that root is the unrelated project being
   synchronized and need not contain ProgSync prompts or schemas. It assembles
   a closed capsule containing those exact assets, complete previous and current
   Program, primary implementation, owned auxiliaries, mechanically extracted
   public source facts, reachable Uses and complex types, retained package
   context including package entrypoints, runner identity, and exact write
   paths. When Program may be recovered from implementation, the capsule also
   identifies each implementation export's distinct production
   consumers, test-only consumers, and external package or process boundary.
   Its `sourceSurfaceEvidence` is a [Source surface evidence], so incomplete or
   ambiguous consumer analysis is represented explicitly instead of being
   silently omitted.
   It obtains that evidence from tracked and non-ignored untracked source
   without supplying consumer implementations to the Atomic runner. Missing or
   ambiguous public providers or source-surface evidence block rather than
   being guessed. Package boundary evidence expands `*` patterns in manifest
   targets, including targets nested inside conditional export objects.
   Malformed Program, unresolved required Uses or types, and incomplete source
   evidence may block synchronization. Golden-module policy diagnostics such as
   too few production consumers or a test Program module remain deterministic
   `checkProgram()` findings; they do not prevent an otherwise valid individual
   pair from synchronizing while a project graph is still being assembled.
5. For a mode requiring translation, it gives the capsule to the supplied
   [Atomic runner]. Without one, it calls `spawn()` without a shell in the
   disposable candidate workspace, feeds the prompt through standard input,
   and invokes `codex` with these arguments in order:

   * `exec --model gpt-5.6-sol --config model_reasoning_effort="xhigh"`
   * `--ephemeral --ignore-user-config --ignore-rules`
   * `--dangerously-bypass-approvals-and-sandbox`
   * one `--disable` pair for each of `shell_tool`, `web_search`, `apps`,
     `multi_agent`, `goals`, `hooks`, `memories`, `remote_plugin`, and
     `shell_snapshot`
   * `--config web_search="disabled" --color never --json`
   * `--output-schema` followed by the installed package path of
     `Synchronizer result schema`
   * `--output-last-message` followed by a temporary report path
   * `--cd` followed by the candidate workspace, then `-`

   It never supplies `--sandbox` or `--skip-git-repo-check`. Danger bypass is a
   deliberate prototype runner choice because the supported workspace sandbox
   is not reliable in every host environment. The structured result path
   remains inside the disposable workspace and is removed after it is read.
   On platforms with
   process groups it starts Codex as the group leader. It accepts at most 16 MiB
   across standard output and error and allows at most sixty minutes. Exceeding
   either limit immediately sends `SIGKILL` to the complete group and does not
   return failure until the group has closed, so no descendant survives. It
   also handles `SIGINT` or `SIGTERM` received while Codex is active by killing
   the complete Codex group, waiting for it to close, and then terminating the
   caller with the originally received signal, so cancellation leaves no
   detached descendant. These temporary parent-signal handlers exist only for
   the Codex execution; concurrent Git and target-check subprocesses do not add
   their own process signal handlers. It reports a timeout as `CODEX_TIMEOUT`;
   a nonzero exit or output overflow as
   `CODEX_EXEC_FAILED`; and a missing or malformed final report as
   `CODEX_RESULT_MISSING` or `CODEX_RESULT_INVALID`. It validates the final
   report with `Synchronizer result schema`.
6. It permits candidate writes only to the selected Program file, primary
   target, controlled shared `program/types.md` when appropriate, and regular
   files below the owned auxiliary root. It rejects deletion, symlinks, writes
   elsewhere, mismatched reports, malformed Program, unparseable targets
   (including invalid JavaScript in an embedded HTML script),
   incorrect public exports or argument grouping, unresolved Program Uses,
   unrelated shared-type edits, and candidates that omit stated Program
   behavior. A primary JavaScript target may directly declare a public symbol
   or forward it from one of its owned auxiliary files; forwarded functions are
   resolved through that file so their callability and parameter grouping can
   be checked. A write outside the boundary fails immediately with
   `ATOMIC_WRITE_BOUNDARY_VIOLATION`, includes the sorted offending paths in
   `details.forbidden`, and is never retried.
   `CREATE_PROGRAM`, `IMPLEMENTATION_TO_PROGRAM`, and `RECONCILE_BOTH` may
   create `program/types.md` when absent or update only shared complex types
   referenced by the selected module; implementation-directed modes cannot
   edit shared types. Every structural rejection identifies the exact observed
   and required public facts. In particular, a missing expected export uses
   `PAIR_SURFACE_MISMATCH` and a message containing
   `Program provides <symbol>, but implementation does not export it`; it does
   not report only that the surfaces differ. Extra exports, wrong callability,
   and wrong argument grouping likewise name the affected symbols and include
   structured expected and actual evidence. Before installation it also links
   every relative JavaScript import within the primary target and owned
   auxiliary root without executing the candidate: every target must exist and
   every named import must be exported by that target. Exact retained asset
   targets supplied through Uses participate in this link graph even when they
   are outside the auxiliary root; a relative import of a retained JSON asset
   resolves to that supplied file and may use its default JSON value after the
   file parses successfully. An exact project Use similarly validates its
   provider read-only and follows relative forwarding exports recursively
   through that provider's owned auxiliary files; a public barrel still exports
   a symbol whose declaration lives in its private auxiliary tree. A failure
   states whether the target is unresolved or the named symbol is not exported;
   names the importer, requested symbol or specifier, and intended provider;
   includes those same values as structured evidence; and is repairable in the
   same candidate workspace. The explanatory wording is not otherwise
   prescribed.
   Every Git operation ignores inherited `GIT_*` routing variables. Candidate
   baseline commits additionally use an invocation-local identity with signing
   and hooks disabled, so host Git configuration cannot redirect or prevent an
   otherwise valid synchronization.
7. Only candidate failures with code `INVALID_IMPLEMENTATION`,
   `INVALID_PROGRAM`, `IMPLEMENTATION_MODE_MISMATCH`,
   `PAIR_SURFACE_MISMATCH`, or `UNSUPPORTED_VUE_SCRIPT` are repairable. Their
   complete structured diagnostic is appended and the rejected candidate
   remains in the same disposable workspace for repair, for up to three total
   attempts. The retry explicitly says `Repair that candidate in place` and
   `Re-audit the complete Program`, warns that the first mismatch is not proof
   of full coverage, retains every earlier diagnostic, and includes the exact
   failure code and messages such as `Program provides greet()` so the runner
   can correct the candidate without reconstructing it. Every other failure
   passes to the caller immediately.
8. Unless `write` is false, it installs all effective writes and deterministic
   projections as one guarded operation. It first confirms that the real pair,
   owned auxiliaries, and writable shared types still equal the snapshot
   captured before the Atomic runner began. That expected shared-type snapshot
   is never refreshed after candidate generation; a concurrent edit made while
   the runner works therefore aborts the entire installation before any write.
   An ordinary staging or installation failure restores displaced files in
   reverse order; a concurrent edit is never overwritten. If another process
   recreates a target after its original was displaced, ProgSync retains both
   the external replacement and the original at the reported recovery path.
   Unsafe incomplete recovery is reported with its recovery paths rather than
   hidden.
9. It re-reads and validates the complete installed module, then records exact
   Program, primary, auxiliary, permission, context, Git-branch, and runner
   state in the single worktree-private ref `refs/worktree/progsync/state`.
   Checkpoint updates preserve other modules through compare-and-swap retries
   and never change HEAD, the project index, branch history, or ordinary push
   contents. If that ref already contains a missing, malformed, unsupported, or
   non-commit object, ProgSync treats its state as inapplicable but still uses
   the exact raw object as the compare-and-swap expected value. It atomically
   replaces that object and uses it as a commit parent only when Git confirms
   that it is a commit.
10. `NO_CHANGE` invokes no AI, but still validates conformance, refreshes a stale
   projection, and ensures a Program command is executable. A dry run produces
   the complete candidate diff and report, including every created file and
   content or executable-mode change, but changes neither project files nor
   accepted state. Every path, mode, baseline, change source, and decision is
   recorded as ordered discovery evidence.

These guarantees exist so large batches can be synchronized file-atomically
without losing either public meaning or mature private implementation work.

#### Returns

A [Synchronization result]. A semantic conflict returns `blocked`; invalid
inputs, unsafe candidates, concurrent changes, Git failures, and incomplete
recovery fail with a stable diagnostic code and structured evidence.

### `syncChanged()`

#### Parameters

* a [Changed synchronization request] object containing:
  * `base`: an optional explicit Git revision
  * `onEvent`: an optional operation receiving ordered progress records
  * `projectRoot`: the explicit project root inside a Git worktree
  * `runner`: an optional [Atomic runner], defaulting to the isolated Codex runner
  * `write`: whether accepted writes are installed, defaulting to true

#### What it does

1. It obtains tracked and untracked paths changed from the requested Git base,
   ignoring generated `.program/index/` projections. It maps supported Program
   and implementation paths to unique module pairs and records unrelated or
   unsupported paths separately.
2. It parses the Program graph without AI. Changes to a Program provider,
   `types.md`, a retained asset, or package context schedule every transitively
   affected target-bound consumer. A `types.md` change schedules target-bound
   modules that contain at least one implicit shared-type reference, not modules
   with no type reference. A retained asset change schedules only modules that
   use that exact asset. A retained package-context change schedules every
   target-bound module in that package. Type, runtime, and generation
   dependencies remain distinct graph relationships.
3. It calls the module's own single-file synchronization behavior for each
   queued pair in deterministic order, passing through `runner`, `onEvent`,
   `base`, and `write`. When a synchronization changes a Program boundary, its
   newly affected consumers are appended once. Processing stops after a blocked
   result so later modules are not reconciled against an unresolved boundary.

#### Returns

A [Changed synchronization result] whose status is `blocked` when any processed
module blocked, otherwise `updated` when any module updated, and otherwise
`unchanged`.

### `statusFile()`

#### Parameters

* a [Status request] object containing:
  * `base`: an optional explicit Git revision
  * `inputPath`: the selected Program or implementation path
  * `projectRoot`: the explicit project root inside a Git worktree

#### What it does

It performs the same path resolution, Git/checkpoint baseline selection,
primary and owned-auxiliary comparison, context closure, mode selection, and
discovery reporting as synchronization, but invokes no runner, changes no file,
does not refresh projections, and records no checkpoint.

#### Returns

A [Status result] with `reconciled` true exactly when the selected mode is
`NO_CHANGE`.

### `checkProgram()`

#### Parameters

* a [Program check request] object containing:
  * `projectRoot`: the explicit root whose `program/` tree is checked

#### What it does

1. It finds every Markdown file below `program/` in stable path order and
   parses it without AI. Its projection path removes the leading `program/`
   from the Program path, prefixes `.program/index/`, and appends `.json`.
   Thus `program/src/name.js.md` maps exactly to
   `.program/index/src/name.js.md.json`, and `program/types.md` maps to
   `.program/index/types.md.json`; `.program/index/program/` is never created.
   It refuses a symlink anywhere in the projection path and never follows one
   while reading, writing, or removing projections.
   It materializes each byte-stable projection when absent or stale and removes
   only projection files at that exact mapping whose Program source no longer
   exists.
2. It validates every project Uses link against the exact provided identity and
   resolves every implicit type reference through `program/types.md`.
3. It builds production and test consumer sets separately. A path containing a
   `test` or `tests` segment, or whose target name contains `.test.` or `.spec.`,
   is a Program test and receives `PROGRAM_TEST_MODULE_FORBIDDEN`. Tests never
   count as production consumers. A callable that is not an external package,
   command, framework, document, or component boundary receives
   `PROGRAM_SYMBOL_HAS_TOO_FEW_PRODUCTION_CONSUMERS` when used by fewer than two
   distinct production Program modules; a callable used by tests but no
   production module instead receives `TEST_ONLY_PROGRAM_SYMBOL`.
4. It identifies external boundaries from commands, framework/document kinds,
   package descriptors, and the nearest package manifest's `exports`, `main`,
   `module`, and `bin` targets. Package target patterns containing `*` match the
   corresponding implementation segment, including nested conditional export
   objects. It attaches consumer and external-boundary data
   to the returned provided symbols so the City can display runtime, type, and
   generation edges without interpreting English. An unresolved project Use
   receives `UNRESOLVED_PROGRAM_USE`; an implicit type absent from
   `program/types.md` receives `UNRESOLVED_PROGRAM_TYPE`.

#### Returns

A [Program check result]. Checking may update or remove generated projection
files but never changes Program, implementation, package data, tests, or
accepted synchronization state and never invokes AI.
